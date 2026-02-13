/**
 * <ExplorerShell /> - Layout shell with tree sidebar (depot + directory)
 * and file browser views.
 *
 * The tree sidebar always shows depots as top-level nodes.
 * Expanding a depot selects it and loads its directory tree.
 * Only one depot may be expanded at a time.
 * Iter 2: Integrates upload overlay, upload progress, context menu,
 * dialogs, and error snackbar.
 * Iter 3: Adds tree sidebar, resizable splitter, grid view, keyboard navigation.
 * Iter 4: Adds clipboard, DnD, enhanced keyboard, detail/preview panels, conflict dialog.
 */

import { Box, CircularProgress, Typography } from "@mui/material";
import { useCallback, useEffect, useRef, useState } from "react";
import { useExplorerStore, useExplorerT } from "../hooks/use-explorer-context.ts";
import { useKeyboardNavigation } from "../hooks/use-keyboard-navigation.ts";
import { useUpload } from "../hooks/use-upload.ts";
import type {
  ConflictInfo,
  ConflictResolution,
  ExplorerError,
  ExplorerItem,
  ExplorerMenuItem,
  ExplorerToolbarItem,
  PathSegment,
  PreviewProvider,
} from "../types.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { ConflictDialog } from "./ConflictDialog.tsx";
import { ContextMenu } from "./ContextMenu.tsx";
import { CreateFolderDialog } from "./CreateFolderDialog.tsx";
import { DetailPanel } from "./DetailPanel.tsx";
import { DirectoryTree } from "./DirectoryTree.tsx";
import { ErrorSnackbar } from "./ErrorSnackbar.tsx";
import { ExplorerToolbar } from "./ExplorerToolbar.tsx";
import { FileGrid } from "./FileGrid.tsx";
import { FileList } from "./FileList.tsx";
import { PreviewPanel } from "./PreviewPanel.tsx";
import { RenameDialog } from "./RenameDialog.tsx";
import { ResizableSplitter } from "./ResizableSplitter.tsx";
import { StatusBar } from "./StatusBar.tsx";
import { UploadOverlay } from "./UploadOverlay.tsx";

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
  previewProviders?: PreviewProvider[];
};

