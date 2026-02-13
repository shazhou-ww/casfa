import { Alert, Box, CircularProgress, Typography } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { getClient } from "../lib/client.ts";

export function OAuthCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const exchangeStarted = useRef(false);

  useEffect(() => {
    // Prevent double execution in React StrictMode (auth code is single-use)
    if (exchangeStarted.current) return;
    exchangeStarted.current = true;

    (async () => {
      const code = searchParams.get("code");
      const oauthError = searchParams.get("error");
      const errorDescription = searchParams.get("error_description");

      if (oauthError) {
        setError(errorDescription || oauthError);
        return;
      }

      if (!code) {
        setError("No authorization code received.");
        return;
      }

      try {
        // Use the AppClient so tokens are persisted through the correct
        // store (IndexedDB in SW mode, localStorage in direct mode).
        // The SW now always has a base client, so RPC calls work even
        // before authentication.
        const redirectUri = `${window.location.origin}/oauth/callback`;
        const client = await getClient();
        const result = await client.oauth.exchangeCode(code, redirectUri);

        if (result.ok) {
          // Re-create the internal CasfaClient with realm = userId.
          // In SW mode this sends "set-user-token" RPC so the SW's
          // client gets the correct realm for /api/realm/:realm/* calls.
          // In direct mode this re-creates the main-thread client.
          await client.setUserToken(result.data.userId);
          navigate("/", { replace: true });
        } else {
          setError(result.error.message || "Token exchange failed.");
        }
      } catch {
        setError("An unexpected error occurred during login.");
      }
    })();
  }, [searchParams, navigate]);

  if (error) {
    return (
      <Box
        display="flex"
        justifyContent="center"
        alignItems="center"
        minHeight="100vh"
        bgcolor="grey.50"
      >
        <Box maxWidth={420} width="100%" mx={2}>
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
          <Typography variant="body2" textAlign="center">
            <a href="/login">Back to login</a>
          </Typography>
        </Box>
      </Box>
    );
  }

  return (
    <Box
      display="flex"
      flexDirection="column"
      justifyContent="center"
      alignItems="center"
      minHeight="100vh"
      gap={2}
    >
      <CircularProgress />
      <Typography variant="body2" color="text.secondary">
        Completing sign in...
      </Typography>
    </Box>
  );
}
