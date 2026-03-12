import { Box, CircularProgress, CssBaseline, createTheme, ThemeProvider } from "@mui/material";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App.tsx";
import { initAuth } from "./lib/auth.ts";
import { connectToSW, getCsrfTokenFromCookie } from "./lib/sw-protocol.ts";
import { useAgentStore } from "./stores/agent-store.ts";

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

function registerServiceWorker() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const basename = resolveBasename();
  const url = import.meta.env.DEV ? `${basename}/sw.ts` : `${basename}/sw.js`;
  navigator.serviceWorker.register(url, { scope: `${basename}/`, type: "module" }).catch(() => {});
}

function Root() {
  const [ready, setReady] = useState(false);
  const setSwPort = useAgentStore((s) => s.setSwPort);
  const fetchThreads = useAgentStore((s) => s.fetchThreads);
  const fetchSettings = useAgentStore((s) => s.fetchSettings);

  useEffect(() => {
    registerServiceWorker();
    initAuth()
      .then(() => setReady(true))
      .catch(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!ready) return;
    connectToSW(getCsrfTokenFromCookie())
      .then((port) => {
        setSwPort(port);
        fetchThreads();
        fetchSettings();
      })
      .catch(() => {});
  }, [ready, setSwPort, fetchThreads, fetchSettings]);

  if (!ready) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
        <CircularProgress />
      </Box>
    );
  }
  return (
    <BrowserRouter basename={resolveBasename()}>
      <App />
    </BrowserRouter>
  );
}

function resolveBasename(): string {
  const seg = window.location.pathname.split("/").filter(Boolean)[0];
  return seg ? `/${seg}` : "/";
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
