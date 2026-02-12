/**
 * <UploadProgress /> - Upload queue progress panel.
 *
 * Shows as a collapsible bottom panel with per-file status,
 * cancel (for pending), and retry (for failed) actions.
 * Iter 4: Added overall progress bar and cancel-all button.
 */

import CancelIcon from "@mui/icons-material/Cancel";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CloseIcon from "@mui/icons-material/Close";
import ErrorIcon from "@mui/icons-material/Error";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ReplayIcon from "@mui/icons-material/Replay";
import StopCircleIcon from "@mui/icons-material/StopCircle";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import {
  Box,
  Button,
  Chip,
  Collapse,
  IconButton,
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  Paper,
  Tooltip,
  Typography,
} from "@mui/material";
import { useCallback, useState } from "react";
import { useExplorerStore, useExplorerT } from "../hooks/use-explorer-context.ts";

type UploadProgressProps = {
  onCancel?: (id: string) => void;
  onRetry?: (id: string) => void;
  onCancelAll?: () => void;
};

export function UploadProgress({ onCancel, onRetry, onCancelAll }: UploadProgressProps) {
  const t = useExplorerT();
  const uploadQueue = useExplorerStore((s) => s.uploadQueue);
  const clearCompletedUploads = useExplorerStore((s) => s.clearCompletedUploads);
  const [expanded, setExpanded] = useState(true);

  const total = uploadQueue.length;
  const done = uploadQueue.filter((item) => item.status === "done").length;
  const errors = uploadQueue.filter((item) => item.status === "error").length;
  const uploading = uploadQueue.filter((item) => item.status === "uploading").length;
  const pending = uploadQueue.filter((item) => item.status === "pending").length;

  // Overall progress percentage
  const overallPercent = total > 0 ? Math.round((done / total) * 100) : 0;
  const isActive = uploading > 0 || pending > 0;

  const handleClearAll = useCallback(() => {
    clearCompletedUploads();
  }, [clearCompletedUploads]);

  const handleCancelAll = useCallback(() => {
    onCancelAll?.();
  }, [onCancelAll]);

  if (total === 0) return null;

  return (
    <Paper
      elevation={3}
      sx={{
        position: "absolute",
        bottom: 28, // above status bar
        right: 8,
        width: 360,
        maxHeight: expanded ? 320 : "auto",
        zIndex: 20,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          px: 1.5,
          py: 0.75,
          bgcolor: "grey.100",
          cursor: "pointer",
          gap: 1,
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <UploadFileIcon fontSize="small" color="primary" />
        <Typography variant="body2" fontWeight={500} sx={{ flex: 1 }}>
          {t("upload.uploading", { current: done + uploading, total })}
        </Typography>
        {errors > 0 && (
          <Chip label={`${errors} failed`} size="small" color="error" variant="outlined" />
        )}
        <IconButton
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(!expanded);
          }}
        >
          {expanded ? <ExpandMoreIcon fontSize="small" /> : <ExpandLessIcon fontSize="small" />}
        </IconButton>
        <Tooltip title="Clear completed">
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              handleClearAll();
            }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Overall progress bar (Iter 4) */}
      <Box sx={{ px: 1.5, py: 0.5 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
          <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
            {overallPercent}%
          </Typography>
          {isActive && onCancelAll && (
            <Button
              size="small"
              variant="text"
              color="error"
              startIcon={<StopCircleIcon fontSize="small" />}
              onClick={(e) => {
                e.stopPropagation();
                handleCancelAll();
              }}
              sx={{ minWidth: 0, py: 0, px: 0.5, fontSize: "0.7rem" }}
            >
              {t("upload.cancel")}
            </Button>
          )}
        </Box>
        <LinearProgress variant="determinate" value={overallPercent} sx={{ borderRadius: 1 }} />
      </Box>

      {/* Per-file indeterminate bar for active uploads */}
      {uploading > 0 && <LinearProgress />}

      {/* Item list */}
      <Collapse in={expanded}>
        <List dense sx={{ maxHeight: 200, overflow: "auto", py: 0 }}>
          {uploadQueue.map((item) => (
            <ListItem
              key={item.id}
              secondaryAction={
                item.status === "pending" ? (
                  <Tooltip title={t("upload.cancel")}>
                    <IconButton edge="end" size="small" onClick={() => onCancel?.(item.id)}>
                      <CancelIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                ) : item.status === "error" ? (
                  <Tooltip title={t("upload.retry")}>
                    <IconButton edge="end" size="small" onClick={() => onRetry?.(item.id)}>
                      <ReplayIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                ) : null
              }
              sx={{ pr: item.status === "pending" || item.status === "error" ? 6 : 2 }}
            >
              {item.status === "done" ? (
                <CheckCircleIcon fontSize="small" color="success" sx={{ mr: 1, flexShrink: 0 }} />
              ) : item.status === "error" ? (
                <ErrorIcon fontSize="small" color="error" sx={{ mr: 1, flexShrink: 0 }} />
              ) : item.status === "uploading" ? (
                <UploadFileIcon fontSize="small" color="primary" sx={{ mr: 1, flexShrink: 0 }} />
              ) : (
                <UploadFileIcon fontSize="small" color="disabled" sx={{ mr: 1, flexShrink: 0 }} />
              )}
              <ListItemText
                primary={item.file.name}
                secondary={item.error}
                primaryTypographyProps={{ variant: "body2", noWrap: true }}
                secondaryTypographyProps={{ variant: "caption", color: "error" }}
              />
            </ListItem>
          ))}
        </List>
      </Collapse>
    </Paper>
  );
}
