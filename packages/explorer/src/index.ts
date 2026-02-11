/**
 * @casfa/explorer - CASFA file explorer React component
 *
 * @packageDocumentation
 */

// ── Sub-components (for advanced composition) ──
export { Breadcrumb } from "./components/Breadcrumb.tsx";
// ── Main component ──
export { CasfaExplorer } from "./components/CasfaExplorer.tsx";
export { ConfirmDialog } from "./components/ConfirmDialog.tsx";
export { ContextMenu } from "./components/ContextMenu.tsx";
export { CreateFolderDialog } from "./components/CreateFolderDialog.tsx";
export { DepotSelector } from "./components/DepotSelector.tsx";
export { ErrorSnackbar } from "./components/ErrorSnackbar.tsx";
export { ExplorerShell } from "./components/ExplorerShell.tsx";
export { ExplorerToolbar } from "./components/ExplorerToolbar.tsx";
export { FileList } from "./components/FileList.tsx";
export { RenameDialog } from "./components/RenameDialog.tsx";
export { StatusBar } from "./components/StatusBar.tsx";
export { UploadOverlay } from "./components/UploadOverlay.tsx";
export { UploadProgress } from "./components/UploadProgress.tsx";
// ── Store ──
export {
  createExplorerStore,
  type ExplorerState,
  type ExplorerStore,
  type ExplorerStoreApi,
} from "./core/explorer-store.ts";
// ── Hooks ──
export { useExplorerStore, useExplorerT } from "./hooks/use-explorer-context.ts";
export { useUpload } from "./hooks/use-upload.ts";

// ── i18n ──
export { createEnUsT } from "./i18n/en-US.ts";
export { createZhCnT } from "./i18n/zh-CN.ts";

// ── Types ──
export type {
  CasfaExplorerProps,
  ExplorerError,
  ExplorerErrorType,
  ExplorerItem,
  ExplorerMenuItem,
  ExplorerPermissions,
  ExplorerT,
  ExplorerTextKey,
  ExplorerToolbarItem,
  MenuContext,
  PathSegment,
  PreviewProvider,
  PreviewRenderProps,
  UploadQueueItem,
  UploadStatus,
} from "./types.ts";
