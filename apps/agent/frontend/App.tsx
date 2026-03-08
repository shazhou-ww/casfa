import { Box, Typography } from "@mui/material";
import { Navigate, Route, Routes } from "react-router-dom";
import { AuthGuard } from "./components/auth-guard.tsx";
import { Layout } from "./components/layout.tsx";
import { LoginPage } from "./pages/login-page.tsx";
import { OAuthCallbackPage } from "./pages/oauth-callback-page.tsx";

function PlaceholderChatPage() {
  return (
    <Box p={2}>
      <Typography variant="h6">Chat</Typography>
      <Typography color="text.secondary">Select or create a thread. (Task 9 will add full chat UI.)</Typography>
    </Box>
  );
}

function PlaceholderSettingsPage() {
  return (
    <Box p={2}>
      <Typography variant="h6">Settings</Typography>
      <Typography color="text.secondary">LLM providers and preferences. (Task 8 will add settings UI.)</Typography>
    </Box>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/oauth/login" element={<LoginPage />} />
      <Route path="/oauth/callback" element={<OAuthCallbackPage />} />
      <Route path="/login" element={<LoginPage />} />

      <Route element={<AuthGuard />}>
        <Route element={<Layout />}>
          <Route path="/" element={<PlaceholderChatPage />} />
          <Route path="/settings" element={<PlaceholderSettingsPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
