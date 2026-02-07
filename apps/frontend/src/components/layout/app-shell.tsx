import { Box, Toolbar } from "@mui/material";
import { Outlet } from "react-router-dom";
import { DRAWER_WIDTH, Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";

export function AppShell() {
  return (
    <Box sx={{ display: "flex" }}>
      <TopBar />
      <Sidebar />
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: 3,
          width: `calc(100% - ${DRAWER_WIDTH}px)`,
          minHeight: "100vh",
        }}
      >
        <Toolbar />
        <Outlet />
      </Box>
    </Box>
  );
}
