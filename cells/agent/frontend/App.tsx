import { Navigate, Route, Routes } from "react-router-dom";
import { AuthGuard } from "./components/auth-guard.tsx";
import { Layout } from "./components/layout.tsx";
import { LoginPage } from "./pages/login-page.tsx";
import { OAuthCallbackPage } from "./pages/oauth-callback-page.tsx";
import { OAuthMcpCallbackPage } from "./pages/oauth-mcp-callback-page.tsx";
import { ChatPage } from "./pages/chat-page.tsx";
import { SettingsPage } from "./pages/settings-page.tsx";

export function App() {
  return (
    <Routes>
      <Route path="/oauth/login" element={<LoginPage />} />
      <Route path="/oauth/callback" element={<OAuthCallbackPage />} />
      <Route path="/oauth/mcp-callback" element={<OAuthMcpCallbackPage />} />
      <Route path="/login" element={<LoginPage />} />

      <Route element={<AuthGuard />}>
        <Route element={<Layout />}>
          <Route path="/" element={<ChatPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
