import FolderIcon from "@mui/icons-material/Folder";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import {
  Box,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import type { FsEntry } from "../../types/api";

type DirectoryTreeProps = {
  currentPath: string;
  onPathChange: (path: string) => void;
  /** Mock: when true, use static mock data instead of API */
  useMock?: boolean;
};

function formatPath(path: string): string[] {
  if (!path || path === "/") return [];
  return path.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
}

const MOCK_ENTRIES: FsEntry[] = [
  { name: "Documents", path: "/Documents", isDirectory: true },
  { name: "Projects", path: "/Projects", isDirectory: true },
  { name: "readme.txt", path: "/readme.txt", isDirectory: false, size: 1024 },
];

async function fetchList(path: string, useMock: boolean): Promise<FsEntry[]> {
  if (useMock) {
    if (!path || path === "/") {
      return MOCK_ENTRIES;
    }
    // Subfolder mock
    const base = path.replace(/^\/+|\/+$/g, "") || "root";
    return [
      { name: "subfolder", path: `${path}/subfolder`, isDirectory: true },
      { name: "file.txt", path: `${path}/file.txt`, isDirectory: false, size: 512 },
    ];
  }
  const q = path ? `?path=${encodeURIComponent(path)}` : "";
  const res = await fetch(`/api/fs/entries${q}`);
  if (!res.ok) throw new Error("Failed to list directory");
  const data = await res.json();
  return data.entries ?? [];
}

export function DirectoryTree({
  currentPath,
  onPathChange,
  useMock = true,
}: DirectoryTreeProps) {
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const pathParts = formatPath(currentPath);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchList(currentPath || "/", useMock)
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
  }, [currentPath, useMock]);

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

  return (
    <Box display="flex" flexDirection="column" height="100%" overflow="hidden">
      {/* Breadcrumb */}
      <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: "divider" }}>
        <IconButton size="small" onClick={() => handleBreadcrumb(-1)} aria-label="Root">
          <Typography variant="body2" color="primary">/</Typography>
        </IconButton>
        {pathParts.map((part, i) => (
          <Typography
            key={i}
            component="span"
            variant="body2"
            sx={{
              cursor: "pointer",
              "&:hover": { textDecoration: "underline" },
              color: "text.secondary",
            }}
            onClick={() => handleBreadcrumb(i)}
          >
            /{part}
          </Typography>
        ))}
      </Box>

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
                  secondary={
                    !entry.isDirectory && entry.size != null
                      ? `${(entry.size / 1024).toFixed(1)} KB`
                      : undefined
                  }
                />
              </ListItemButton>
            ))}
          </List>
        )}
      </Box>
    </Box>
  );
}
