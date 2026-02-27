/**
 * ViewerPickerDialog — select a viewer for "Open with" functionality.
 *
 * Fetches available viewers from AppClient.viewers.listAll() and displays
 * them in a dialog. Viewers whose contentTypes match the target item are
 * shown first; others are shown in a "More viewers" section.
 */

import OpenInBrowserIcon from "@mui/icons-material/OpenInBrowser";
import VisibilityIcon from "@mui/icons-material/Visibility";
import {
  Avatar,
  Chip,
  Dialog,
  DialogTitle,
  Divider,
  IconButton,
  List,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { useCallback, useEffect, useState } from "react";
import type { ViewerInfo } from "@casfa/client-bridge";

// ============================================================================
// Helpers
// ============================================================================

/** Build icon URL from viewer icon path */
function viewerIconUrl(viewer: ViewerInfo): string | null {
  return viewer.icon
    ? `/page/${encodeURIComponent(viewer.nodeKey)}/${encodeURIComponent(viewer.icon)}`
    : null;
}

/**
 * Check if a content type matches a pattern.
 * Supports exact match and wildcard (e.g. "image/*" matches "image/png").
 */
function matchContentType(pattern: string, contentType: string): boolean {
  if (pattern === contentType) return true;
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -1); // "image/*" → "image/"
    return contentType.startsWith(prefix);
  }
  return false;
}

function viewerMatchesContentType(viewer: ViewerInfo, contentType: string | null): boolean {
  if (!contentType || viewer.contentTypes.length === 0) return false;
  return viewer.contentTypes.some((pattern) => matchContentType(pattern, contentType));
}

// ============================================================================
// Viewer list item
// ============================================================================

function ViewerListItem({
  viewer,
  onSelect,
}: {
  viewer: ViewerInfo;
  onSelect: (v: ViewerInfo) => void;
}) {
  const iconSrc = viewerIconUrl(viewer);
  return (
    <ListItemButton onClick={() => onSelect(viewer)}>
      <ListItemAvatar>
        {iconSrc ? (
          <Avatar src={iconSrc} variant="rounded" />
        ) : (
          <Avatar sx={{ bgcolor: viewer.isBuiltin ? "primary.main" : "secondary.main" }}>
            {viewer.isBuiltin ? <VisibilityIcon /> : <OpenInBrowserIcon />}
          </Avatar>
        )}
      </ListItemAvatar>
      <ListItemText
        primary={viewer.name}
        secondaryTypographyProps={{ component: "div" }}
        secondary={
          <>
            {viewer.description}
            {viewer.contentTypes.length > 0 && (
              <span style={{ display: "block", marginTop: 4 }}>
                {viewer.contentTypes.map((ct) => (
                  <Chip key={ct} label={ct} size="small" sx={{ mr: 0.5, mb: 0.5 }} />
                ))}
              </span>
            )}
          </>
        }
      />
    </ListItemButton>
  );
}

// ============================================================================
// Types
// ============================================================================

type ViewerPickerDialogProps = {
  open: boolean;
  onClose: () => void;
  onSelect: (viewer: ViewerInfo) => void;
  /** Content type of the target item (used for matching) */
  targetContentType: string | null;
  /** Whether the target is a directory */
  targetIsDirectory: boolean;
  /** Fetch viewers function (injected from app layer) */
  fetchViewers: () => Promise<ViewerInfo[]>;
};

// ============================================================================
// Component
// ============================================================================

export function ViewerPickerDialog({
  open,
  onClose,
  onSelect,
  targetContentType,
  targetIsDirectory,
  fetchViewers,
}: ViewerPickerDialogProps) {
  const [viewers, setViewers] = useState<ViewerInfo[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    fetchViewers()
      .then((list) => {
        if (!cancelled) setViewers(list);
      })
      .catch(() => {
        if (!cancelled) setViewers([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, fetchViewers]);

  const handleSelect = useCallback(
    (viewer: ViewerInfo) => {
      onSelect(viewer);
      onClose();
    },
    [onSelect, onClose]
  );

  // Split viewers into matching and non-matching groups
  const matching: ViewerInfo[] = [];
  const other: ViewerInfo[] = [];
  for (const v of viewers) {
    if (targetIsDirectory || viewerMatchesContentType(v, targetContentType)) {
      matching.push(v);
    } else {
      other.push(v);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          py: 1.5,
        }}
      >
        <Typography variant="subtitle1" component="span">
          Open with…
        </Typography>
        <IconButton size="small" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <List sx={{ pt: 0, pb: 1 }}>
        {loading && (
          <Typography variant="body2" color="text.secondary" sx={{ px: 3, py: 2 }}>
            Loading viewers…
          </Typography>
        )}

        {!loading && viewers.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ px: 3, py: 2 }}>
            No viewers available
          </Typography>
        )}

        {matching.map((viewer) => (
          <ViewerListItem key={viewer.id} viewer={viewer} onSelect={handleSelect} />
        ))}

        {other.length > 0 && (
          <>
            <Divider sx={{ my: 1 }} />
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ px: 3, py: 0.5, display: "block" }}
            >
              Other viewers
            </Typography>
            {other.map((viewer) => (
              <ViewerListItem key={viewer.id} viewer={viewer} onSelect={handleSelect} />
            ))}
          </>
        )}
      </List>
    </Dialog>
  );
}
