/**
 * <ExplorerShell /> - Layout shell that switches between
 * DepotSelector and the file browser views.
 *
 * Iter 2: Integrates upload overlay, upload progress, context menu,
 * dialogs, and error snackbar.
 */

import { Box } from "@mui/material";
import { useCallback, useEffect, useRef, useState } from "react";
import { useExplorerStore } from "../hooks/use-explorer-context.ts";
import { useUpload } from "../hooks/use-upload.ts";
import type {
  ExplorerError,
  ExplorerItem,
  ExplorerMenuItem,
  ExplorerToolbarItem,
  PathSegment,
} from "../types.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { ContextMenu } from "./ContextMenu.tsx";
import { CreateFolderDialog } from "./CreateFolderDialog.tsx";
import { DepotSelector } from "./DepotSelector.tsx";
import { ErrorSnackbar } from "./ErrorSnackbar.tsx";
import { ExplorerToolbar } from "./ExplorerToolbar.tsx";
import { FileList } from "./FileList.tsx";
import { RenameDialog } from "./RenameDialog.tsx";
import { StatusBar } from "./StatusBar.tsx";
import { UploadOverlay } from "./UploadOverlay.tsx";
import { UploadProgress } from "./UploadProgress.tsx";

type ExplorerShellProps = {
  onNavigate?: (path: string) => void;
  onSelect?: (items: ExplorerItem[]) => void;
  onFileOpen?: (item: ExplorerItem) => void;
  onError?: (error: ExplorerError) => void;
  onDepotChange?: (depotId: string) => void;
  renderEmptyState?: () => React.ReactNode;
  renderBreadcrumb?: (segments: PathSegment[]) => React.ReactNode;
  renderNodeIcon?: (item: ExplorerItem) => React.ReactNode;
  extraContextMenuItems?: ExplorerMenuItem[];
  extraToolbarItems?: ExplorerToolbarItem[];
};

