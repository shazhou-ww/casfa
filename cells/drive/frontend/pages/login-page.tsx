import { Box, Typography } from "@mui/material";
import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { redirectToLoginOnce } from "../lib/auth";

/** SSO only: redirect to backend /api/oauth/login (which redirects to SSO). */
export function LoginPage() {
  const [searchParams] = useSearchParams();
  const returnUrl = searchParams.get("returnUrl") ?? searchParams.get("return_url") ?? "/";

  useEffect(() => {
    const resolvedReturnUrl = returnUrl.startsWith("/")
      ? `${window.location.origin}${returnUrl}`
      : returnUrl;
    redirectToLoginOnce(resolvedReturnUrl);
  }, [returnUrl]);

  return (
    <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
      <Typography color="text.secondary">Redirecting to sign in…</Typography>
    </Box>
  );
}
