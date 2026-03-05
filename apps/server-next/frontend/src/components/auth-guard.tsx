import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../lib/auth";

export function AuthGuard() {
  const auth = useAuth();

  if (!auth) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
