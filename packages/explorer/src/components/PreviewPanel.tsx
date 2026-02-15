/**
 * <PreviewPanel /> - File preview in a dialog overlay.
 * (Iter 4)
 *
 * Loads file content via localFs.read() and renders through
 * matched preview providers (custom first, then built-in).
 */

import CloseIcon from "@mui/icons-material/Close";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import {
  Box,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import { pathToSegments } from "../core/path-segments.ts";
import { useExplorerStore, useExplorerT } from "../hooks/use-explorer-context.ts";
import { findPreviewProvider, MAX_PREVIEW_SIZE } from "../preview/builtin-providers.tsx";
import type { ExplorerItem, PreviewProvider } from "../types.ts";

type PreviewPanelProps = {
  /** The item to preview */
  item: ExplorerItem | null;
  /** Close the preview */
  onClose: () => void;
  /** Custom preview providers (higher priority than built-in) */
  previewProviders?: PreviewProvider[];
};

export function PreviewPanel({ item, onClose, previewProviders }: PreviewPanelProps) {
  const t = useExplorerT();
  const localFs = useExplorerStore((s) => s.localFs);
  const depotRoot = useExplorerStore((s) => s.depotRoot);

  const [blob, setBlob] = useState<Blob | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!item || !depotRoot || item.isDirectory) {
      setBlob(null);
      return;
    }

    // Check size limit
    if (item.size && item.size > MAX_PREVIEW_SIZE) {
      setError(t("preview.tooLarge"));
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setBlob(null);

    (async () => {
      try {
        const result = await localFs.read(depotRoot, pathToSegments(item.path));
        if (cancelled) return;
        if ("code" in result) {
          setError(t("preview.error"));
          setLoading(false);
          return;
        }
        const contentType = result.contentType || item.contentType || "application/octet-stream";
        setBlob(new Blob([result.data as BlobPart], { type: contentType }));
        setLoading(false);
      } catch {
        if (!cancelled) {
          setError(t("preview.error"));
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [item, depotRoot, localFs, t]);

  const handleClose = useCallback(() => {
    setBlob(null);
    setError(null);
    setLoading(false);
    onClose();
  }, [onClose]);

  if (!item) return null;

  const contentType = item.contentType || "application/octet-stream";
  const provider = findPreviewProvider(contentType, previewProviders);

  return (
    <Dialog
      open={!!item}
      onClose={handleClose}
      maxWidth="lg"
      fullWidth
      slotProps={{
        paper: {
          sx: { height: "80vh", display: "flex", flexDirection: "column" },
        },
      }}
    >
      <DialogTitle
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          py: 1,
        }}
      >
        <Typography variant="subtitle1" noWrap sx={{ flex: 1 }}>
          {item.name}
        </Typography>
        <IconButton size="small" onClick={handleClose}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent
        sx={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          overflow: "hidden",
          p: 0,
        }}
      >
        {loading && (
          <Box
            sx={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              flex: 1,
            }}
          >
            <CircularProgress />
            <Typography variant="body2" color="text.secondary" sx={{ ml: 2 }}>
              {t("preview.loading")}
            </Typography>
          </Box>
        )}

        {error && (
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: "center",
              flex: 1,
              gap: 1,
            }}
          >
            <InsertDriveFileIcon sx={{ fontSize: 64, color: "action.disabled" }} />
            <Typography color="text.secondary">{error}</Typography>
          </Box>
        )}

        {!loading && !error && blob && provider && (
          <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto" }}>
            {provider.render({ item, blob, contentType })}
          </Box>
        )}

        {!loading && !error && blob && !provider && (
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: "center",
              flex: 1,
              gap: 1,
            }}
          >
            <InsertDriveFileIcon sx={{ fontSize: 64, color: "action.disabled" }} />
            <Typography color="text.secondary">{t("preview.unsupported")}</Typography>
            <Typography variant="caption" color="text.disabled">
              {contentType}
            </Typography>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
}
