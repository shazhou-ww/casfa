import { Navigate, Route, Routes } from "react-router-dom";
import { AuthGuard } from "./components/auth-guard";
import { Layout } from "./components/layout";
import { ExplorerPage } from "./pages/explorer-page";
import { LoginPage } from "./pages/login-page";
import { SettingsPage } from "./pages/settings-page";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<AuthGuard />}>
        <Route element={<Layout />}>
          <Route path="/" element={<ExplorerPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/delegates" element={<SettingsPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
