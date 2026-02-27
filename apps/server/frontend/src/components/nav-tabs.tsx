/**
 * NavTabs — top-level navigation tabs for switching between app sections.
 *
 * Renders a centered segmented control with subtle active indicator.
 */

import FolderIcon from "@mui/icons-material/Folder";
import KeyIcon from "@mui/icons-material/Key";
import { Box, ButtonBase, Typography } from "@mui/material";
import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";

interface NavItem {
  label: string;
  icon: React.ReactNode;
  path: string;
  match: (pathname: string) => boolean;
}

const navItems: NavItem[] = [
  {
    label: "Explorer",
    icon: <FolderIcon sx={{ fontSize: 18 }} />,
    path: "/",
    match: (p) => p === "/" || p.startsWith("/depot"),
  },
  {
    label: "Delegates",
    icon: <KeyIcon sx={{ fontSize: 18 }} />,
    path: "/delegates",
    match: (p) => p.startsWith("/delegates"),
  },
];

export function NavTabs() {
  const navigate = useNavigate();
  const location = useLocation();

  const handleNavigate = useCallback(
    (path: string) => {
      navigate(path);
    },
    [navigate],
  );

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: "2px",
        p: "3px",
        borderRadius: "10px",
        bgcolor: "rgba(0, 0, 0, 0.04)",
        border: "1px solid",
        borderColor: "divider",
      }}
    >
      {navItems.map((item) => {
        const active = item.match(location.pathname);
        return (
          <ButtonBase
            key={item.path}
            onClick={() => handleNavigate(item.path)}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.75,
              px: 2,
              py: 0.625,
              borderRadius: "7px",
              transition: "all 0.15s ease",
              bgcolor: active ? "#fff" : "transparent",
              boxShadow: active
                ? "0 1px 3px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04)"
                : "none",
              "&:hover": {
                bgcolor: active ? "#fff" : "rgba(0, 0, 0, 0.04)",
              },
            }}
          >
            <Box
              sx={{
                display: "flex",
                color: active ? "text.primary" : "text.secondary",
                transition: "color 0.15s ease",
              }}
            >
              {item.icon}
            </Box>
            <Typography
              variant="body2"
              sx={{
                fontWeight: active ? 600 : 450,
                fontSize: "0.8125rem",
                color: active ? "text.primary" : "text.secondary",
                lineHeight: 1,
                letterSpacing: "0.01em",
                transition: "all 0.15s ease",
                userSelect: "none",
              }}
            >
              {item.label}
            </Typography>
          </ButtonBase>
        );
      })}
    </Box>
  );
}
