/**
 * Public types for @casfa/explorer
 */

import type { CasfaClient } from "@casfa/client";
import type { KeyProvider, StorageProvider } from "@casfa/core";
import type { SxProps, Theme } from "@mui/material";
import type React from "react";
import type { ExplorerStoreApi } from "./core/explorer-store.ts";

// ============================================================================
// Core Data Types
// ============================================================================

/** A single file or directory entry displayed in the explorer */
export type ExplorerItem = {
  /** File or directory name */
  name: string;
  /** Full path relative to depot root (empty string for root) */
  path: string;
  /** Whether this item is a directory */
  isDirectory: boolean;
  /** File size in bytes (file only) */
  size?: number;
  /** MIME content type (file only) */
  contentType?: string;
  /** CAS node key (nod_XXXX) */
  nodeKey?: string;
  /** Number of children (directory only) */
  childCount?: number;
  /** Index in the parent directory */
  index?: number;
  /** Sync status — "pending" means locally modified but not yet committed to server */
  syncStatus?: "pending";
};

/** A breadcrumb segment */
export type PathSegment = {
  /** Display name */
  name: string;
  /** Full path */
  path: string;
};

// ============================================================================
// Extension Points
// ============================================================================

/** Custom context menu item */
export type ExplorerMenuItem = {
  /** Unique key */
  key: string;
  /** Display label */
  label: string;
  /** MUI icon element */
  icon?: React.ReactNode;
  /** Whether the item is disabled */
  disabled?: boolean;
  /** Handler — receives the currently selected items */
  onClick: (items: ExplorerItem[]) => void;
};

/** Custom toolbar item */
export type ExplorerToolbarItem = {
  /** Unique key */
  key: string;
  /** Tooltip text */
  tooltip: string;
  /** MUI icon element */
  icon: React.ReactNode;
  /** Whether the item is disabled */
  disabled?: boolean;
  /** Click handler */
  onClick: () => void;
};

/** Content-type based file preview provider */
export type PreviewProvider = {
  /** Return true if this provider can handle the given content type */
  match: (contentType: string) => boolean;
  /** Render preview for the file */
  render: (props: PreviewRenderProps) => React.ReactNode;
};

export type PreviewRenderProps = {
  item: ExplorerItem;
  blob: Blob;
  contentType: string;
};

// ============================================================================
// Tree Types (Iter 3)
// ============================================================================

/** Node type for tree sidebar */
export type TreeNodeType = "depot-root" | "depot" | "directory";

/** A node in the directory tree sidebar */
export type TreeNode = {
  /** Full path key ("" for root, "depot:<id>" for depots, "depot:<id>/<dir>" for dirs) */
  path: string;
  /** Display name */
  name: string;
  /** Node type — defaults to "directory" when omitted */
  type?: TreeNodeType;
  /** Depot ID (set on "depot" and "directory" nodes within a depot) */
  depotId?: string;
  /** Child nodes — null means not yet loaded */
  children: TreeNode[] | null;
  /** Whether the node is currently expanded in the UI */
  isExpanded: boolean;
  /** Whether children are currently being loaded */
  isLoading: boolean;
};

// ============================================================================
// Sort Types (Iter 3)
// ============================================================================

/** Sortable column fields */
export type SortField = "name" | "size" | "type";

/** Sort direction */
export type SortDirection = "asc" | "desc";

// ============================================================================
// Clipboard Types (Iter 4)
// ============================================================================

/** Clipboard state for cut/copy/paste operations */
export type ClipboardData = {
  /** Items on the clipboard */
  items: ExplorerItem[];
  /** Whether the operation is copy or cut (move) */
  operation: "copy" | "cut";
};

// ============================================================================
// Conflict Resolution Types (Iter 4)
// ============================================================================

/** How to resolve a name conflict during paste/upload */
export type ConflictAction = "overwrite" | "skip" | "rename";

/** User's conflict resolution choice */
export type ConflictResolution = {
  action: ConflictAction;
  applyToAll: boolean;
};

/** Information about a name conflict */
export type ConflictInfo = {
  /** Source item */
  source: ExplorerItem;
  /** Existing target item */
  existing: ExplorerItem;
  /** Target path */
  targetPath: string;
};

// ============================================================================
// Detail Panel Types (Iter 4)
// ============================================================================

/** Metadata displayed in the detail panel */
export type DetailInfo = {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  formattedSize?: string;
  contentType?: string;
  nodeKey?: string;
  itemCount?: number;
};

// ============================================================================
// Upload Types
// ============================================================================

export type UploadStatus = "pending" | "uploading" | "done" | "error";

/** A single item in the upload queue */
export type UploadQueueItem = {
  /** Unique id */
  id: string;
  /** The file to upload */
  file: File;
  /** Target path in the depot */
  targetPath: string;
  /** Current status */
  status: UploadStatus;
  /** Error message when status is "error" */
  error?: string;
};