export function ExplorerShell(props: ExplorerShellProps) {
  const depotId = useExplorerStore((s) => s.depotId);
  const depotRoot = useExplorerStore((s) => s.depotRoot);
  const selectDepot = useExplorerStore((s) => s.selectDepot);
  const permissions = useExplorerStore((s) => s.permissions);
  const selectedItems = useExplorerStore((s) => s.selectedItems);
  const dialogState = useExplorerStore((s) => s.dialogState);
  const openDialog = useExplorerStore((s) => s.openDialog);
  const closeDialog = useExplorerStore((s) => s.closeDialog);
  const deleteItems = useExplorerStore((s) => s.deleteItems);
  const setError = useExplorerStore((s) => s.setError);
  const refresh = useExplorerStore((s) => s.refresh);
  const navigate = useExplorerStore((s) => s.navigate);

  const { uploadFiles, cancelUpload, retryUpload } = useUpload({ onError: props.onError });

  // ── Context menu state ──
  const [contextMenuPos, setContextMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [contextMenuItem, setContextMenuItem] = useState<ExplorerItem | null>(null);

  // ── Hidden file input ref for upload via context menu ──
  const contextMenuFileInputRef = useRef<HTMLInputElement>(null);

  // ── Selection callback ──
  useEffect(() => {
    props.onSelect?.(selectedItems);
  }, [selectedItems, props.onSelect]);

  useEffect(() => {
    if (depotId && !depotRoot) {
      selectDepot(depotId);
    }
  }, [depotId, depotRoot, selectDepot]);

  // ── Context menu handlers ──
  const handleContextMenu = useCallback((e: React.MouseEvent, item: ExplorerItem | null) => {
    setContextMenuPos({ top: e.clientY, left: e.clientX });
    setContextMenuItem(item);
  }, []);

  const handleContextMenuClose = useCallback(() => {
    setContextMenuPos(null);
    setContextMenuItem(null);
  }, []);

  const handleContextMenuOpen = useCallback(
    (item: ExplorerItem) => {
      if (item.isDirectory) {
        navigate(item.path);
        props.onNavigate?.(item.path);
      } else {
        props.onFileOpen?.(item);
      }
    },
    [navigate, props.onNavigate, props.onFileOpen]
  );

  const handleContextMenuRename = useCallback(
    (item: ExplorerItem) => {
      openDialog("rename", item);
    },
    [openDialog]
  );

  const handleContextMenuDelete = useCallback(
    (items: ExplorerItem[]) => {
      if (items.length === 1) {
        openDialog("delete", items[0]);
      } else if (items.length > 1) {
        // For multi-delete, we store the first item but will use selectedItems
        openDialog("delete", items[0]);
      }
    },
    [openDialog]
  );

  const handleContextMenuNewFolder = useCallback(() => {
    openDialog("createFolder");
  }, [openDialog]);

  const handleContextMenuUpload = useCallback(() => {
    contextMenuFileInputRef.current?.click();
  }, []);

  const handleContextMenuRefresh = useCallback(() => {
    refresh();
  }, [refresh]);

  // ── Delete confirmation handler ──
  const handleDeleteConfirm = useCallback(async () => {
    const itemsToDelete =
      selectedItems.length > 1
        ? selectedItems
        : dialogState.targetItem
          ? [dialogState.targetItem]
          : [];

    if (itemsToDelete.length === 0) {
      closeDialog();
      return;
    }

    const result = await deleteItems(itemsToDelete);
    closeDialog();

    if (result.failed > 0) {
      setError({
        type: "unknown",
        message: `Succeeded ${result.success}, failed ${result.failed}`,
      });
    }
  }, [selectedItems, dialogState.targetItem, deleteItems, closeDialog, setError]);

  // ── Upload from context menu file input ──
  const handleContextMenuFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        uploadFiles(Array.from(files));
      }
      e.target.value = "";
    },
    [uploadFiles]
  );

  // ── Keyboard shortcuts ──
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!permissions.canUpload) return;

      // Delete key
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedItems.length > 0 && !(e.target instanceof HTMLInputElement)) {
          e.preventDefault();
          handleContextMenuDelete(selectedItems);
        }
      }

      // F2 for rename
      if (e.key === "F2" && selectedItems.length === 1) {
        e.preventDefault();
        openDialog("rename", selectedItems[0]);
      }
    },
    [selectedItems, permissions.canUpload, handleContextMenuDelete, openDialog]
  );

  if (!depotId) {
    return (
      <DepotSelector
        onSelect={(id) => {
          selectDepot(id);
          props.onDepotChange?.(id);
        }}
      />
    );
  }

  if (!depotRoot) {
    return null;
  }

  // Determine delete message
  const deleteItemCount =
    selectedItems.length > 1 ? selectedItems.length : dialogState.targetItem ? 1 : 0;

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        overflow: "hidden",
        position: "relative",
      }}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <ExplorerToolbar
        renderBreadcrumb={props.renderBreadcrumb}
        onUpload={uploadFiles}
        onNewFolder={handleContextMenuNewFolder}
        extraToolbarItems={props.extraToolbarItems}
      />

      <UploadOverlay onDrop={uploadFiles} canUpload={permissions.canUpload}>
        <Box sx={{ flex: 1, overflow: "auto" }}>
          <FileList
            onNavigate={props.onNavigate}
            onFileOpen={props.onFileOpen}
            onContextMenu={handleContextMenu}
            renderEmptyState={props.renderEmptyState}
            renderNodeIcon={props.renderNodeIcon}
          />
        </Box>
      </UploadOverlay>

      <StatusBar />

      {/* Upload progress panel */}
      <UploadProgress onCancel={cancelUpload} onRetry={retryUpload} />

      {/* Context menu */}
      <ContextMenu
        anchorPosition={contextMenuPos}
        onClose={handleContextMenuClose}
        targetItem={contextMenuItem}
        extraItems={props.extraContextMenuItems}
        onOpen={handleContextMenuOpen}
        onRename={handleContextMenuRename}
        onDelete={handleContextMenuDelete}
        onNewFolder={handleContextMenuNewFolder}
        onUpload={handleContextMenuUpload}
        onRefresh={handleContextMenuRefresh}
      />

      {/* Hidden file input for context menu upload */}
      <input
        ref={contextMenuFileInputRef}
        type="file"
        multiple
        hidden
        onChange={handleContextMenuFileChange}
      />

      {/* Create folder dialog */}
      <CreateFolderDialog open={dialogState.type === "createFolder"} onClose={closeDialog} />

      {/* Rename dialog */}
      <RenameDialog
        open={dialogState.type === "rename"}
        item={dialogState.targetItem}
        onClose={closeDialog}
      />

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        open={dialogState.type === "delete"}
        title="Delete"
        message={
          deleteItemCount > 1
            ? `Are you sure you want to delete ${deleteItemCount} items?`
            : dialogState.targetItem
              ? `Are you sure you want to delete "${dialogState.targetItem.name}"?`
              : ""
        }
        onConfirm={handleDeleteConfirm}
        onCancel={closeDialog}
        confirmColor="error"
      />

      {/* Error snackbar */}
      <ErrorSnackbar onError={props.onError} />
    </Box>
  );
}
