/**
 * OAuth Authorize Page
 *
 * Frontend consent page for MCP OAuth 2.1 Authorization Code flow.
 * VS Code (or other MCP clients) opens the browser directly to this route:
 *   /oauth/authorize?response_type=code&client_id=...&redirect_uri=...&...
 *
 * Flow:
 * 1. Parse OAuth query params from URL
 * 2. Call GET /api/auth/authorize?... to validate params & get client info
 * 3. If user is not logged in → redirect to /login with return URL
 * 4. If logged in → show consent UI
 * 5. On "Authorize" → POST /api/auth/authorize with JWT → redirect to client
 */

import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import SecurityIcon from "@mui/icons-material/Security";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Stack,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

// ============================================================================
// Types
// ============================================================================

type ScopeInfo = {
  name: string;
  description: string;
};

type AuthorizeInfo = {
  client: { clientId: string; clientName: string };
  scopes: ScopeInfo[];
  state: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
};

type PageState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "not-logged-in"; returnUrl: string }
  | { kind: "consent"; info: AuthorizeInfo }
  | { kind: "approving" }
  | { kind: "approved"; redirectUri: string };

// ============================================================================
// Constants
// ============================================================================

const TOKEN_STORAGE_KEY = "casfa_tokens";

// ============================================================================
// Component
// ============================================================================