// ============================================================================
// Context Menu Types
// ============================================================================

/** Context passed to context menu item handlers */
export type MenuContext = {
  selectedItems: ExplorerItem[];
  currentPath: string;
  depotId: string;
};

// ============================================================================
// Permissions Types
// ============================================================================

/** Permissions derived from the current delegate */
export type ExplorerPermissions = {
  canUpload: boolean;
  canManageDepot: boolean;
};

// ============================================================================
// Error Types
// ============================================================================

export type ExplorerErrorType =
  | "network"
  | "auth_expired"
  | "permission_denied"
  | "not_found"
  | "file_too_large"
  | "name_conflict"
  | "unknown";

export type ExplorerError = {
  type: ExplorerErrorType;
  message: string;
  details?: unknown;
};

// ============================================================================
// Component Props
// ============================================================================

export type CasfaExplorerProps = {
  // ── Connection (required) ──
  /** Initialized CasfaClient instance (depot API, node uploads, auth) */
  client: CasfaClient;

  // ── CAS local operations ──
  /**
   * CAS StorageProvider for local tree operations.
   *
   * All filesystem operations (ls, mkdir, write, rm, mv) run locally
   * via @casfa/fs, fetching/storing individual CAS nodes through this
   * provider (typically CachedStorage backed by IndexedDB + HTTP).
   *
   * After write operations, the new root is committed to the server
   * via `client.depots.commit()`.
   */
  storage: StorageProvider;

  /**
   * Key provider for CAS node encoding.
   * Required for write operations (mkdir, write, rm, mv).
   */
  keyProvider: KeyProvider;

  // ── Depot ──
  /** Specify depot. Omit to show built-in depot selector */
  depotId?: string;
  /** Callback when depot changes */
  onDepotChange?: (depotId: string) => void;

  // ── Initial state ──
  /** Initial directory path, default "" (root) */
  initialPath?: string;
  /** Default view mode */
  initialLayout?: "list" | "grid";

  // ── Size ──
  /** Height, default "100%" */
  height?: string | number;
  /** Width, default "100%" */
  width?: string | number;

  // ── Extension points ──
  /** Custom context menu items (appended after built-in items) */
  extraContextMenuItems?: ExplorerMenuItem[];
  /** Custom toolbar buttons (appended after built-in buttons) */
  extraToolbarItems?: ExplorerToolbarItem[];
  /** Content-type based file preview providers */
  previewProviders?: PreviewProvider[];

  // ── Lifecycle hooks ──
  /**
   * Called before committing a new root to the server.
   * Use this to flush pending CAS node uploads (write-back mode)
   * so all referenced nodes exist on the remote before the root
   * pointer is updated.
   *
   * @deprecated Use `scheduleCommit` for background sync instead.
   */
  beforeCommit?: () => Promise<void>;

  /**
   * Schedule a depot root commit for background sync.
   *
   * When provided, write operations will NOT call `client.depots.commit()`
   * directly. Instead they call this callback which enqueues the commit
   * into the SyncManager. The SyncManager flushes Layer 1 (CAS nodes)
   * and Layer 2 (depot commit) in the background.
   */
  scheduleCommit?: (depotId: string, newRoot: string, lastKnownServerRoot: string | null) => void;

  /**
   * Return the pending (uncommitted) root for a depot, or null if none.
   * Used after page refresh to display local data instead of stale server root,
   * and to diff against server root to mark pending items.
   *
   * May return a Promise (e.g. when querying the Service Worker via RPC).
   */
  getSyncPendingRoot?: (depotId: string) => string | null | Promise<string | null>;

  /**
   * Subscribe to depot commit events for automatic root updates.
   *
   * When provided, the explorer store subscribes internally and handles:
   * - Updating serverRoot / depotRoot on merge
   * - Refreshing the directory view when root changes
   * - Broadcasting to other tabs via BroadcastChannel
   *
   * Typically pass `appClient.onCommit.bind(appClient)`.
   * Returns an unsubscribe function.
   */
  subscribeCommit?: (
    listener: (event: import("./core/sync-manager.ts").SyncCommitEvent) => void
  ) => () => void;

  // ── Event callbacks ──
  onNavigate?: (path: string) => void;
  onSelect?: (items: ExplorerItem[]) => void;
  onFileOpen?: (item: ExplorerItem) => void;
  onError?: (error: ExplorerError) => void;
  onRootChange?: (newRoot: string) => void;

  /**
   * Called once when the internal explorer store is created.
   * Use to obtain a reference for external integration (e.g. updating server root
   * from a SyncManager commit event).
   */
  onStoreReady?: (store: ExplorerStoreApi) => void;

  // ── Custom rendering ──
  renderEmptyState?: () => React.ReactNode;
  renderBreadcrumb?: (segments: PathSegment[]) => React.ReactNode;
  renderNodeIcon?: (item: ExplorerItem) => React.ReactNode;

  // ── Theme ──
  sx?: SxProps<Theme>;

  // ── i18n ──
  /** Locale key, default "en-US". Built-in: "en-US" | "zh-CN" */
  locale?: string;
  /** Decorator to override/extend built-in translations */
  i18n?: (builtinT: ExplorerT) => ExplorerT;
};

