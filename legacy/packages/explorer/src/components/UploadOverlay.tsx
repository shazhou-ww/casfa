/**
 * <UploadOverlay /> - Drag-and-drop upload overlay.
 *
 * Shows a translucent overlay with dashed border when files are dragged
 * over the explorer area. Uses a ref counter to handle nested dragenter events.
 */

import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import { Box, Typography } from "@mui/material";
import { useCallback, useRef, useState } from "react";
import { useExplorerT } from "../hooks/use-explorer-context.ts";

type UploadOverlayProps = {
  /** Called when files are dropped */
  onDrop: (files: File[]) => void;
  /** Whether upload is permitted */
  canUpload: boolean;
  children: React.ReactNode;
};

export function UploadOverlay({ onDrop, canUpload, children }: UploadOverlayProps) {
  const t = useExplorerT();
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!canUpload) return;
      dragCounterRef.current++;
      if (dragCounterRef.current === 1) {
        setIsDragOver(true);
      }
    },
    [canUpload]
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setIsDragOver(false);

      if (!canUpload) return;

      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        onDrop(files);
      }
    },
    [canUpload, onDrop]
  );

  return (
    <Box
      sx={{
        position: "relative",
        flex: 1,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {children}

      {isDragOver && (
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            bgcolor: "action.hover",
            border: "2px dashed",
            borderColor: "primary.main",
            borderRadius: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10,
            pointerEvents: "none",
          }}
        >
          <CloudUploadIcon sx={{ fontSize: 48, color: "primary.main", mb: 1 }} />
          <Typography variant="h6" color="primary">
            {t("upload.dropHere")}
          </Typography>
        </Box>
      )}
    </Box>
  );
}
