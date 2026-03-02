import { Box, CircularProgress, Typography } from "@mui/material";
import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuthStore } from "../stores/auth-store";

/**
 * OAuth callback: read code/token from URL and complete login.
 * Phase A: stub — if code present set mock user; else try sessionStorage (handled by initialize).
 */
export function OAuthCallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const setUser = useAuthStore((s) => s.setUser);

  useEffect(() => {
    const code = searchParams.get("code");
    if (code) {
      // Stub: no backend exchange yet; set mock user and go home
      setUser({
        userId: "oauth-mock-user",
        name: "OAuth User",
        email: "oauth@example.com",
      });
      navigate("/", { replace: true });
      return;
    }
    // No code: redirect to login after short delay
    const t = setTimeout(() => navigate("/login", { replace: true }), 1500);
    return () => clearTimeout(t);
  }, [searchParams, setUser, navigate]);

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
