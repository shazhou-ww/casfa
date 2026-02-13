import GoogleIcon from "@mui/icons-material/Google";
import RefreshIcon from "@mui/icons-material/Refresh";
import MicrosoftIcon from "@mui/icons-material/Window";
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

type CognitoConfig = {
  domain: string;
  clientId: string;
};

export function LoginPage() {
  const [config, setConfig] = useState<CognitoConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadConfig = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      // Direct fetch — bypass AppClient/SW since this is a public endpoint
      // and the SW may not have a CasfaClient yet (user is not authenticated).
      const res = await fetch("/api/oauth/config");
      if (res.ok) {
        const data = await res.json();
        setConfig({ domain: data.domain, clientId: data.clientId });
      } else {
        setError("Failed to load OAuth configuration.");
      }
    } catch {
      setError("Failed to connect to server.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const redirectUri = `${window.location.origin}/oauth/callback`;

  const buildAuthUrl = (identityProvider: string) => {
    if (!config) return "#";
    const params = new URLSearchParams({
      client_id: config.clientId,
      response_type: "code",
      scope: "openid email profile",
      redirect_uri: redirectUri,
      identity_provider: identityProvider,
    });
    return `https://${config.domain}/oauth2/authorize?${params.toString()}`;
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
                <Button
                  color="inherit"
                  size="small"
                  startIcon={<RefreshIcon />}
                  onClick={loadConfig}
                >
                  Retry
                </Button>
              }
            >
              {error}
            </Alert>
          )}

          {config ? (
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
                href={buildAuthUrl("Google")}
                sx={{ textTransform: "none", py: 1.5 }}
              >
                Continue with Google
              </Button>

              <Button
                variant="outlined"
                size="large"
                fullWidth
                startIcon={<MicrosoftIcon />}
                href={buildAuthUrl("Microsoft")}
                sx={{ textTransform: "none", py: 1.5 }}
              >
                Continue with Microsoft
              </Button>
            </Stack>
          ) : !error ? (
            <Alert severity="warning">
              OAuth is not configured on this server. Please set Cognito environment variables.
            </Alert>
          ) : null}
        </CardContent>
      </Card>
    </Box>
  );
}
