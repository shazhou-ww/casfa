import { Box, CircularProgress, CssBaseline, createTheme, ThemeProvider } from "@mui/material";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App.tsx";
import { initAuth } from "./lib/auth.ts";

const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#09090b" },
    secondary: { main: "#71717a" },
    background: { default: "#ffffff", paper: "#ffffff" },
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  },
});

function Root() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    initAuth()
      .then(() => setReady(true))
      .catch(() => setReady(true));
  }, []);
  if (!ready) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
        <CircularProgress />
      </Box>
    );
  }
  return (
    <BrowserRouter>
      <App />
    </BrowserRouter>
  );
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root");

createRoot(rootEl).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Root />
    </ThemeProvider>
  </StrictMode>
);
