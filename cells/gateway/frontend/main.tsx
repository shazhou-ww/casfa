import { Box, CircularProgress, CssBaseline, createTheme, ThemeProvider } from "@mui/material";
import { DelegateOAuthConsentPage } from "@casfa/cell-delegates-webui";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { App } from "./App";
import { apiFetch, getBaseUrl, initAuth, useCookieAuthCheck, withMountPath } from "./lib/auth";

const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#09090b" },
    secondary: { main: "#71717a" },
    background: { default: "#ffffff", paper: "#ffffff" },
    text: { primary: "#09090b", secondary: "#71717a" },
    divider: "#e4e4e7",
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: 14,
  },
  components: {
    MuiAppBar: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: { borderBottom: "1px solid #e4e4e7" },
      },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: { root: { backgroundImage: "none" } },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { textTransform: "none" },
      },
    },
  },
});

function Root() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    initAuth()
      .then(() => setReady(true))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (error) {
    return (
      <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center", p: 2 }}>
        {error}
      </Box>
    );
  }

  if (!ready) {
    return (
      <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <BrowserRouter basename={resolveBasename()}>
      <Routes>
        <Route path="/oauth/authorize" element={<DelegateOAuthAuthorizeRoute />} />
        <Route path="*" element={<App />} />
      </Routes>
    </BrowserRouter>
  );
}

const SCOPE_DESCRIPTIONS: Record<string, string> = {
  use_mcp: "Use MCP interface",
  manage_delegates: "Manage delegates",
};

function DelegateOAuthAuthorizeRoute() {
  const { loading, isLoggedIn } = useCookieAuthCheck();
  return (
    <DelegateOAuthConsentPage
      authorizeUrl={withMountPath("/api/oauth/delegate/authorize")}
      loginUrl={withMountPath("/oauth/login")}
      clientInfoUrl={getBaseUrl() ?? ""}
      loading={loading}
      isLoggedIn={isLoggedIn}
      fetch={apiFetch}
      scopeDescriptions={SCOPE_DESCRIPTIONS}
    />
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
