/**
 * <DetailPanel /> - Right-side file metadata panel.
 * (Iter 4)
 *
 * Shows file/folder details: name, path, size, type, CAS node key, etc.
 * Toggled via toolbar info button or Ctrl+I.
 */

import CloseIcon from "@mui/icons-material/Close";
import FolderIcon from "@mui/icons-material/Folder";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import {
  Box,
  CircularProgress,
  Divider,
  Drawer,
  IconButton,
  Tooltip,
  Typography,
} from "@mui/material";
import { useEffect, useMemo, useState } from "react";
import { useExplorerStore, useExplorerT } from "../hooks/use-explorer-context.ts";
import type { ExplorerItem } from "../types.ts";
import { formatSize } from "../utils/format-size.ts";

type DetailPanelProps = {
  /** Width of the detail panel */
  width?: number;
};

const PANEL_WIDTH = 280;

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ mb: 1.5 }}>
      <Typography variant="caption" color="text.secondary" fontWeight={600}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ wordBreak: "break-all", userSelect: "text" }}>
        {value}
      </Typography>
    </Box>
  );
}

function SingleItemDetail({
  item,
  t,
  refCount,
  refCountLoading,
}: {
  item: ExplorerItem;
  t: ReturnType<typeof useExplorerT>;
  refCount: number | null;
  refCountLoading: boolean;
}) {
  return (
    <>
      <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
        {item.isDirectory ? (
          <FolderIcon sx={{ fontSize: 56, color: "#f59e0b" }} />
        ) : (
          <InsertDriveFileIcon sx={{ fontSize: 56, color: "action.active" }} />
        )}
      </Box>

      <Typography variant="subtitle1" fontWeight={600} noWrap sx={{ mb: 2, textAlign: "center" }}>
        {item.name}
      </Typography>

      <Divider sx={{ mb: 2 }} />

      <DetailRow label={t("detail.name")} value={item.name} />
      <DetailRow label={t("detail.path")} value={item.path || "/"} />

      {item.isDirectory ? (
        <DetailRow
          label={t("detail.childCount")}
          value={item.childCount !== null ? String(item.childCount) : "\u2014"}
        />
      ) : (
        <>
          <DetailRow label={t("detail.size")} value={formatSize(item.size)} />
          <DetailRow label={t("detail.type")} value={item.contentType ?? "File"} />
        </>
      )}

      {item.nodeKey && <DetailRow label={t("detail.nodeKey")} value={item.nodeKey} />}

      {item.nodeKey && (
        <Box sx={{ mb: 1.5 }}>
          <Typography variant="caption" color="text.secondary" fontWeight={600}>
            {t("detail.refCount")}
          </Typography>
          {refCountLoading ? (
            <CircularProgress size={14} sx={{ display: "block", mt: 0.5 }} />
          ) : (
            <Typography variant="body2" sx={{ wordBreak: "break-all", userSelect: "text" }}>
              {refCount !== null ? String(refCount) : "\u2014"}
            </Typography>
          )}
        </Box>
      )}
    </>
  );
}

export function DetailPanel({ width = PANEL_WIDTH }: DetailPanelProps) {
  const t = useExplorerT();
  const detailPanelOpen = useExplorerStore((s) => s.detailPanelOpen);
  const toggleDetailPanel = useExplorerStore((s) => s.toggleDetailPanel);
  const selectedItems = useExplorerStore((s) => s.selectedItems);
  const currentPath = useExplorerStore((s) => s.currentPath);
  const client = useExplorerStore((s) => s.client);

  const [refCount, setRefCount] = useState<number | null>(null);
  const [refCountLoading, setRefCountLoading] = useState(false);

  const totalSize = useMemo(() => {
    return selectedItems.reduce((sum, item) => sum + (item.size ?? 0), 0);
  }, [selectedItems]);

  // Fetch refCount when a single item with nodeKey is selected
  const nodeKey = selectedItems.length === 1 ? selectedItems[0]?.nodeKey : undefined;

  useEffect(() => {
    if (!nodeKey || !detailPanelOpen) {
      setRefCount(null);
      setRefCountLoading(false);
      return;
    }

    let cancelled = false;
    setRefCountLoading(true);
    client.nodes
      .getMetadata(nodeKey)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setRefCount(result.data.refCount);
        } else {
          setRefCount(null);
        }
      })
      .catch(() => {
        if (!cancelled) setRefCount(null);
      })
      .finally(() => {
        if (!cancelled) setRefCountLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [nodeKey, detailPanelOpen, client]);

  const renderContent = () => {
    if (selectedItems.length === 0) {
      return (
        <Box sx={{ textAlign: "center", py: 4, color: "text.secondary" }}>
          <Typography variant="body2">{t("detail.noSelection")}</Typography>
          <Typography variant="caption" color="text.disabled" sx={{ mt: 1, display: "block" }}>
            {currentPath || "/"}
          </Typography>
        </Box>
      );
    }

    if (selectedItems.length === 1) {
      return (
        <SingleItemDetail
          item={selectedItems[0]!}
          t={t}
          refCount={refCount}
          refCountLoading={refCountLoading}
        />
      );
    }

    // Multiple selection
    return (
      <Box sx={{ py: 2, textAlign: "center" }}>
        <Typography variant="subtitle1" fontWeight={600}>
          {t("detail.multipleSelected", { count: selectedItems.length })}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {t("detail.totalSize")}: {formatSize(totalSize)}
        </Typography>
      </Box>
    );
  };

  return (
    <Drawer
      variant="persistent"
      anchor="right"
      open={detailPanelOpen}
      sx={{
        position: "relative",
        width: detailPanelOpen ? width : 0,
        flexShrink: 0,
        "& .MuiDrawer-paper": {
          position: "relative",
          width,
          boxSizing: "border-box",
          borderLeft: 1,
          borderColor: "divider",
          backgroundColor: "#fafafa",
        },
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 1.5,
          height: 36,
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <Typography variant="caption" fontWeight={600}>
          {t("detail.title")}
        </Typography>
        <Tooltip title="Close">
          <IconButton size="small" onClick={toggleDetailPanel}>
            <CloseIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      </Box>

      <Box sx={{ p: 1.5, overflow: "auto", flex: 1 }}>{renderContent()}</Box>
    </Drawer>
  );
}
