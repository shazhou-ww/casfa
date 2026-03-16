import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import LogoutIcon from "@mui/icons-material/Logout";
import SettingsIcon from "@mui/icons-material/Settings";
import StorageIcon from "@mui/icons-material/Storage";
import { Box, Button, Menu, MenuItem, Snackbar, Typography } from "@mui/material";
import { useCallback, useState } from "react";
import { Link, Outlet, useNavigate } from "react-router-dom";
import { authClient, useCurrentUser, withMountPath } from "../lib/auth";
import { SidebarTree } from "./explorer/sidebar-tree";

const SIDEBAR_WIDTH = 260;

export function Layout() {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [copied, setCopied] = useState(false);

  const handleOpenMenu = useCallback((e: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(e.currentTarget);
  }, []);

  const handleCloseMenu = useCallback(() => setAnchorEl(null), []);

  const handleCopyUserId = useCallback(() => {
    if (user?.userId) {
      navigator.clipboard.writeText(user.userId);
      setCopied(true);
    }
  }, [user?.userId]);

  const handleSettings = useCallback(() => {
    handleCloseMenu();
    navigate("/settings");
  }, [navigate, handleCloseMenu]);

  const handleLogout = useCallback(() => {
    handleCloseMenu();
    void authClient.logout().catch(() => {
      window.location.href = withMountPath("/oauth/logout");
    });
  }, [handleCloseMenu]);

  const displayName = user ? user.name || user.email || user.userId : "";

  return (
    <Box sx={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      {/* Left sidebar */}
      <Box
        sx={{
          width: SIDEBAR_WIDTH,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          borderRight: 1,
          borderColor: "divider",
          bgcolor: "background.paper",
        }}
      >
        {/* Fixed top: Branding */}
        <Box
          component={Link}
          to="/files"
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            px: 2,
            py: 2,
            textDecoration: "none",
            color: "text.primary",
            "&:hover": { bgcolor: "action.hover" },
          }}
        >
          <StorageIcon sx={{ fontSize: 24 }} />
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            CASFA
          </Typography>
        </Box>

        {/* Middle: folder tree only */}
        <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <SidebarTree />
        </Box>

        {/* Fixed bottom: Profile */}
        <Box sx={{ flexShrink: 0, p: 1, borderTop: 1, borderColor: "divider" }}>
          {user && (
            <>
              <Button
                fullWidth
                color="inherit"
                onClick={handleOpenMenu}
                endIcon={<KeyboardArrowDownIcon />}
                sx={{
                  justifyContent: "flex-start",
                  textTransform: "none",
                  fontSize: "0.8125rem",
                }}
              >
                {displayName}
              </Button>
              <Menu
                anchorEl={anchorEl}
                open={Boolean(anchorEl)}
                onClose={handleCloseMenu}
                anchorOrigin={{ vertical: "top", horizontal: "right" }}
                transformOrigin={{ vertical: "bottom", horizontal: "right" }}
              >
                {user?.email && (
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
                    {user?.userId}
                  </Typography>
                  <ContentCopyIcon sx={{ fontSize: 14, opacity: 0.6 }} />
                </MenuItem>
                <MenuItem dense onClick={handleSettings}>
                  <SettingsIcon sx={{ fontSize: 16, mr: 1 }} />
                  <Typography variant="body2">Settings</Typography>
                </MenuItem>
                <MenuItem dense onClick={handleLogout}>
                  <LogoutIcon sx={{ fontSize: 16, mr: 1 }} />
                  <Typography variant="body2">Sign out</Typography>
                </MenuItem>
              </Menu>
            </>
          )}
        </Box>
      </Box>

      {/* Right: main content */}
      <Box
        component="main"
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          overflow: "hidden",
        }}
      >
        <Outlet />
      </Box>

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
