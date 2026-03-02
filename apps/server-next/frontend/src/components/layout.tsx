import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import LogoutIcon from "@mui/icons-material/Logout";
import SettingsIcon from "@mui/icons-material/Settings";
import StorageIcon from "@mui/icons-material/Storage";
import {
  AppBar,
  Box,
  Button,
  Menu,
  MenuItem,
  Snackbar,
  Toolbar,
  Typography,
} from "@mui/material";
import { useCallback, useState } from "react";
import { useNavigate, Outlet } from "react-router-dom";
import { useAuthStore } from "../stores/auth-store";

export function Layout() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [copied, setCopied] = useState(false);

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

  const handleSettings = useCallback(() => {
    handleCloseMenu();
    navigate("/settings");
  }, [navigate, handleCloseMenu]);

  const handleLogout = useCallback(() => {
    handleCloseMenu();
    logout();
    navigate("/login", { replace: true });
  }, [logout, navigate, handleCloseMenu]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <AppBar position="static">
        <Toolbar>
          <StorageIcon sx={{ mr: 1 }} />
          <Typography variant="h6" noWrap>
            CASFA
          </Typography>
          <Box sx={{ flex: 1 }} />
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
                    sx={{
                      fontSize: "0.8em",
                      mr: 1,
                      fontFamily: "monospace",
                    }}
                  >
                    {user.userId}
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
            </Box>
          )}
        </Toolbar>
      </AppBar>

      <Box
        component="main"
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
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
