import { Box, Button, Typography } from "@mui/material";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/auth-store";

const OAUTH_AUTHORIZE_URL = "/api/oauth/authorize";

export function LoginPage() {
  const navigate = useNavigate();
  const setUser = useAuthStore((s) => s.setUser);

  const handleSignInMock = () => {
    setUser({
      userId: "mock-user-1",
      name: "Mock User",
      email: "mock@example.com",
    });
    navigate("/", { replace: true });
  };

  const handleSignInOAuth = () => {
    const redirectUri = `${window.location.origin}/oauth/callback`;
    const url = `${OAUTH_AUTHORIZE_URL}?redirect_uri=${encodeURIComponent(redirectUri)}`;
    window.location.href = url;
  };

  return (
    <Box
      display="flex"
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      minHeight="100vh"
      gap={2}
    >
      <Typography variant="h5">Login</Typography>
      <Button variant="contained" onClick={handleSignInMock}>
        Sign in (mock)
      </Button>
      <Button variant="outlined" onClick={handleSignInOAuth}>
        Sign in with OAuth
      </Button>
    </Box>
  );
}
