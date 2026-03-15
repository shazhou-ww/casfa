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

const SW_CONTROLLER_RELOAD_ONCE_KEY = "agent.sw.controller.reload.once";
let swRegisterInFlight = false;

function ensureSwScopePath(): boolean {
  if (typeof window === "undefined") return true;
  const basename = resolveBasename();
  if (basename === "/") return true;
  if (window.location.pathname !== basename) return true;
  const target = new URL(window.location.href);
  target.pathname = `${basename}/`;
  window.location.replace(target.toString());
  return false;
}

function registerServiceWorker() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  if (swRegisterInFlight) return;
  swRegisterInFlight = true;
  const basename = resolveBasename();
  // Always request .js so dev/prod both match frontend route config.
  const url = `${basename}/sw.js`;
  // Script is served at /<mount>/sw.js, so max allowed scope is /<mount>/.
  const scope = `${basename}/`;
  const runPostRegisterSteps = (_registration: ServiceWorkerRegistration) => {
    if (navigator.serviceWorker.controller) {
      try {
        window.sessionStorage.removeItem(SW_CONTROLLER_RELOAD_ONCE_KEY);
      } catch {
        // ignore storage access issues
      }
    } else {
      try {
        if (window.sessionStorage.getItem(SW_CONTROLLER_RELOAD_ONCE_KEY) !== "1") {
          window.sessionStorage.setItem(SW_CONTROLLER_RELOAD_ONCE_KEY, "1");
          window.location.reload();
        }
      } catch {
        // ignore storage access issues
      }
    }
  };

  navigator.serviceWorker
    .register(url, { scope, type: "module" })
    .then((registration) => {
      runPostRegisterSteps(registration);
    })
    .catch(() => {})
    .finally(() => {
      swRegisterInFlight = false;
    });
}

function Root() {
  const [ready, setReady] = useState(false);
  const setSwPort = useAgentStore((s) => s.setSwPort);
  const fetchThreads = useAgentStore((s) => s.fetchThreads);
  const fetchSettings = useAgentStore((s) => s.fetchSettings);

  useEffect(() => {
    if (!ensureSwScopePath()) return;
    registerServiceWorker();
    initAuth()
      .then(() => setReady(true))
      .catch(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!ready) return;
    let disposed = false;
    const connectAndSync = () => {
      connectToSW(getCsrfTokenFromCookie())
        .then((port) => {
          if (disposed) {
            try {
              port.close();
            } catch {
              // ignore close errors on stale reconnect
            }
            return;
          }
          setSwPort(port);
          void fetchThreads().catch(() => {});
          void fetchSettings().catch(() => {});
        })
        .catch(() => {});
    };

    connectAndSync();

    const onControllerChange = () => {
      connectAndSync();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    return () => {
      disposed = true;
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, [ready, setSwPort, fetchThreads, fetchSettings]);

  if (!ready) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
        <CircularProgress />
      </Box>
    );
  }
  return (
    <BrowserRouter
      basename={resolveBasename()}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
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
