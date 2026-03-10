/**
 * <ExplorerToolbar /> - Breadcrumb navigation + action buttons.
 *
 * Iter 2: Added upload, new folder buttons, and extraToolbarItems support.
 * Iter 3: Added navigation buttons, search box, view toggle.
 */

import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import CreateNewFolderIcon from "@mui/icons-material/CreateNewFolder";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import RefreshIcon from "@mui/icons-material/Refresh";
import { Box, Divider, IconButton, Tooltip } from "@mui/material";
import type React from "react";
import { useCallback, useRef } from "react";
import { useExplorerStore, useExplorerT } from "../hooks/use-explorer-context.ts";
import type { ExplorerToolbarItem, PathSegment } from "../types.ts";
import { Breadcrumb } from "./Breadcrumb.tsx";
import { NavigationButtons } from "./NavigationButtons.tsx";
import { SearchBox } from "./SearchBox.tsx";
import { ViewToggle } from "./ViewToggle.tsx";

type ExplorerToolbarProps = {
  renderBreadcrumb?: (segments: PathSegment[]) => React.ReactNode;
  onUpload?: (files: File[]) => void;
  onNewFolder?: () => void;
  onNavigate?: (path: string) => void;
  extraToolbarItems?: ExplorerToolbarItem[];
  /** Optional external ref for the hidden file input (Iter 4) */
  fileInputRef?: React.RefObject<HTMLInputElement | null>;
};

export function ExplorerToolbar({
  renderBreadcrumb,
  onUpload,
  onNewFolder,
  onNavigate,
  extraToolbarItems,
  fileInputRef: externalFileInputRef,
}: ExplorerToolbarProps) {
  const t = useExplorerT();
  const refresh = useExplorerStore((s) => s.refresh);
  const permissions = useExplorerStore((s) => s.permissions);
  const detailPanelOpen = useExplorerStore((s) => s.detailPanelOpen);
  const toggleDetailPanel = useExplorerStore((s) => s.toggleDetailPanel);
  const internalFileInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = externalFileInputRef ?? internalFileInputRef;

  const handleRefresh = useCallback(() => {
    refresh();
  }, [refresh]);

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, [fileInputRef.current]);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        onUpload?.(Array.from(files));
      }
      // Reset input so the same file can be re-selected
      e.target.value = "";
    },
    [onUpload]
  );

  const handleNewFolder = useCallback(() => {
    onNewFolder?.();
  }, [onNewFolder]);

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        px: 1,
        py: 0.5,
        borderBottom: 1,
        borderColor: "divider",
        minHeight: 40,
        gap: 0.5,
      }}
    >
      {/* Navigation buttons: back / forward / up */}
      <NavigationButtons onNavigate={onNavigate} />

      <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: -0.5 }} />

      {/* Breadcrumb (with path input toggle) */}
      <Box sx={{ flex: 3, overflow: "clip", overflowClipMargin: 2 }}>
        <Breadcrumb renderBreadcrumb={renderBreadcrumb} onNavigate={onNavigate} />
      </Box>

      <Box sx={{ flex: 1, minWidth: 180, maxWidth: 320, ml: 1 }}>
        <SearchBox />
      </Box>

      <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: -0.5 }} />

      {/* View toggle */}
      <ViewToggle />

      <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: -0.5 }} />

      {/* Upload button — hidden when no upload permission */}
      {permissions.canUpload && (
        <>
          <Tooltip title={t("toolbar.upload")}>
            <IconButton size="small" onClick={handleUploadClick}>
              <CloudUploadIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
          <input ref={fileInputRef} type="file" multiple hidden onChange={handleFileChange} />
        </>
      )}

      {/* New folder button — hidden when no upload permission */}
      {permissions.canUpload && (
        <Tooltip title={t("toolbar.newFolder")}>
          <IconButton size="small" onClick={handleNewFolder}>
            <CreateNewFolderIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      )}

      <Tooltip title={t("toolbar.refresh")}>
        <IconButton size="small" onClick={handleRefresh}>
          <RefreshIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>

      {/* Detail panel toggle (Iter 4) */}
      <Tooltip title={t("detail.title")}>
        <IconButton
          size="small"
          onClick={toggleDetailPanel}
          color={detailPanelOpen ? "primary" : "default"}
        >
          <InfoOutlinedIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>

      {/* Extra toolbar items */}
      {extraToolbarItems?.map((item) => (
        <Tooltip key={item.key} title={item.tooltip}>
          <span>
            <IconButton size="small" onClick={item.onClick} disabled={item.disabled}>
              {item.icon}
            </IconButton>
          </span>
        </Tooltip>
      ))}
    </Box>
  );
}
