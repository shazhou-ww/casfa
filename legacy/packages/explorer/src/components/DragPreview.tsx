/**
 * <DragPreview /> - Overlay shown while dragging items.
 * (Iter 4)
 *
 * Shows icon + name for single item, or "N items" badge for multi-drag.
 */

import FolderIcon from "@mui/icons-material/Folder";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import { Badge, Box, Paper, Typography } from "@mui/material";
import type { ExplorerItem } from "../types.ts";

type DragPreviewProps = {
  items: ExplorerItem[];
};

export function DragPreview({ items }: DragPreviewProps) {
  if (items.length === 0) return null;

  const first = items[0]!;

  if (items.length === 1) {
    return (
      <Paper
        elevation={8}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 2,
          py: 1,
          maxWidth: 240,
          opacity: 0.9,
          pointerEvents: "none",
        }}
      >
        {first.isDirectory ? (
          <FolderIcon fontSize="small" sx={{ color: "#f59e0b" }} />
        ) : (
          <InsertDriveFileIcon fontSize="small" color="action" />
        )}
        <Typography variant="body2" noWrap>
          {first.name}
        </Typography>
      </Paper>
    );
  }

  return (
    <Badge badgeContent={items.length} color="primary">
      <Paper
        elevation={8}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 2,
          py: 1,
          maxWidth: 240,
          opacity: 0.9,
          pointerEvents: "none",
        }}
      >
        <Box sx={{ display: "flex", mr: -0.5 }}>
          <InsertDriveFileIcon fontSize="small" color="action" />
          <InsertDriveFileIcon fontSize="small" color="action" sx={{ ml: -1, opacity: 0.6 }} />
        </Box>
        <Typography variant="body2">{items.length} items</Typography>
      </Paper>
    </Badge>
  );
}
