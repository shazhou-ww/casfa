import { Box, Button, Typography } from "@mui/material";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/auth-store";

export function LoginPage() {
  const navigate = useNavigate();
  const setUser = useAuthStore((s) => s.setUser);

  const handleSignIn = () => {
    setUser({
      userId: "mock-user-1",
      name: "Mock User",
      email: "mock@example.com",
    });
    navigate("/", { replace: true });
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
      <Button variant="contained" onClick={handleSignIn}>
        Sign in
      </Button>
    </Box>
  );
}
