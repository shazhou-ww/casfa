import GoogleIcon from "@mui/icons-material/Google";
import MicrosoftIcon from "@mui/icons-material/Window";
import RefreshIcon from "@mui/icons-material/Refresh";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  Stack,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { authClient, useAuth } from "../lib/auth";

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnUrl = searchParams.get("returnUrl") ?? "/";
  const auth = useAuth();
  const [authType, setAuthType] = useState<"cognito" | "mock" | null>(null);
  const [config, setConfig] = useState<{ authorizeUrl: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (auth) {
      navigate(returnUrl || "/", { replace: true });
    }
  }, [auth, navigate, returnUrl]);

  const loadConfig = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const infoRes = await fetch("/api/info");
      if (!infoRes.ok) {
        setLoading(false);
        return;
      }
      const info = (await infoRes.json()) as { authType?: string };
      const at = info.authType === "cognito" ? "cognito" : info.authType === "mock" ? "mock" : null;
      setAuthType(at);
      if (at === "cognito") {
        setConfig({
          authorizeUrl: `/oauth/authorize?redirect_uri=${encodeURIComponent(
            `${window.location.origin}/oauth/callback`
          )}&response_type=code&scope=openid+email+profile`,
        });
      }
    } catch {
      setError("无法连接服务");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const COGNITO_STATE_PREFIX = "casfa_return_";
  const RETURN_URL_KEY = "casfa_oauth_return_url";

  const buildAuthorizeUrl = (identityProvider: string) => {
    if (!config) return "#";
    const params = new URLSearchParams({
      redirect_uri: `${window.location.origin}/oauth/callback`,
      response_type: "code",
      scope: "openid email profile",
      identity_provider: identityProvider,
    });
    if (returnUrl && returnUrl.startsWith("/")) {
      if (returnUrl.length > 200) {
        const stateToken = COGNITO_STATE_PREFIX + Math.random().toString(36).slice(2, 14);
        try {
          sessionStorage.setItem(RETURN_URL_KEY, returnUrl);
          params.set("state", stateToken);
        } catch {
          params.set("state", returnUrl);
        }
      } else {
        params.set("state", returnUrl);
      }
    }
    return `/oauth/authorize?${params.toString()}`;
  };

  const handleSignInMock = async () => {
    try {
      const tokenRes = await fetch("/api/dev/mock-token");
      if (!tokenRes.ok) {
        setError("Failed to get mock token");
        return;
      }
      const data = (await tokenRes.json()) as { token?: string };
      const token = data.token ?? null;
      if (!token) {
        setError("No token in response");
        return;
      }
      authClient.setTokens(token, null);
      navigate(returnUrl, { replace: true });
    } catch {
      setError("Sign in failed");
    }
  };

  if (auth) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
        <CircularProgress />
      </Box>
    );
  }

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box
      display="flex"
      justifyContent="center"
      alignItems="center"
      minHeight="100vh"
      bgcolor="grey.50"
    >
      <Card sx={{ maxWidth: 420, width: "100%", mx: 2 }}>
        <CardContent sx={{ p: 4 }}>
          <Typography variant="h4" component="h1" textAlign="center" gutterBottom fontWeight={600}>
            CASFA
          </Typography>
          <Typography variant="body2" textAlign="center" color="text.secondary" mb={3}>
            Content-Addressable Storage for Agents
          </Typography>

          {error && (
            <Alert
              severity="error"
              sx={{ mb: 2 }}
              action={
                <Button color="inherit" size="small" startIcon={<RefreshIcon />} onClick={loadConfig}>
                  重试
                </Button>
              }
            >
              {error}
            </Alert>
          )}

          {authType === "mock" && (
            <Stack spacing={2}>
              <Button variant="contained" size="large" fullWidth onClick={handleSignInMock}>
                Sign in (mock)
              </Button>
            </Stack>
          )}

          {authType === "cognito" && config && (
            <Stack spacing={2}>
              <Divider>
                <Typography variant="body2" color="text.secondary">
                  Sign in with
                </Typography>
              </Divider>

              <Button
                variant="contained"
                size="large"
                fullWidth
                startIcon={<GoogleIcon />}
                href={buildAuthorizeUrl("Google")}
                sx={{ textTransform: "none", py: 1.5 }}
              >
                Continue with Google
              </Button>

              <Button
                variant="outlined"
                size="large"
                fullWidth
                startIcon={<MicrosoftIcon />}
                href={buildAuthorizeUrl("Microsoft")}
                sx={{ textTransform: "none", py: 1.5 }}
              >
                Continue with Microsoft
              </Button>
            </Stack>
          )}
          {authType === "cognito" && !config && !error && (
            <Alert severity="warning">
              OAuth is not configured on this server. Please set Cognito environment variables.
            </Alert>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
