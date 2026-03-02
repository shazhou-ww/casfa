import FolderIcon from "@mui/icons-material/Folder";
import StorageIcon from "@mui/icons-material/Storage";
import { Box, ListItemButton, ListItemIcon, ListItemText } from "@mui/material";
import { useCallback } from "react";
import { useExplorerNavigate } from "../../hooks/use-explorer-navigate";
import { useExplorerStore } from "../../stores/explorer-store";

function formatPath(path: string): string[] {
  if (!path || path === "/") return [];
  return path.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
}

const INDENT_PER_LEVEL = 2; // theme spacing units

/**
 * Sidebar tree: path hierarchy only (Root + path segments).
 * Root is a special node with distinct style; children are indented.
 */
export function SidebarTree() {
  const currentPath = useExplorerStore((s) => s.currentPath);
  const setPath = useExplorerNavigate();
  const pathParts = formatPath(currentPath);

  const handleRoot = useCallback(() => setPath("/"), [setPath]);

  const handlePathPart = useCallback(
    (index: number) => {
      const p = "/" + pathParts.slice(0, index + 1).join("/");
      setPath(p);
    },
    [pathParts, setPath]
  );

  return (
    <Box sx={{ flex: 1, overflow: "auto", minHeight: 0 }}>
      <Box sx={{ px: 1, py: 0.5 }}>
        <ListItemButton
          dense
          selected={pathParts.length === 0}
          onClick={handleRoot}
          sx={{ borderRadius: 1, minHeight: 32, pl: 1.5 }}
        >
          <ListItemIcon sx={{ minWidth: 28 }}>
            <StorageIcon sx={{ fontSize: 18 }} color="action" />
          </ListItemIcon>
          <ListItemText
            primary="Root"
            primaryTypographyProps={{ variant: "body2", fontWeight: 600 }}
          />
        </ListItemButton>
        {pathParts.map((part, i) => (
          <ListItemButton
            key={i}
            dense
            selected={i === pathParts.length - 1}
            onClick={() => handlePathPart(i)}
            sx={{
              pl: 1.5 + (i + 1) * INDENT_PER_LEVEL,
              borderRadius: 1,
              minHeight: 32,
            }}
          >
            <ListItemIcon sx={{ minWidth: 28 }}>
              <FolderIcon sx={{ fontSize: 18 }} color="action" />
            </ListItemIcon>
            <ListItemText
              primary={part}
              primaryTypographyProps={{ variant: "body2" }}
            />
          </ListItemButton>
        ))}
      </Box>
    </Box>
  );
}
