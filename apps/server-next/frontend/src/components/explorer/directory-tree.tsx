import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import FolderIcon from "@mui/icons-material/Folder";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import {
  Box,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import { fetchList } from "../../lib/fs-api";
import type { FsEntry } from "../../types/api";

type DirectoryTreeProps = {
  currentPath: string;
  onPathChange: (path: string) => void;
};

function formatPath(path: string): string[] {
  if (!path || path === "/") return [];
  return path.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
}

async function fetchListForTree(path: string): Promise<FsEntry[]> {
  return fetchList(path);
}

export function DirectoryTree({
  currentPath,
  onPathChange,
}: DirectoryTreeProps) {
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const pathParts = formatPath(currentPath);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchListForTree(currentPath || "/")
      .then((list) => {
        if (!cancelled) setEntries(list);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentPath]);

  const handleBreadcrumb = useCallback(
    (index: number) => {
      if (index < 0) {
        onPathChange("/");
        return;
      }
      const p = "/" + pathParts.slice(0, index + 1).join("/");
      onPathChange(p);
    },
    [pathParts, onPathChange]
  );

  const handleEntryClick = useCallback(
    (entry: FsEntry) => {
      if (entry.isDirectory) {
        onPathChange(entry.path || "/");
      }
    },
    [onPathChange]
  );

  const handleUp = useCallback(() => {
    if (pathParts.length === 0) return;
    if (pathParts.length === 1) {
      onPathChange("/");
      return;
    }
    const parent = "/" + pathParts.slice(0, -1).join("/");
    onPathChange(parent);
  }, [pathParts, onPathChange]);

  return (
    <Box display="flex" flexDirection="column" height="100%" overflow="hidden">
      {/* Toolbar: Up + breadcrumb (path segments only; root = no leading "/") */}
      <Toolbar
        variant="dense"
        disableGutters
        sx={{
          borderBottom: 1,
          borderColor: "divider",
          minHeight: 40,
          px: 1,
          gap: 0.5,
        }}
      >
        <IconButton
          size="small"
          onClick={handleUp}
          disabled={pathParts.length === 0}
          aria-label="Up to parent"
          sx={{ mr: 0.5 }}
        >
          <ArrowUpwardIcon fontSize="small" />
        </IconButton>
        {pathParts.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            /
          </Typography>
        ) : (
          pathParts.map((part, i) => (
            <Typography
              key={i}
              component="span"
              variant="body2"
              sx={{
                cursor: "pointer",
                "&:hover": { textDecoration: "underline" },
                color: i === pathParts.length - 1 ? "text.primary" : "text.secondary",
              }}
              onClick={() => handleBreadcrumb(i)}
            >
              {i > 0 ? " / " : ""}{part}
            </Typography>
          ))
        )}
      </Toolbar>

      {/* List */}
      <Box sx={{ flex: 1, overflow: "auto" }}>
        {loading && (
          <Box display="flex" justifyContent="center" py={4}>
            <Typography variant="body2" color="text.secondary">
              Loading…
            </Typography>
          </Box>
        )}
        {error && (
          <Box py={2} px={2}>
            <Typography variant="body2" color="error">
              {error}
            </Typography>
          </Box>
        )}
        {!loading && !error && entries.length === 0 && (
          <Box py={4} px={2} textAlign="center">
            <Typography variant="body2" color="text.secondary">
              Empty folder
            </Typography>
          </Box>
        )}
        {!loading && !error && entries.length > 0 && (
          <List dense disablePadding>
            {entries.map((entry) => (
              <ListItemButton
                key={entry.path}
                onClick={() => handleEntryClick(entry)}
                disabled={!entry.isDirectory}
              >
                <ListItemIcon sx={{ minWidth: 36 }}>
                  {entry.isDirectory ? (
                    <FolderIcon color="action" />
                  ) : (
                    <InsertDriveFileIcon color="action" />
                  )}
                </ListItemIcon>
                <ListItemText
                  primary={entry.name}
                  primaryTypographyProps={{ variant: "body2" }}
                  secondary={
                    !entry.isDirectory && entry.size != null
                      ? `${(entry.size / 1024).toFixed(1)} KB`
                      : undefined
                  }
                  secondaryTypographyProps={{ variant: "caption" }}
                />
              </ListItemButton>
            ))}
          </List>
        )}
      </Box>
    </Box>
  );
}
