import LogoutOutlined from "@mui/icons-material/LogoutOutlined";
import { AppBar, Box, Button, Toolbar, Typography } from "@mui/material";
import { useAuth } from "../../auth/auth-context";
import { DRAWER_WIDTH } from "./sidebar";

export function TopBar() {
  const { user, logout } = useAuth();

  return (
    <AppBar
      position="fixed"
      sx={{
        width: `calc(100% - ${DRAWER_WIDTH}px)`,
        ml: `${DRAWER_WIDTH}px`,
        bgcolor: "background.paper",
        boxShadow: 1,
      }}
    >
      <Toolbar>
        <Box sx={{ flex: 1 }} />
        <Typography variant="body2" sx={{ mr: 2, color: "text.secondary" }}>
          {user?.email ?? user?.name ?? user?.userId}
        </Typography>
        <Button
          size="small"
          startIcon={<LogoutOutlined />}
          onClick={logout}
          sx={{ color: "text.secondary" }}
        >
          Logout
        </Button>
      </Toolbar>
    </AppBar>
  );
}
