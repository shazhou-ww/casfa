import { CssBaseline, createTheme, type Shadows, ThemeProvider } from "@mui/material";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./app.tsx";

const shadows: Shadows = [
  "none", // 0
  "none", // 1 — Card 等用 border 替代
  "none", // 2
  "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)", // 3 — 浮动指示器
  "none", // 4
  "none",
  "none",
  "none", // 5-7
  "0 4px 16px rgba(0,0,0,0.12), 0 2px 4px rgba(0,0,0,0.08)", // 8 — 拖拽预览
  "none",
  "none",
  "none",
  "none",
  "none",
  "none",
  "none", // 9-15
  "0 8px 32px rgba(0,0,0,0.14), 0 4px 8px rgba(0,0,0,0.10)", // 16 — Dialog
  "none",
  "none",
  "none",
  "none",
  "none",
  "none",
  "none", // 17-23
  "0 12px 48px rgba(0,0,0,0.18), 0 6px 12px rgba(0,0,0,0.12)", // 24 — 最高层级
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
    background: {
      default: "#ffffff",
      paper: "#ffffff",
    },
    text: {
      primary: "#09090b",
      secondary: "#71717a",
    },
    divider: "#e4e4e7",
    action: {
      hover: "rgba(0, 0, 0, 0.04)",
      selected: "rgba(0, 0, 0, 0.08)",
      focus: "rgba(0, 0, 0, 0.12)",
    },
  },

  shadows,

  shape: {
    borderRadius: 8,
  },

  typography: {
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    h4: { fontWeight: 700, letterSpacing: "-0.02em" },
    h5: { fontWeight: 600, letterSpacing: "-0.01em" },
    h6: { fontWeight: 600, letterSpacing: "-0.01em" },
    subtitle1: { fontWeight: 500 },
    body2: { lineHeight: 1.6 },
    caption: { letterSpacing: "0.01em" },
    button: { fontWeight: 500, letterSpacing: "0.01em" },
  },

  components: {
    MuiAppBar: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        colorPrimary: {
          backgroundColor: "#fafafa",
          color: "#09090b",
        },
        root: {
          borderBottom: "1px solid #e4e4e7",
        },
      },
    },

    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          border: "1px solid #e4e4e7",
        },
      },
    },

    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundImage: "none",
        },
      },
    },

    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          textTransform: "none" as const,
          fontWeight: 500,
        },
      },
    },

    MuiToolbar: {
      styleOverrides: {
        root: {
          minHeight: "52px !important",
        },
      },
    },

    MuiMenu: {
      defaultProps: {
        slotProps: {
          paper: { elevation: 3 },
        },
      },
      styleOverrides: {
        paper: {
          border: "1px solid #e4e4e7",
        },
      },
    },

    MuiDialog: {
      defaultProps: {
        PaperProps: { elevation: 16 },
      },
    },

    MuiDivider: {
      styleOverrides: {
        root: {
          borderColor: "#e4e4e7",
        },
      },
    },

    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: 8,
        },
      },
    },

    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          fontSize: "0.75rem",
          fontWeight: 500,
          borderRadius: 6,
        },
      },
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>
);
