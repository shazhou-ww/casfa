/**
 * Layout — application shell with top bar only.
 *
 * - Top bar: app title, user info, logout button
 * - Main area: full-width child routes (explorer)
 */

import LogoutIcon from "@mui/icons-material/Logout";
import StorageIcon from "@mui/icons-material/Storage";
import {
  AppBar,
  Box,
  IconButton,
  Toolbar,
  Tooltip,
  Typography,
} from "@mui/material";
import { Outlet } from "react-router-dom";
import { useAuthStore } from "../stores/auth-store.ts";

export function Layout() {
  const { user, logout } = useAuthStore();

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      {/* Top App Bar */}
      <AppBar position="static">
        <Toolbar>
          <StorageIcon sx={{ mr: 1 }} />
          <Typography variant="h6" noWrap sx={{ flexGrow: 1 }}>
            CASFA
          </Typography>
          {user && (
            <Box display="flex" alignItems="center" gap={1}>
              <Typography variant="body2" sx={{ opacity: 0.9 }}>
                {user.name || user.email}
              </Typography>
              <Tooltip title="Sign out">
                <IconButton color="inherit" onClick={logout} size="small">
                  <LogoutIcon />
                </IconButton>
              </Tooltip>
            </Box>
          )}
        </Toolbar>
      </AppBar>

      {/* Main Content — full width, no sidebar */}
      <Box
        component="main"
        sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}
      >
        <Outlet />
      </Box>
    </Box>
  );
}