// ============================================================================
// i18n Types
// ============================================================================

/** Translation function */
export type ExplorerT = (key: ExplorerTextKey, params?: Record<string, string | number>) => string;

/** All translatable text keys */
export type ExplorerTextKey =
  // Depot selector
  | "depot.title"
  | "depot.empty"
  | "depot.search"
  | "depot.select"
  | "depot.create"
  | "depot.createTitle"
  | "depot.createLabel"
  | "depot.delete"
  | "depot.deleteConfirm"
  | "depot.deleteSuccess"
  | "depot.untitled"
  | "depot.info"
  | "depot.infoTitle"
  | "depot.infoId"
  | "depot.infoRoot"
  | "depot.infoMaxHistory"
  | "depot.infoHistoryCount"
  | "depot.infoCreatedAt"
  | "depot.infoUpdatedAt"
  // Toolbar
  | "toolbar.refresh"
  | "toolbar.upload"
  | "toolbar.newFolder"
  | "toolbar.viewList"
  | "toolbar.viewGrid"
  // Breadcrumb
  | "breadcrumb.root"
  // File list
  | "fileList.name"
  | "fileList.size"
  | "fileList.type"
  | "fileList.empty"
  | "fileList.loading"
  | "fileList.loadMore"
  // Context menu
  | "menu.open"
  | "menu.download"
  | "menu.rename"
  | "menu.delete"
  | "menu.copy"
  | "menu.cut"
  | "menu.paste"
  | "menu.newFolder"
  // Dialogs
  | "dialog.rename.title"
  | "dialog.rename.label"
  | "dialog.delete.title"
  | "dialog.delete.message"
  | "dialog.delete.messageMultiple"
  | "dialog.newFolder.title"
  | "dialog.newFolder.label"
  | "dialog.confirm"
  | "dialog.cancel"
  // Status bar
  | "status.items"
  | "status.selected"
  // Upload progress
  | "upload.dropHere"
  | "upload.uploading"
  | "upload.progress"
  | "upload.done"
  | "upload.error"
  | "upload.cancel"
  | "upload.retry"
  | "upload.fileTooLarge"
  // Errors
  | "error.network"
  | "error.authExpired"
  | "error.permissionDenied"
  | "error.notFound"
  | "error.fileTooLarge"
  | "error.nameConflict"
  | "error.unknown"
  // Permission
  | "permission.denied"
  // Delete results
  | "delete.success"
  | "delete.partial"
  // Validation
  | "validation.nameEmpty"
  | "validation.nameInvalid"
  | "validation.nameExists"
  // Navigation (Iter 3)
  | "nav.back"
  | "nav.forward"
  | "nav.up"
  // Search (Iter 3)
  | "search.placeholder"
  | "search.noResults"
  // Path input (Iter 3)
  | "pathInput.placeholder"
  | "pathInput.invalid"
  // Tree sidebar (Iter 3)
  | "sidebar.collapse"
  | "sidebar.expand"
  // Tree — depot integration
  | "tree.depots"
  | "tree.selectDepot"
  // Clipboard (Iter 4)
  | "clipboard.copied"
  | "clipboard.cut"
  | "clipboard.pasted"
  | "clipboard.pasteError"
  // Detail panel (Iter 4)
  | "detail.title"
  | "detail.name"
  | "detail.path"
  | "detail.size"
  | "detail.type"
  | "detail.nodeKey"
  | "detail.childCount"
  | "detail.noSelection"
  | "detail.multipleSelected"
  | "detail.totalSize"
  // Preview (Iter 4)
  | "preview.title"
  | "preview.unsupported"
  | "preview.loading"
  | "preview.error"
  | "preview.tooLarge"
  | "preview.open"
  | "preview.lines"
  // Conflict (Iter 4)
  | "conflict.title"
  | "conflict.message"
  | "conflict.overwrite"
  | "conflict.skip"
  | "conflict.rename"
  | "conflict.applyToAll"
  | "conflict.source"
  | "conflict.existing"
  // Drag and drop (Iter 4)
  | "dnd.moveItems"
  | "dnd.copyItems"
  // Upload (Iter 4)
  | "upload.cancelAll"
  | "upload.overallProgress";
