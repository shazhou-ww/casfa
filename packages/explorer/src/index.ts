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
export { DirectoryTree } from "./components/DirectoryTree.tsx";
export { ErrorSnackbar } from "./components/ErrorSnackbar.tsx";
export { ExplorerShell } from "./components/ExplorerShell.tsx";
export { ExplorerToolbar } from "./components/ExplorerToolbar.tsx";
export { FileGrid } from "./components/FileGrid.tsx";
export { FileList } from "./components/FileList.tsx";
export { NavigationButtons } from "./components/NavigationButtons.tsx";
export { PathInput } from "./components/PathInput.tsx";
export { RenameDialog } from "./components/RenameDialog.tsx";
export { ResizableSplitter } from "./components/ResizableSplitter.tsx";
export { SearchBox } from "./components/SearchBox.tsx";
export { StatusBar } from "./components/StatusBar.tsx";
export { UploadOverlay } from "./components/UploadOverlay.tsx";
export { UploadProgress } from "./components/UploadProgress.tsx";
export { ViewToggle } from "./components/ViewToggle.tsx";
// ── Store ──
export {
  createExplorerStore,
  type ExplorerState,
  type ExplorerStore,
  type ExplorerStoreApi,
} from "./core/explorer-store.ts";
// ── Hooks ──
export { useExplorerStore, useExplorerT } from "./hooks/use-explorer-context.ts";
export { useNavigation, useNavigationKeyboard } from "./hooks/use-navigation.ts";
export { useHighlightMatch, useSearch } from "./hooks/use-search.ts";
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
  SortDirection,
  SortField,
  TreeNode,
  UploadQueueItem,
  UploadStatus,
} from "./types.ts";
// ── Utilities ──
export { getIconCategory, getIconColor } from "./utils/icon-map.ts";
export { nextSortState, sortItems } from "./utils/sort.ts";
