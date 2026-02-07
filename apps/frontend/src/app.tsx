import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/auth-context";
import { LoadingSpinner } from "./components/common/loading-spinner";
import { ProtectedRoute } from "./components/common/protected-route";
import { AppShell } from "./components/layout/app-shell";
import { AdminPage } from "./pages/admin/admin-page";
import { AuthorizePage } from "./pages/authorize/authorize-page";
import { DepotsPage } from "./pages/depots/depots-page";
import { FilesPage } from "./pages/files/files-page";
import { LoginPage } from "./pages/login/login-page";
import { TokensPage } from "./pages/tokens/tokens-page";

export function App() {
  const { isLoading } = useAuth();

  if (isLoading) {
    return <LoadingSpinner fullScreen />;
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/authorize/:requestId" element={<AuthorizePage />} />
      <Route
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route path="/files/*" element={<FilesPage />} />
        <Route path="/depots" element={<DepotsPage />} />
        <Route path="/tokens" element={<TokensPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/" element={<Navigate to="/files" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