export function ExplorerShell(props: ExplorerShellProps) {
  const t = useExplorerT();
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
  const layout = useExplorerStore((s) => s.layout);
  const sidebarWidth = useExplorerStore((s) => s.sidebarWidth);
  const sidebarCollapsed = useExplorerStore((s) => s.sidebarCollapsed);
  const setSidebarWidth = useExplorerStore((s) => s.setSidebarWidth);
  const detailPanelOpen = useExplorerStore((s) => s.detailPanelOpen);
  const clipboard = useExplorerStore((s) => s.clipboard);
  const copyItems = useExplorerStore((s) => s.copyItems);
  const cutItems = useExplorerStore((s) => s.cutItems);
  const pasteItems = useExplorerStore((s) => s.pasteItems);
  const currentPath = useExplorerStore((s) => s.currentPath);

  const { uploadFiles } = useUpload({ onError: props.onError });

  // Ref for the shell container to compute max sidebar width
  const shellRef = useRef<HTMLDivElement>(null);

  // ── Context menu state ──
  const [contextMenuPos, setContextMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [contextMenuItem, setContextMenuItem] = useState<ExplorerItem | null>(null);

  // ── Hidden file input ref for upload via context menu ──
  const contextMenuFileInputRef = useRef<HTMLInputElement>(null);
  const toolbarFileInputRef = useRef<HTMLInputElement>(null);

  // ── Preview state (Iter 4) ──
  const [previewItem, setPreviewItem] = useState<ExplorerItem | null>(null);

  // ── Conflict state (Iter 4) ──
  const [conflictInfo, setConflictInfo] = useState<ConflictInfo | null>(null);

  // ── Selection callback ──
  useEffect(() => {
    props.onSelect?.(selectedItems);
  }, [selectedItems, props]);

  // ── Auto-select depot when provided via props but root not loaded ──
  useEffect(() => {
    if (depotId && !depotRoot) {
      selectDepot(depotId);
    }
  }, [depotId, depotRoot, selectDepot]);

  // ── Fire onDepotChange when the active depot changes (driven by tree) ──
  const prevDepotIdRef = useRef<string | null>(depotId);
  useEffect(() => {
    if (depotId && depotId !== prevDepotIdRef.current) {
      props.onDepotChange?.(depotId);
    }
    prevDepotIdRef.current = depotId;
  }, [depotId, props.onDepotChange, props]);

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
        // Open file preview
        setPreviewItem(item);
        props.onFileOpen?.(item);
      }
    },
    [navigate, props]
  );

  const handleContextMenuRename = useCallback(
    (item: ExplorerItem) => {
      openDialog("rename", item);
    },
    [openDialog]
  );

  const handleContextMenuDelete = useCallback(
    (items: ExplorerItem[]) => {
      if (items.length >= 1) {
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

  // ── Clipboard context menu handlers (Iter 4) ──
  const handleContextMenuCopy = useCallback(() => {
    if (selectedItems.length > 0) copyItems(selectedItems);
  }, [selectedItems, copyItems]);

  const handleContextMenuCut = useCallback(() => {
    if (selectedItems.length > 0) cutItems(selectedItems);
  }, [selectedItems, cutItems]);

  const handleContextMenuPaste = useCallback(() => {
    pasteItems(currentPath);
  }, [pasteItems, currentPath]);

  // ── Download handler ──
  const localFs = useExplorerStore((s) => s.localFs);
  const handleDownload = useCallback(
    async (item: ExplorerItem) => {
      if (!depotRoot || item.isDirectory) return;
      try {
        const result = await localFs.read(depotRoot, item.path);
        if ("code" in result) {
          setError({ type: "unknown", message: t("error.unknown") });
          return;
        }
        const blob = new Blob([result.data as BlobPart], {
          type: result.contentType || "application/octet-stream",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = item.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch {
        setError({ type: "unknown", message: t("error.unknown") });
      }
    },
    [depotRoot, localFs, setError, t]
  );

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

  // ── File open handler (opens preview for files) ──
  const handleFileOpen = useCallback(
    (item: ExplorerItem) => {
      if (item.isDirectory) {
        navigate(item.path);
        props.onNavigate?.(item.path);
      } else {
        setPreviewItem(item);
        props.onFileOpen?.(item);
      }
    },
    [navigate, props]
  );

  // ── Conflict resolution (Iter 4) ──
  const handleConflictResolve = useCallback((_resolution: ConflictResolution) => {
    // TODO: apply resolution to ongoing paste/upload operation
    setConflictInfo(null);
  }, []);

  // ── Keyboard handler (Iter 4: full keyboard navigation) ──
  const { handleKeyDown: kbHandler } = useKeyboardNavigation({
    onNavigate: props.onNavigate,
    onFileOpen: handleFileOpen,
    onNewFolder: handleContextMenuNewFolder,
    onUpload: () => toolbarFileInputRef.current?.click(),
  });

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      kbHandler(e);
    },
    [kbHandler]
  );

  // Determine delete message
  const deleteItemCount =
    selectedItems.length > 1 ? selectedItems.length : dialogState.targetItem ? 1 : 0;

  // Resizable sidebar handler
  const handleSidebarResize = (deltaX: number) => {
    const maxWidth = shellRef.current ? shellRef.current.clientWidth * 0.4 : 400;
    const newWidth = Math.max(180, Math.min(sidebarWidth + deltaX, maxWidth));
    setSidebarWidth(newWidth);
  };

  // Cut items shown with reduced opacity
  const cutPaths =
    clipboard?.operation === "cut" ? new Set(clipboard.items.map((i) => i.path)) : null;

  // Render the active view (list or grid)
  const renderBody = () => {
    if (layout === "grid") {
      return (
        <FileGrid
          onNavigate={props.onNavigate}
          onFileOpen={handleFileOpen}
          onContextMenu={handleContextMenu}
          renderEmptyState={props.renderEmptyState}
          renderNodeIcon={props.renderNodeIcon}
          cutPaths={cutPaths}
        />
      );
    }
    return (
      <FileList
        onNavigate={props.onNavigate}
        onFileOpen={handleFileOpen}
        onContextMenu={handleContextMenu}
        renderEmptyState={props.renderEmptyState}
        renderNodeIcon={props.renderNodeIcon}
        cutPaths={cutPaths}
      />
    );
  };

  return (
    <Box
      ref={shellRef}
      sx={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        overflow: "hidden",
        position: "relative",
      }}
      tabIndex={0}
      onKeyDown={depotRoot ? handleKeyDown : undefined}
    >
      {/* Toolbar — only when a depot is active */}
      {depotRoot && (
        <ExplorerToolbar
          renderBreadcrumb={props.renderBreadcrumb}
          onUpload={uploadFiles}
          onNewFolder={handleContextMenuNewFolder}
          onNavigate={props.onNavigate}
          extraToolbarItems={props.extraToolbarItems}
          fileInputRef={toolbarFileInputRef}
        />
      )}

      {/* Main body: sidebar + splitter + content + detail */}
      <Box sx={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Directory tree sidebar (always visible) */}
        <Box
          sx={{
            width: sidebarCollapsed ? 36 : sidebarWidth,
            minWidth: sidebarCollapsed ? 36 : 180,
            flexShrink: 0,
            overflow: "hidden",
          }}
        >
          <DirectoryTree onNavigate={props.onNavigate} />
        </Box>

        {/* Resizable splitter */}
        {!sidebarCollapsed && <ResizableSplitter onResize={handleSidebarResize} />}

        {/* Main content area */}
        <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {!depotId ? (
            /* No depot selected — empty state */
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
              }}
            >
              <Typography color="text.secondary">{t("tree.selectDepot")}</Typography>
            </Box>
          ) : !depotRoot ? (
            /* Depot selected but root not yet loaded */
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
              }}
            >
              <CircularProgress size={28} />
            </Box>
          ) : (
            <UploadOverlay onDrop={uploadFiles} canUpload={permissions.canUpload}>
              <Box sx={{ flex: 1, overflow: "auto" }}>{renderBody()}</Box>
            </UploadOverlay>
          )}
        </Box>

        {/* Detail panel (Iter 4) */}
        {detailPanelOpen && depotRoot && <DetailPanel />}
      </Box>

      {depotRoot && <StatusBar />}

      {/* Context menu (Iter 4: clipboard items enabled) — only when depot is active */}
      {depotRoot && (
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
          onCopy={handleContextMenuCopy}
          onCut={handleContextMenuCut}
          onPaste={handleContextMenuPaste}
          canPaste={!!clipboard}
          onDownload={handleDownload}
        />
      )}

      {/* Hidden file inputs for upload */}
      <input
        ref={contextMenuFileInputRef}
        type="file"
        multiple
        hidden
        onChange={handleContextMenuFileChange}
      />
      <input
        ref={toolbarFileInputRef}
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

      {/* Conflict dialog (Iter 4) */}
      <ConflictDialog
        open={!!conflictInfo}
        conflict={conflictInfo}
        onResolve={handleConflictResolve}
        onCancel={() => setConflictInfo(null)}
      />

      {/* Preview panel (Iter 4) */}
      <PreviewPanel
        item={previewItem}
        onClose={() => setPreviewItem(null)}
        previewProviders={props.previewProviders}
      />

      {/* Error snackbar */}
      <ErrorSnackbar onError={props.onError} />
    </Box>
  );
}
