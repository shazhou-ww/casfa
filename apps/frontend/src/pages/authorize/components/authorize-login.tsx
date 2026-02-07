import { Alert, Box, Button, Stack, TextField, Typography } from "@mui/material";
import { useCallback, useState } from "react";
import { useAuth } from "../../../auth/auth-context";

export function AuthorizeLogin() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  }, [email, password, login]);

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        p: 3,
      }}
    >
      <Box sx={{ maxWidth: 360, width: "100%" }}>
        <Typography variant="h5" sx={{ mb: 1, fontWeight: 600 }}>
          Sign In Required
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          You must sign in to approve this authorization request.
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Stack spacing={2}>
          <TextField
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            size="small"
            fullWidth
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmit();
            }}
          />
          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            size="small"
            fullWidth
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmit();
            }}
          />
          <Button
            variant="contained"
            onClick={handleSubmit}
            disabled={loading || !email || !password}
            fullWidth
          >
            {loading ? "Signing in..." : "Sign In"}
          </Button>
        </Stack>
      </Box>
    </Box>
  );
}
