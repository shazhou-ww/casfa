import { Box, CircularProgress, CssBaseline, createTheme, type Shadows, ThemeProvider } from "@mui/material";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { initAuth } from "./lib/auth";

const shadows: Shadows = [
  "none", // 0
  "none", // 1
  "none", // 2
  "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)", // 3
  "none",
  "none",
  "none",
  "none", // 4-7
  "0 4px 16px rgba(0,0,0,0.12), 0 2px 4px rgba(0,0,0,0.08)", // 8
  "none",
  "none",
  "none",
  "none",
  "none",
  "none",
  "none", // 9-15
  "0 8px 32px rgba(0,0,0,0.14), 0 4px 8px rgba(0,0,0,0.10)", // 16
  "none",
  "none",
  "none",
  "none",
  "none",
  "none",
  "none", // 17-23
  "0 12px 48px rgba(0,0,0,0.18), 0 6px 12px rgba(0,0,0,0.12)", // 24
];

const theme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: "#09090b",
      light: "#3f3f46",
      dark: "#000000",
      contrastText: "#ffffff",
    },
    secondary: {
      main: "#71717a",
      light: "#a1a1aa",
      dark: "#52525b",
      contrastText: "#ffffff",
    },
    error: { main: "#dc2626" },
    warning: { main: "#d97706" },
    info: { main: "#0284c7" },
    success: { main: "#059669" },
    background: { default: "#ffffff", paper: "#ffffff" },
    text: { primary: "#09090b", secondary: "#71717a" },
    divider: "#e4e4e7",
    action: {
      hover: "rgba(0, 0, 0, 0.04)",
      selected: "rgba(0, 0, 0, 0.08)",
      focus: "rgba(0, 0, 0, 0.12)",
    },
  },
  shadows,
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: 14,
    h4: { fontWeight: 700, letterSpacing: "-0.02em", fontSize: "1.5rem" },
    h5: { fontWeight: 600, letterSpacing: "-0.01em", fontSize: "1.25rem" },
    h6: { fontWeight: 600, letterSpacing: "-0.01em", fontSize: "1.125rem" },
    subtitle1: { fontWeight: 500, fontSize: "0.9375rem" },
    body1: { fontSize: "0.875rem" },
    body2: { lineHeight: 1.6, fontSize: "0.8125rem" },
    caption: { letterSpacing: "0.01em", fontSize: "0.75rem" },
    button: { fontWeight: 500, letterSpacing: "0.01em", fontSize: "0.875rem" },
  },
  components: {
    MuiAppBar: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        colorPrimary: {
          backgroundColor: "#fafafa",
          color: "#09090b",
        },
        root: { borderBottom: "1px solid #e4e4e7" },
      },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: { root: { border: "1px solid #e4e4e7" } },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: { root: { backgroundImage: "none" } },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { textTransform: "none" as const, fontWeight: 500 },
      },
    },
    MuiToolbar: {
      styleOverrides: { root: { minHeight: "52px !important" } },
    },
    MuiMenu: {
      defaultProps: { PaperProps: { elevation: 3 } },
      styleOverrides: { paper: { border: "1px solid #e4e4e7" } },
    },
    MuiDialog: {
      defaultProps: { PaperProps: { elevation: 16 } },
    },
    MuiDivider: {
      styleOverrides: { root: { borderColor: "#e4e4e7" } },
    },
    MuiSwitch: {
      styleOverrides: {
        root: {
          "& .MuiSwitch-track": {
            border: "1px solid #a1a1aa",
            backgroundColor: "#e4e4e7",
            opacity: 1,
          },
          "& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track": {
            border: "none",
            opacity: 1,
          },
          "& .MuiSwitch-switchBase.Mui-checked .MuiSwitch-thumb": {
            color: "#ffffff",
            boxShadow: "0 0 0 1px #a1a1aa",
          },
          "& .MuiSwitch-switchBase:not(.Mui-checked) .MuiSwitch-thumb": {
            boxShadow: "0 0 0 1px #a1a1aa",
          },
        },
      },
    },
    MuiAlert: {
      styleOverrides: { root: { borderRadius: 8 } },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: { fontSize: "0.75rem", fontWeight: 500, borderRadius: 6 },
      },
    },
  },
});

function Root() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    initAuth().then(() => setReady(true));
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
