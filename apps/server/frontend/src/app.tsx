import { Navigate, Route, Routes } from "react-router-dom";
import { AuthGuard } from "./components/auth-guard.tsx";
import { Layout } from "./components/layout.tsx";
import { ExplorerPage } from "./pages/explorer-page.tsx";
import { LoginPage } from "./pages/login-page.tsx";
import { OAuthCallbackPage } from "./pages/oauth-callback.tsx";

export function App() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/oauth/callback" element={<OAuthCallbackPage />} />

      {/* Protected routes — require authentication */}
      <Route element={<AuthGuard />}>
        <Route element={<Layout />}>
          <Route path="/" element={<ExplorerPage />} />
          <Route path="/depot/:depotId" element={<ExplorerPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
