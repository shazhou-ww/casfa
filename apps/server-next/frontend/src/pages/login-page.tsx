import { Box, Typography } from "@mui/material";
import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";

/** SSO only: redirect to backend /oauth/login (which redirects to SSO). */
export function LoginPage() {
  const [searchParams] = useSearchParams();
  const returnUrl = searchParams.get("returnUrl") ?? searchParams.get("return_url") ?? "/";

  useEffect(() => {
    const url = `/oauth/login?return_url=${encodeURIComponent(
      returnUrl.startsWith("/") ? `${window.location.origin}${returnUrl}` : returnUrl
    )}`;
    window.location.replace(url);
  }, [returnUrl]);

  return (
    <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
      <Typography color="text.secondary">Redirecting to sign in…</Typography>
    </Box>
  );
}
