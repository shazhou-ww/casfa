import { Box, CircularProgress, Typography } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuthStore } from "../stores/auth-store";
import { getAndClearCodeVerifier } from "../lib/pkce";

/**
 * Decode JWT payload without verification (token came from our backend).
 */
function decodeJwtPayload(token: string): { sub?: string; name?: string; email?: string } {
  try {
    const payload = token.split(".")[1];
    if (!payload) return {};
    const decoded = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const raw = JSON.parse(decoded) as Record<string, unknown>;
    return {
      sub: typeof raw.sub === "string" ? raw.sub : undefined,
      name:
        typeof raw.name === "string"
          ? raw.name
          : typeof raw["cognito:username"] === "string"
            ? raw["cognito:username"]
            : undefined,
      email: typeof raw.email === "string" ? raw.email : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * OAuth callback: exchange code for tokens, store token and user, then redirect home.
 */
export function OAuthCallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const setToken = useAuthStore((s) => s.setToken);
  const setUser = useAuthStore((s) => s.setUser);
  const setAuthType = useAuthStore((s) => s.setAuthType);
  const [error, setError] = useState<string | null>(null);
  const exchangeStarted = useRef(false);

  useEffect(() => {
    if (exchangeStarted.current) return;
    const code = searchParams.get("code");
    if (!code) {
      const t = setTimeout(() => navigate("/login", { replace: true }), 1500);
      return () => clearTimeout(t);
    }
    exchangeStarted.current = true;
    const codeVerifier = getAndClearCodeVerifier();
    const redirectUri = `${window.location.origin}/oauth/callback`;
    (async () => {
      try {
        const body: { code: string; redirect_uri: string; code_verifier?: string } = {
          code,
          redirect_uri: redirectUri,
        };
        if (codeVerifier) body.code_verifier = codeVerifier;
        const res = await fetch("/api/oauth/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError((data as { message?: string }).message || `Token exchange failed (${res.status})`);
          return;
        }
        const data = (await res.json()) as {
          id_token?: string;
          access_token?: string;
        };
        const idToken = data.id_token ?? data.access_token;
        if (!idToken) {
          setError("No token in response");
          return;
        }
        setAuthType("cognito");
        setToken(idToken);
        const payload = decodeJwtPayload(idToken);
        const userId = payload.sub ?? "unknown";
        setUser({
          userId,
          name: payload.name ?? undefined,
          email: payload.email ?? undefined,
        });
        // Redirect to state (returnUrl) if present and safe, else home (e.g. from MCP OAuth flow: /oauth/authorize?...)
        const state = searchParams.get("state");
        let target = "/";
        if (state) {
          if (state.startsWith("casfa_return_")) {
            try {
              const stored = sessionStorage.getItem("casfa_oauth_return_url");
              if (stored && stored.startsWith("/") && !stored.startsWith("//")) {
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
      } catch (e) {
        setError(e instanceof Error ? e.message : "Sign-in failed");
      }
    })();
  }, [searchParams, setToken, setUser, setAuthType, navigate]);

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
