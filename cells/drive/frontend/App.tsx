import { Navigate, Route, Routes } from "react-router-dom";
import { DelegateOAuthConsentPage } from "@casfa/cell-delegates-webui";
import { AuthGuard } from "./components/auth-guard";
import { Layout } from "./components/layout";
import { ExplorerPage } from "./pages/explorer-page";
import { LoginPage } from "./pages/login-page";
import { OAuthCallbackPage } from "./pages/oauth-callback-page";
import { OAuthConsentPage } from "./pages/oauth-consent-page";
import { SettingsPage } from "./pages/settings-page";
import { apiFetch, useCookieAuthCheck, withMountPath } from "./lib/auth";

const SCOPE_DESCRIPTIONS: Record<string, string> = {
  use_mcp: "使用 MCP 接口",
  file_read: "读取文件",
  file_write: "写入文件",
  branch_manage: "管理分支",
  manage_delegates: "管理授权",
};

function DelegateOAuthAuthorizeRoute() {
  const { loading, isLoggedIn } = useCookieAuthCheck();
  return (
    <DelegateOAuthConsentPage
      authorizeUrl={withMountPath("/api/oauth/delegate/authorize")}
      loginUrl={withMountPath("/api/oauth/login")}
      clientInfoUrl={withMountPath("/api/oauth")}
      loading={loading}
      isLoggedIn={isLoggedIn}
      fetch={apiFetch}
      scopeDescriptions={SCOPE_DESCRIPTIONS}
    />
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/oauth/login" element={<LoginPage />} />
      <Route path="/oauth/authorize" element={<DelegateOAuthAuthorizeRoute />} />
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
