/**
 * <PreviewPanel /> - File preview in a dialog overlay.
 * (Iter 4)
 *
 * Loads file content via localFs.read() and renders through
 * matched preview providers (custom first, then built-in).
 *
 * When the item has a nodeKey, a CAS URL (/cas/:nodeKey) is also
 * provided so media previews can use it directly as src — benefiting
 * from SW caching without needing blob URLs.
 *
 * Viewer mode: when viewerUrl is set, renders the viewer in an iframe
 * and fetches the viewer's manifest.json to display name/icon in the title bar.
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

/** Minimal manifest shape used for title bar rendering */
type ViewerManifestInfo = {
  name: string;
  icon?: string;
};

type PreviewPanelProps = {
  /** The item to preview */
  item: ExplorerItem | null;
  /** Close the preview */
  onClose: () => void;
  /** Custom preview providers (higher priority than built-in) */
  previewProviders?: PreviewProvider[];
  /** When set, renders an iframe with this URL instead of the normal preview */
  viewerUrl?: string | null;
};

export function PreviewPanel({ item, onClose, previewProviders, viewerUrl }: PreviewPanelProps) {
  const t = useExplorerT();
  const localFs = useExplorerStore((s) => s.localFs);
  const depotRoot = useExplorerStore((s) => s.depotRoot);

  const [blob, setBlob] = useState<Blob | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manifestInfo, setManifestInfo] = useState<ViewerManifestInfo | null>(null);

  // Viewer mode: iframe-based rendering via /view composition URL
  const isViewerMode = !!viewerUrl;

  // Construct CAS URL from item's nodeKey (if available)
  const casUrl = item?.nodeKey ? `/cas/${item.nodeKey}` : null;

  // Fetch viewer manifest.json for title bar rendering
  useEffect(() => {
    if (!isViewerMode || !viewerUrl) {
      setManifestInfo(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const params = new URL(viewerUrl, location.origin).searchParams;
        const viewerNodeKey = params.get("viewer");
        if (!viewerNodeKey) return;

        const res = await fetch(`/page/${encodeURIComponent(viewerNodeKey)}/manifest.json`);
        if (!res.ok || cancelled) return;
        const manifest = await res.json();
        if (cancelled) return;
        if (manifest?.casfa === "viewer") {
          setManifestInfo({
            name: manifest.name,
            icon: manifest.icon,
          });
        }
      } catch {
        // Ignore — fall back to generic title
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isViewerMode, viewerUrl]);

  useEffect(() => {
    // Skip blob loading in viewer mode — iframe handles everything
    if (isViewerMode) return;

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
  }, [item, depotRoot, localFs, t, isViewerMode]);

  const handleClose = useCallback(() => {
    setBlob(null);
    setError(null);
    setLoading(false);
    onClose();
  }, [onClose]);

  const isOpen = isViewerMode ? !!viewerUrl : !!item;
  if (!isOpen) return null;

  const contentType = item?.contentType || "application/octet-stream";
  const provider = isViewerMode ? null : findPreviewProvider(contentType, previewProviders);
  const dialogTitle = isViewerMode
    ? (manifestInfo?.name ?? t("preview.viewer"))
    : (item?.name ?? "");

  // Build icon URL: /page/{viewerNodeKey}/{iconPath}
  let iconUrl: string | null = null;
  if (isViewerMode && viewerUrl && manifestInfo?.icon) {
    try {
      const viewerNodeKey = new URL(viewerUrl, location.origin).searchParams.get("viewer");
      if (viewerNodeKey) {
        iconUrl = `/page/${encodeURIComponent(viewerNodeKey)}/${encodeURIComponent(manifestInfo.icon)}`;
      }
    } catch {
      // ignore
    }
  }

  return (
    <Dialog
      open={isOpen}
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
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flex: 1, minWidth: 0 }}>
          {iconUrl && (
            <Box
              component="img"
              src={iconUrl}
              alt=""
              sx={{ width: 20, height: 20, flexShrink: 0, objectFit: "contain" }}
            />
          )}
          <Typography variant="subtitle1" component="span" noWrap sx={{ flex: 1 }}>
            {dialogTitle}
          </Typography>
        </Box>
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
        {/* Viewer mode: render iframe */}
        {isViewerMode && viewerUrl && (
          <iframe
            src={viewerUrl}
            title={dialogTitle}
            style={{ width: "100%", height: "100%", border: "none", flex: 1 }}
            sandbox="allow-scripts allow-same-origin"
          />
        )}

        {/* Normal preview mode */}
        {!isViewerMode && loading && (
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

        {!isViewerMode && error && (
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

        {!isViewerMode && !loading && !error && blob && provider && (
          <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto" }}>
            {provider.render({ item: item!, blob, contentType, casUrl })}
          </Box>
        )}

        {!isViewerMode && !loading && !error && blob && !provider && (
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
