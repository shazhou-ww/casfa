/**
 * Layout — main application shell with top bar and sidebar.
 *
 * - Top bar: app title, user info, logout button
 * - Sidebar: depot list with create button, depot switching
 * - Main area: child routes (depot list or file browser)
 */

import AddIcon from "@mui/icons-material/Add";
import FolderIcon from "@mui/icons-material/Folder";
import LogoutIcon from "@mui/icons-material/Logout";
import StorageIcon from "@mui/icons-material/Storage";
import {
  AppBar,
  Box,
  Button,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Tooltip,
  Typography,
} from "@mui/material";
import { useEffect } from "react";
import { Outlet, useNavigate, useParams } from "react-router-dom";
import { useAuthStore } from "../stores/auth-store.ts";
import { useDepotStore } from "../stores/depot-store.ts";

const DRAWER_WIDTH = 260;

export function Layout() {
  const navigate = useNavigate();
  const { depotId } = useParams();
  const { user, logout } = useAuthStore();
  const { depots, currentDepot, fetchDepots, selectDepot } = useDepotStore();

  useEffect(() => {
    fetchDepots();
  }, [fetchDepots]);

  // Sync URL depot param with store
  useEffect(() => {
    if (depotId && depots.length > 0) {
      const match = depots.find((d) => d.depotId === depotId);
      if (match && match.depotId !== currentDepot?.depotId) {
        selectDepot(match);
      }
    }
  }, [depotId, depots, currentDepot, selectDepot]);

  const handleDepotClick = (depot: (typeof depots)[0]) => {
    selectDepot(depot);
    navigate(`/depot/${encodeURIComponent(depot.depotId)}`);
  };

  return (
    <Box sx={{ display: "flex", height: "100vh" }}>
      {/* Top App Bar */}
      <AppBar position="fixed" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}>
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

      {/* Sidebar */}
      <Drawer
        variant="permanent"
        sx={{
          width: DRAWER_WIDTH,
          flexShrink: 0,
          "& .MuiDrawer-paper": {
            width: DRAWER_WIDTH,
            boxSizing: "border-box",
          },
        }}
      >
        <Toolbar /> {/* Spacer for AppBar */}
        <Box sx={{ overflow: "auto", flex: 1 }}>
          <Box
            sx={{
              p: 2,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <Typography variant="subtitle2" color="text.secondary">
              Depots
            </Typography>
            <Tooltip title="Create new depot">
              <IconButton size="small" onClick={() => navigate("/")}>
                <AddIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
          <Divider />
          <List dense>
            {depots.map((depot) => (
              <ListItemButton
                key={depot.depotId}
                selected={currentDepot?.depotId === depot.depotId}
                onClick={() => handleDepotClick(depot)}
              >
                <ListItemIcon sx={{ minWidth: 36 }}>
                  <FolderIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText
                  primary={depot.title || depot.depotId}
                  primaryTypographyProps={{
                    noWrap: true,
                    fontSize: "0.875rem",
                  }}
                />
              </ListItemButton>
            ))}
            {depots.length === 0 && (
              <Box px={2} py={1}>
                <Typography variant="body2" color="text.secondary">
                  No depots yet
                </Typography>
              </Box>
            )}
          </List>
        </Box>
        <Divider />
        <Box sx={{ p: 1.5 }}>
          <Button
            fullWidth
            variant="outlined"
            size="small"
            startIcon={<AddIcon />}
            onClick={() => navigate("/")}
            sx={{ textTransform: "none" }}
          >
            Manage Depots
          </Button>
        </Box>
      </Drawer>

      {/* Main Content */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <Toolbar /> {/* Spacer for AppBar */}
        <Box sx={{ flex: 1, overflow: "auto", p: 3 }}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
}
