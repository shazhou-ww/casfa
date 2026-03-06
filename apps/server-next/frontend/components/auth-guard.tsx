import { Box, CircularProgress } from "@mui/material";
import { Navigate, Outlet } from "react-router-dom";
import { useCookieAuthCheck } from "../lib/auth";

export function AuthGuard() {
  const { loading, isLoggedIn } = useCookieAuthCheck();

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
        <CircularProgress />
      </Box>
    );
  }
  if (!isLoggedIn) {
    const returnUrl = encodeURIComponent(window.location.href);
    return <Navigate to={`/oauth/login?return_url=${returnUrl}`} replace />;
  }

  return <Outlet />;
}
