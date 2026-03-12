import { CssBaseline, createTheme, ThemeProvider } from "@mui/material";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";

const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#09090b", contrastText: "#ffffff" },
    secondary: { main: "#71717a", contrastText: "#ffffff" },
    background: { default: "#fafafa", paper: "#ffffff" },
    text: { primary: "#09090b", secondary: "#71717a" },
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: 14,
  },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { textTransform: "none" as const, fontWeight: 500 } },
    },
  },
});

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root");

function resolveBasename(): string {
  const seg = window.location.pathname.split("/").filter(Boolean)[0];
  return seg ? `/${seg}` : "/";
}

createRoot(rootEl).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter
        basename={resolveBasename()}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <App />
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>
);
