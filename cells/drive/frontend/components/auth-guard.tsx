import { Box, CircularProgress } from "@mui/material";
import { Navigate, Outlet } from "react-router-dom";
import { buildLoginRedirectUrl, useCookieAuthCheck } from "../lib/auth";

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
    return <Navigate to={buildLoginRedirectUrl(window.location.href)} replace />;
  }

  return <Outlet />;
}
