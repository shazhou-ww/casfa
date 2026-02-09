import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import LogoutIcon from "@mui/icons-material/Logout";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Stack,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getClient, resetClient } from "../lib/client.ts";

type UserInfo = {
  userId: string;
  email: string;
  name?: string;
  role: string;
};

export function SuccessPage() {
  const navigate = useNavigate();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const client = await getClient();
        const state = client.getState();

        // If no user token, redirect to login
        if (!state.user) {
          navigate("/login", { replace: true });
          return;
        }

        const result = await client.oauth.getMe();
        if (cancelled) return;

        if (result.ok) {
          setUser(result.data as UserInfo);
        } else {
          setError("Failed to fetch user info.");
        }
      } catch {
        if (!cancelled) setError("Failed to connect to server.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const handleLogout = async () => {
    try {
      const client = await getClient();
      client.logout();
    } catch {
      // ignore
    }
    resetClient();
    navigate("/login", { replace: true });
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh" bgcolor="grey.50">
      <Card sx={{ maxWidth: 480, width: "100%", mx: 2 }}>
        <CardContent sx={{ p: 4 }}>
          {error ? (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          ) : (
            <Stack spacing={3} alignItems="center">
              <CheckCircleIcon color="success" sx={{ fontSize: 64 }} />

              <Typography variant="h5" fontWeight={600}>
                Login Successful
              </Typography>

              <Alert severity="success" sx={{ width: "100%" }}>
                You have been authenticated successfully.
              </Alert>

              {user?.role === "unauthorized" && (
                <Alert severity="warning" sx={{ width: "100%" }}>
                  Your account is pending approval. Please contact an administrator to get access.
                </Alert>
              )}

              {user && (
                <Box sx={{ width: "100%", bgcolor: "grey.50", borderRadius: 1, p: 2 }}>
                  <Stack spacing={1}>
                    {user.email && (
                      <Typography variant="body2">
                        <strong>Email:</strong> {user.email}
                      </Typography>
                    )}
                    {user.name && (
                      <Typography variant="body2">
                        <strong>Name:</strong> {user.name}
                      </Typography>
                    )}
                    <Typography variant="body2">
                      <strong>User ID:</strong>{" "}
                      <Typography component="code" variant="body2" sx={{ fontSize: "0.85em" }}>
                        {user.userId}
                      </Typography>
                    </Typography>
                    <Typography variant="body2">
                      <strong>Role:</strong> {user.role}
                    </Typography>
                  </Stack>
                </Box>
              )}

              <Button
                variant="outlined"
                color="inherit"
                startIcon={<LogoutIcon />}
                onClick={handleLogout}
                sx={{ textTransform: "none" }}
              >
                Sign out
              </Button>
            </Stack>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
