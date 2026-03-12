import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import LogoutIcon from "@mui/icons-material/Logout";
import SettingsIcon from "@mui/icons-material/Settings";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import { Box, Button, Menu, MenuItem, Typography } from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import { Link, Outlet, useNavigate } from "react-router-dom";
import { useCurrentUser, withMountPath } from "../lib/auth.ts";
import { useAgentStore } from "../stores/agent-store.ts";
import { ThreadList } from "./chat/thread-list.tsx";

export function Layout() {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const fetchSettings = useAgentStore((s) => s.fetchSettings);
  const fetchThreads = useAgentStore((s) => s.fetchThreads);
  const swPort = useAgentStore((s) => s.swPort);

  const refreshFromSw = useCallback(() => {
    void fetchSettings().catch(() => {});
    void fetchThreads().catch(() => {});
  }, [fetchSettings, fetchThreads]);

  useEffect(() => {
    if (!swPort) return;
    refreshFromSw();
  }, [swPort, refreshFromSw]);

  useEffect(() => {
    if (!swPort) return;
    const onFocus = () => {
      refreshFromSw();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [swPort, refreshFromSw]);

  const handleOpenMenu = useCallback((e: React.MouseEvent<HTMLElement>) => setAnchorEl(e.currentTarget), []);
  const handleCloseMenu = useCallback(() => setAnchorEl(null), []);
  const handleSettings = useCallback(() => {
    handleCloseMenu();
    navigate("/settings");
  }, [navigate, handleCloseMenu]);
  const handleLogout = useCallback(() => {
    handleCloseMenu();
    window.location.href = withMountPath("/oauth/logout");
  }, [handleCloseMenu]);

  const displayName = user ? user.email || user.userId : "";

  return (
    <Box sx={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      <Box
        sx={{
          width: 260,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          borderRight: 1,
          borderColor: "divider",
          bgcolor: "background.paper",
        }}
      >
        <Box
          component={Link}
          to="/"
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
          <SmartToyIcon sx={{ fontSize: 24 }} />
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            Agent
          </Typography>
        </Box>

        <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <ThreadList />
        </Box>

        <Box sx={{ flexShrink: 0, p: 1, borderTop: 1, borderColor: "divider" }}>
          {user && (
            <>
              <Button
                fullWidth
                color="inherit"
                onClick={handleOpenMenu}
                endIcon={<KeyboardArrowDownIcon />}
                sx={{ justifyContent: "flex-start", textTransform: "none", fontSize: "0.8125rem" }}
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

      <Box component="main" sx={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
        <Outlet />
      </Box>
    </Box>
  );
}
