import { Box, Card, CardContent, Tab, Tabs, Typography } from "@mui/material";
import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";
import { LoginForm } from "./login-form";
import { RegisterForm } from "./register-form";

export function LoginPage() {
  const { isAuthenticated } = useAuth();
  const [tab, setTab] = useState(0);

  if (isAuthenticated) {
    return <Navigate to="/files" replace />;
  }

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        bgcolor: "background.default",
      }}
    >
      <Card sx={{ width: 400, maxWidth: "90vw" }}>
        <CardContent sx={{ p: 4 }}>
          <Typography variant="h4" align="center" gutterBottom sx={{ fontWeight: 700 }}>
            CASFA
          </Typography>
          <Typography variant="body2" align="center" color="text.secondary" sx={{ mb: 3 }}>
            Content-Addressable Storage for Agents
          </Typography>
          <Tabs value={tab} onChange={(_, v) => setTab(v)} centered sx={{ mb: 3 }}>
            <Tab label="Login" />
            <Tab label="Register" />
          </Tabs>
          {tab === 0 ? <LoginForm /> : <RegisterForm onSuccess={() => setTab(0)} />}
        </CardContent>
      </Card>
    </Box>
  );
}
