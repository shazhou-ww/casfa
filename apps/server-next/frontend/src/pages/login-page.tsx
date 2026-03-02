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
import { useAuthStore } from "../stores/auth-store";
import {
  generateCodeVerifier,
  saveCodeVerifier,
  computeCodeChallenge,
} from "../lib/pkce";

type OAuthConfig = {
  domain: string;
  clientId: string;
};

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnUrl = searchParams.get("returnUrl") ?? "/";
  const setUser = useAuthStore((s) => s.setUser);
  const setAuthTypeInStore = useAuthStore((s) => s.setAuthType);
  const setToken = useAuthStore((s) => s.setToken);
  const [config, setConfig] = useState<OAuthConfig | null>(null);
  const [authType, setAuthType] = useState<"mock" | "cognito" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
        const res = await fetch("/api/oauth/config");
        if (res.ok) {
          const data = await res.json();
          setConfig({ domain: data.domain, clientId: data.clientId });
        } else {
          setError("OAuth 未配置或无法加载配置");
        }
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

const redirectUri = `${window.location.origin}/oauth/callback`;

/** When returnUrl is long (e.g. MCP authorize URL), we store it here and pass a short state to Cognito to avoid truncation/mangling that causes "State does not match". */
const COGNITO_STATE_PREFIX = "casfa_return_";
const RETURN_URL_KEY = "casfa_oauth_return_url";

  const buildAuthUrl = (identityProvider: string, codeChallenge?: string, returnUrl?: string) => {
    if (!config) return "#";
    const params = new URLSearchParams({
      client_id: config.clientId,
      response_type: "code",
      scope: "openid email profile",
      redirect_uri: redirectUri,
      identity_provider: identityProvider,
    });
    if (codeChallenge) {
      params.set("code_challenge", codeChallenge);
      params.set("code_challenge_method", "S256");
    }
    // Preserve returnUrl: use short state + sessionStorage to avoid Cognito truncating long URLs (causes "State does not match" on second step)
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
    return `https://${config.domain}/oauth2/authorize?${params.toString()}`;
  };

  const handleOAuthClick = async (identityProvider: string) => {
    if (!config) return;
    const verifier = generateCodeVerifier();
    saveCodeVerifier(verifier);
    const codeChallenge = await computeCodeChallenge(verifier);
    window.location.href = buildAuthUrl(identityProvider, codeChallenge, returnUrl);
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
      setAuthTypeInStore("mock");
      setToken(token);
      const meRes = await fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } });
      if (!meRes.ok) {
        setError("Failed to get user");
        return;
      }
      const me = (await meRes.json()) as { userId?: string; name?: string; email?: string };
      setUser({
        userId: me.userId ?? "unknown",
        name: me.name,
        email: me.email,
      });
      navigate(returnUrl, { replace: true });
    } catch {
      setError("Sign in failed");
    }
  };

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

          {authType === "cognito" && config ? (
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
                onClick={() => handleOAuthClick("Google")}
                sx={{ textTransform: "none", py: 1.5 }}
              >
                Continue with Google
              </Button>

              <Button
                variant="outlined"
                size="large"
                fullWidth
                startIcon={<MicrosoftIcon />}
                onClick={() => handleOAuthClick("Microsoft")}
                sx={{ textTransform: "none", py: 1.5 }}
              >
                Continue with Microsoft
              </Button>
            </Stack>
          ) : authType === "cognito" && !error ? (
            <Alert severity="warning">
              OAuth is not configured on this server. Please set Cognito environment variables.
            </Alert>
          ) : null}
        </CardContent>
      </Card>
    </Box>
  );
}
