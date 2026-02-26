/**
 * Layout — application shell with top bar only.
 *
 * - Top bar: app title, user info (with copyable user ID), logout button
 * - Main area: full-width child routes (explorer)
 */

import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import LogoutIcon from "@mui/icons-material/Logout";
import SettingsIcon from "@mui/icons-material/Settings";
import StorageIcon from "@mui/icons-material/Storage";
import { AppBar, Box, Button, Menu, MenuItem, Snackbar, Toolbar, Typography } from "@mui/material";
import { useCallback, useState } from "react";
import { Outlet } from "react-router-dom";
import { useAuthStore } from "../stores/auth-store.ts";
import { SettingsDialog } from "./settings-dialog.tsx";

export function Layout() {
  const { user, logout } = useAuthStore();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [copied, setCopied] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const handleOpenMenu = useCallback((e: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(e.currentTarget);
  }, []);

  const handleCloseMenu = useCallback(() => {
    setAnchorEl(null);
  }, []);

  const handleCopyUserId = useCallback(() => {
    if (user?.userId) {
      navigator.clipboard.writeText(user.userId);
      setCopied(true);
    }
  }, [user?.userId]);

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
              <Button
                color="inherit"
                onClick={handleOpenMenu}
                endIcon={<KeyboardArrowDownIcon />}
                sx={{ textTransform: "none" }}
              >
                {user.name || user.email || user.userId}
              </Button>
              <Menu
                anchorEl={anchorEl}
                open={Boolean(anchorEl)}
                onClose={handleCloseMenu}
                anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
                transformOrigin={{ vertical: "top", horizontal: "right" }}
              >
                {user.email && (
                  <MenuItem dense disabled>
                    <Typography variant="body2">{user.email}</Typography>
                  </MenuItem>
                )}
                <MenuItem dense onClick={handleCopyUserId}>
                  <Typography
                    variant="body2"
                    component="code"
                    sx={{ fontSize: "0.8em", mr: 1, fontFamily: "monospace" }}
                  >
                    {user.userId}
                  </Typography>
                  <ContentCopyIcon sx={{ fontSize: 14, opacity: 0.6 }} />
                </MenuItem>
                <MenuItem dense disabled>
                  <Typography variant="body2" sx={{ textTransform: "capitalize" }}>
                    Role: {user.role}
                  </Typography>
                </MenuItem>
                <MenuItem
                  dense
                  onClick={() => {
                    handleCloseMenu();
                    setSettingsOpen(true);
                  }}
                >
                  <SettingsIcon sx={{ fontSize: 16, mr: 1 }} />
                  <Typography variant="body2">Settings</Typography>
                </MenuItem>
                <MenuItem dense onClick={logout}>
                  <LogoutIcon sx={{ fontSize: 16, mr: 1 }} />
                  <Typography variant="body2">Sign out</Typography>
                </MenuItem>
              </Menu>
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

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <Snackbar
        open={copied}
        autoHideDuration={2000}
        onClose={() => setCopied(false)}
        message="User ID copied"
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </Box>
  );
}