export function OAuthAuthorizePage() {
  const [searchParams] = useSearchParams();
  const [state, setState] = useState<PageState>({ kind: "loading" });
  const initStarted = useRef(false);

  // Read JWT from localStorage (same origin as frontend SPA)
  const getStoredToken = useCallback((): { accessToken: string; userId: string } | null => {
    try {
      const raw = localStorage.getItem(TOKEN_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed.user?.accessToken) return null;
      // Check expiry with 60s buffer
      if (parsed.user.expiresAt && parsed.user.expiresAt < Date.now() + 60_000) return null;
      return { accessToken: parsed.user.accessToken, userId: parsed.user.userId };
    } catch {
      return null;
    }
  }, []);

  // Validate params by calling backend
  const validateParams = useCallback(async () => {
    const queryString = searchParams.toString();
    const res = await fetch(`/api/auth/authorize/info?${queryString}`);
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error_description || data.error || "Invalid request");
    }
    return data as AuthorizeInfo;
  }, [searchParams]);

  // Initialize
  useEffect(() => {
    if (initStarted.current) return;
    initStarted.current = true;

    (async () => {
      try {
        // 1. Validate OAuth params
        const info = await validateParams();

        // 2. Check login
        const token = getStoredToken();
        if (!token) {
          setState({
            kind: "not-logged-in",
            returnUrl: window.location.href,
          });
          return;
        }

        // 3. Show consent
        setState({ kind: "consent", info });
      } catch (err) {
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : "Unknown error",
        });
      }
    })();
  }, [validateParams, getStoredToken]);

  // Handle approve
  const handleApprove = useCallback(async () => {
    if (state.kind !== "consent") return;
    const { info } = state;

    const token = getStoredToken();
    if (!token) {
      setState({ kind: "not-logged-in", returnUrl: window.location.href });
      return;
    }

    setState({ kind: "approving" });

    try {
      const res = await fetch("/api/auth/authorize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token.accessToken}`,
        },
        body: JSON.stringify({
          clientId: info.client.clientId,
          redirectUri: info.redirectUri,
          scopes: info.scopes.map((s) => s.name),
          state: info.state,
          codeChallenge: info.codeChallenge,
          codeChallengeMethod: info.codeChallengeMethod,
          realm: token.userId,
        }),
      });

      const result = await res.json();

      if (!res.ok) {
        setState({
          kind: "error",
          message: result.error_description || result.error || "Authorization failed",
        });
        return;
      }

      if (result.redirect_uri) {
        setState({ kind: "approved", redirectUri: result.redirect_uri });
        // Small delay so user sees success, then redirect
        setTimeout(() => {
          window.location.href = result.redirect_uri;
        }, 500);
      } else {
        setState({ kind: "error", message: "No redirect URI in response" });
      }
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Network error",
      });
    }
  }, [state, getStoredToken]);

  // Handle deny
  const handleDeny = useCallback(() => {
    if (state.kind !== "consent") return;
    const { info } = state;
    const url = new URL(info.redirectUri);
    url.searchParams.set("error", "access_denied");
    url.searchParams.set("error_description", "User denied the request");
    if (info.state) url.searchParams.set("state", info.state);
    window.location.href = url.toString();
  }, [state]);

  // Handle "go to login"
  const handleLogin = useCallback(() => {
    // Save return URL so after login → callback → success, we can come back.
    // For now, redirect to /login in same tab. The user will need to
    // re-trigger the MCP auth from VS Code after logging in.
    // Future: use sessionStorage to auto-return.
    sessionStorage.setItem("casfa_oauth_return", window.location.href);
    window.location.href = "/login";
  }, []);

  // ── Render ──

  // Loading
  if (state.kind === "loading" || state.kind === "approving") {
    return (
      <Box display="flex" flexDirection="column" justifyContent="center" alignItems="center" minHeight="100vh" gap={2}>
        <CircularProgress />
        <Typography variant="body2" color="text.secondary">
          {state.kind === "loading" ? "Validating authorization request…" : "Authorizing…"}
        </Typography>
      </Box>
    );
  }

  // Error
  if (state.kind === "error") {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh" bgcolor="grey.50">
        <Card sx={{ maxWidth: 420, width: "100%", mx: 2 }}>
          <CardContent sx={{ p: 4 }}>
            <Typography variant="h5" textAlign="center" gutterBottom fontWeight={600}>
              Authorization Error
            </Typography>
            <Alert severity="error" sx={{ mb: 2 }}>
              {state.message}
            </Alert>
            <Typography variant="body2" textAlign="center" color="text.secondary">
              You can close this tab and try again from your application.
            </Typography>
          </CardContent>
        </Card>
      </Box>
    );
  }

  // Not logged in
  if (state.kind === "not-logged-in") {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh" bgcolor="grey.50">
        <Card sx={{ maxWidth: 420, width: "100%", mx: 2 }}>
          <CardContent sx={{ p: 4 }}>
            <Typography variant="h4" component="h1" textAlign="center" gutterBottom fontWeight={600}>
              CASFA
            </Typography>
            <Typography variant="body2" textAlign="center" color="text.secondary" mb={3}>
              Login required to authorize this application.
            </Typography>
            <Button
              variant="contained"
              size="large"
              fullWidth
              onClick={handleLogin}
              sx={{ textTransform: "none", py: 1.5 }}
            >
              Log in to CASFA
            </Button>
          </CardContent>
        </Card>
      </Box>
    );
  }

  // Approved (redirecting)
  if (state.kind === "approved") {
    return (
      <Box display="flex" flexDirection="column" justifyContent="center" alignItems="center" minHeight="100vh" gap={2}>
        <CheckCircleOutlineIcon sx={{ fontSize: 48, color: "success.main" }} />
        <Typography variant="h6" fontWeight={600}>
          Authorized!
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Redirecting back to your application…
        </Typography>
      </Box>
    );
  }

  // Consent form
  const { info } = state;
  return (
    <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh" bgcolor="grey.50">
      <Card sx={{ maxWidth: 460, width: "100%", mx: 2 }}>
        <CardContent sx={{ p: 4 }}>
          <Typography variant="h4" component="h1" textAlign="center" gutterBottom fontWeight={600}>
            CASFA
          </Typography>
          <Typography variant="body2" textAlign="center" color="text.secondary" mb={1}>
            Authorization Request
          </Typography>

          <Divider sx={{ my: 2 }} />

          <Box display="flex" alignItems="center" gap={1} mb={2}>
            <SecurityIcon color="primary" />
            <Typography variant="body1">
              <strong>{info.client.clientName || info.client.clientId}</strong>
              {" "}wants to access your CASFA account
            </Typography>
          </Box>

          <Typography variant="subtitle2" color="text.secondary" mb={1}>
            This application is requesting the following permissions:
          </Typography>

          <List dense sx={{ mb: 2 }}>
            {info.scopes.map((scope) => (
              <ListItem key={scope.name} sx={{ px: 1 }}>
                <ListItemIcon sx={{ minWidth: 32 }}>
                  <CheckCircleOutlineIcon fontSize="small" color="primary" />
                </ListItemIcon>
                <ListItemText
                  primary={
                    <Box display="flex" alignItems="center" gap={1}>
                      <Chip label={scope.name} size="small" variant="outlined" color="primary" />
                    </Box>
                  }
                  secondary={scope.description}
                />
              </ListItem>
            ))}
          </List>

          <Divider sx={{ my: 2 }} />

          <Stack direction="row" spacing={2}>
            <Button
              variant="outlined"
              size="large"
              fullWidth
              onClick={handleDeny}
              sx={{ textTransform: "none", py: 1.5 }}
            >
              Deny
            </Button>
            <Button
              variant="contained"
              size="large"
              fullWidth
              onClick={handleApprove}
              sx={{ textTransform: "none", py: 1.5 }}
            >
              Authorize
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
