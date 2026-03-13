import { Box, CircularProgress, Typography } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { authClient, withMountPath } from "../lib/auth";
import { getAndClearCodeVerifier } from "../lib/pkce";

/**
 * OAuth callback: exchange code for tokens via POST /oauth/token, store in authClient, then redirect.
 * Served at both /oauth/callback and /oauth/callback-complete (Cognito Hosted UI uses callback-complete).
 */
export function OAuthCallbackPage(): JSX.Element {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const exchangeStarted = useRef(false);
  const redirectUri = `${window.location.origin}${window.location.pathname}`;

  useEffect(() => {
    if (exchangeStarted.current) return;
    const code = searchParams.get("code");
    if (!code) {
      const t = setTimeout(() => navigate("/oauth/login", { replace: true }), 1500);
      return () => clearTimeout(t);
    }
    exchangeStarted.current = true;
    const codeVerifier = getAndClearCodeVerifier();

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    });
    if (codeVerifier) body.set("code_verifier", codeVerifier);

    fetch(withMountPath("/oauth/token"), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(
            (data as { message?: string }).message || `Token exchange failed (${res.status})`
          );
          return;
        }
        const data = (await res.json()) as {
          id_token?: string;
          access_token?: string;
          refresh_token?: string | null;
        };
        const token = data.id_token ?? data.access_token;
        if (!token) {
          setError("No token in response.");
          return;
        }
        authClient.setTokens(token, data.refresh_token ?? null);
        const state = searchParams.get("state");
        let target = "/";
        if (state) {
          if (state.startsWith("casfa_return_")) {
            try {
              const stored = sessionStorage.getItem("casfa_oauth_return_url");
              if (stored?.startsWith("/") && !stored.startsWith("//")) {
                target = stored;
                sessionStorage.removeItem("casfa_oauth_return_url");
              }
            } catch {
              /* ignore */
            }
          } else if (state.startsWith("/") && !state.startsWith("//")) {
            target = state;
          }
        }
        navigate(target, { replace: true });
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Sign-in failed"));
  }, [searchParams, navigate, redirectUri]);

  if (error) {
    return (
      <Box
        display="flex"
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
        minHeight="100vh"
        gap={2}
      >
        <Typography color="error">{error}</Typography>
        <Typography variant="body2" color="text.secondary">
          Redirecting to login…
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      display="flex"
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      minHeight="100vh"
      gap={2}
    >
      <CircularProgress />
      <Typography variant="body2" color="text.secondary">
        Completing sign in…
      </Typography>
    </Box>
  );
}
