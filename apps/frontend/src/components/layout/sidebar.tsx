import AdminPanelSettingsOutlined from "@mui/icons-material/AdminPanelSettingsOutlined";
import FolderOutlined from "@mui/icons-material/FolderOutlined";
import StorageOutlined from "@mui/icons-material/StorageOutlined";
import VpnKeyOutlined from "@mui/icons-material/VpnKeyOutlined";
import {
  Box,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Typography,
} from "@mui/material";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";

const DRAWER_WIDTH = 240;

const navItems = [
  { label: "Files", icon: <FolderOutlined />, path: "/files" },
  { label: "Depots", icon: <StorageOutlined />, path: "/depots" },
  { label: "Tokens", icon: <VpnKeyOutlined />, path: "/tokens" },
];

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  return (
    <Drawer
      variant="permanent"
      sx={{
        width: DRAWER_WIDTH,
        flexShrink: 0,
        "& .MuiDrawer-paper": {
          width: DRAWER_WIDTH,
          boxSizing: "border-box",
          bgcolor: "background.paper",
        },
      }}
    >
      <Toolbar>
        <Typography variant="h6" noWrap sx={{ fontWeight: 700 }}>
          CASFA
        </Typography>
      </Toolbar>
      <Box sx={{ overflow: "auto", flex: 1 }}>
        <List>
          {navItems.map((item) => (
            <ListItemButton
              key={item.path}
              selected={location.pathname.startsWith(item.path)}
              onClick={() => navigate(item.path)}
            >
              <ListItemIcon>{item.icon}</ListItemIcon>
              <ListItemText primary={item.label} />
            </ListItemButton>
          ))}
          {user?.role === "admin" && (
            <ListItemButton
              selected={location.pathname.startsWith("/admin")}
              onClick={() => navigate("/admin")}
            >
              <ListItemIcon>
                <AdminPanelSettingsOutlined />
              </ListItemIcon>
              <ListItemText primary="Admin" />
            </ListItemButton>
          )}
        </List>
      </Box>
    </Drawer>
  );
}

export { DRAWER_WIDTH };
