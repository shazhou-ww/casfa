/**
 * Public types for @casfa/explorer
 */

import type { CasfaClient } from "@casfa/client";
import type { HashProvider, StorageProvider } from "@casfa/core";
import type { SxProps, Theme } from "@mui/material";
import type React from "react";

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
   * BLAKE3s-128 hash provider for CAS node encoding.
   * Required for write operations (mkdir, write, rm, mv).
   */
  hash: HashProvider;

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

  // ── Event callbacks ──
  onNavigate?: (path: string) => void;
  onSelect?: (items: ExplorerItem[]) => void;
  onFileOpen?: (item: ExplorerItem) => void;
  onError?: (error: ExplorerError) => void;
  onRootChange?: (newRoot: string) => void;

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
  | "validation.nameExists";
