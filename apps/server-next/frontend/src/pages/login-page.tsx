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
import { useNavigate } from "react-router-dom";
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
  const setUser = useAuthStore((s) => s.setUser);
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

  const buildAuthUrl = (identityProvider: string, codeChallenge?: string) => {
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
    return `https://${config.domain}/oauth2/authorize?${params.toString()}`;
  };

  const handleOAuthClick = async (identityProvider: string) => {
    if (!config) return;
    const verifier = generateCodeVerifier();
    saveCodeVerifier(verifier);
    const codeChallenge = await computeCodeChallenge(verifier);
    window.location.href = buildAuthUrl(identityProvider, codeChallenge);
  };

  const handleSignInMock = () => {
    setUser({
      userId: "mock-user-1",
      name: "Mock User",
      email: "mock@example.com",
    });
    navigate("/", { replace: true });
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
