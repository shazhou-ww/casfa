import { Box, CircularProgress } from "@mui/material";
import { useEffect } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useAuthStore } from "../stores/auth-store";

const LOG = "[AuthGuard]";
if (typeof console !== "undefined") console.log(LOG, "module loaded");

export function AuthGuard() {
  const { initialized, isLoggedIn, loading, initialize } = useAuthStore();

  console.log(LOG, "render", { initialized, loading, isLoggedIn });

  useEffect(() => {
    initialize();
  }, [initialize]);

  if (!initialized || loading) {
    console.log(LOG, "→ show loading");
    return (
      <Box
        display="flex"
        justifyContent="center"
        alignItems="center"
        minHeight="100vh"
      >
        <CircularProgress />
      </Box>
    );
  }

  if (!isLoggedIn) {
    console.log(LOG, "→ redirect to /login");
    return <Navigate to="/login" replace />;
  }

  console.log(LOG, "→ render Outlet");
  return <Outlet />;
}
