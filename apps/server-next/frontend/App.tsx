import { Navigate, Route, Routes } from "react-router-dom";
import { AuthGuard } from "./components/auth-guard";
import { Layout } from "./components/layout";
import { ExplorerPage } from "./pages/explorer-page";
import { LoginPage } from "./pages/login-page";
import { OAuthAuthorizePage } from "./pages/oauth-authorize-page";
import { OAuthCallbackPage } from "./pages/oauth-callback-page";
import { OAuthConsentPage } from "./pages/oauth-consent-page";
import { SettingsPage } from "./pages/settings-page";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/oauth/login" element={<LoginPage />} />
      <Route path="/oauth/authorize" element={<OAuthAuthorizePage />} />
      <Route path="/oauth/callback" element={<OAuthCallbackPage />} />
      <Route path="/oauth/callback-complete" element={<OAuthCallbackPage />} />

      <Route element={<AuthGuard />}>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/files" replace />} />
          <Route path="/files" element={<ExplorerPage />} />
          <Route path="/files/*" element={<ExplorerPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/delegates" element={<SettingsPage />} />
          <Route path="/settings/storage" element={<SettingsPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/files" replace />} />
    </Routes>
  );
}
