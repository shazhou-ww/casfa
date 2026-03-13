import { Box, Typography } from "@mui/material";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

/** SSO redirects back to return_url; no token exchange on this cell. */
export function OAuthCallbackPage() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate("/", { replace: true });
  }, [navigate]);
  return (
    <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
      <Typography color="text.secondary">Redirecting…</Typography>
    </Box>
  );
}
