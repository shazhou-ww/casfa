/**
 * English (US) translations for the explorer.
 */

import type { ExplorerT, ExplorerTextKey } from "../types.ts";

const messages: Record<ExplorerTextKey, string> = {
  // Depot selector
  "depot.title": "Select a Depot",
  "depot.empty": "No depots available",
  "depot.search": "Search depots…",
  "depot.select": "Select",
  "depot.create": "New Depot",
  "depot.createTitle": "Create Depot",
  "depot.createLabel": "Depot title (optional)",
  "depot.delete": "Delete Depot",
  "depot.deleteConfirm": 'Are you sure you want to delete depot "{name}"? This cannot be undone.',
  "depot.deleteSuccess": "Depot deleted",
  "depot.untitled": "Untitled Depot",
  "depot.info": "Depot Info",
  "depot.infoTitle": "Title",
  "depot.infoId": "Depot ID",
  "depot.infoRoot": "Root Node",
  "depot.infoMaxHistory": "Max History",
  "depot.infoHistoryCount": "History Count",
  "depot.infoCreatedAt": "Created At",
  "depot.infoUpdatedAt": "Updated At",
  // Toolbar
  "toolbar.refresh": "Refresh",
  "toolbar.upload": "Upload",
  "toolbar.newFolder": "New Folder",
  "toolbar.viewList": "List view",
  "toolbar.viewGrid": "Grid view",
  // Breadcrumb
  "breadcrumb.root": "Root",
  // File list
  "fileList.name": "Name",
  "fileList.size": "Size",
  "fileList.type": "Type",
  "fileList.empty": "This folder is empty",
  "fileList.loading": "Loading…",
  "fileList.loadMore": "Load more…",
  // Context menu
  "menu.open": "Open",
  "menu.download": "Download",
  "menu.rename": "Rename",
  "menu.delete": "Delete",
  "menu.copy": "Copy",
  "menu.cut": "Cut",
  "menu.paste": "Paste",
  "menu.newFolder": "New Folder",
  // Dialogs
  "dialog.rename.title": "Rename",
  "dialog.rename.label": "New name",
  "dialog.delete.title": "Delete",
  "dialog.delete.message": 'Are you sure you want to delete "{name}"?',
  "dialog.delete.messageMultiple": "Are you sure you want to delete {count} items?",
  "dialog.newFolder.title": "New Folder",
  "dialog.newFolder.label": "Folder name",
  "dialog.confirm": "Confirm",
  "dialog.cancel": "Cancel",
  // Status bar
  "status.items": "{count} items",
  "status.selected": "{count} selected",
  // Upload progress
  "upload.dropHere": "Drop files here to upload",
  "upload.uploading": "Uploading {current}/{total}",
  "upload.progress": "Uploading…",
  "upload.done": "Upload complete",
  "upload.error": "Upload failed",
  "upload.cancel": "Cancel",
  "upload.retry": "Retry",
  "upload.fileTooLarge": '"{name}" is too large, skipped',
  // Errors
  "error.network": "Network error. Please check your connection.",
  "error.authExpired": "Session expired. Please log in again.",
  "error.permissionDenied": "Permission denied.",
  "error.notFound": "Not found.",
  "error.fileTooLarge": "File is too large.",
  "error.nameConflict": "A file or folder with this name already exists.",
  "error.unknown": "An unexpected error occurred.",
  // Permission
  "permission.denied": "Insufficient permissions",
  // Delete results
  "delete.success": "Deleted successfully",
  "delete.partial": "Succeeded {success}, failed {failed}",
  // Validation
  "validation.nameEmpty": "Name cannot be empty",
  "validation.nameInvalid": "Name contains invalid characters",
  "validation.nameExists": "A file or folder with this name already exists",
  // Navigation (Iter 3)
  "nav.back": "Back",
  "nav.forward": "Forward",
  "nav.up": "Up one level",
  // Search (Iter 3)
  "search.placeholder": "Filter files…",
  "search.noResults": "No matching items",
  // Path input (Iter 3)
  "pathInput.placeholder": "Enter path…",
  "pathInput.invalid": "Invalid path",
  // Tree sidebar (Iter 3)
  "sidebar.collapse": "Collapse sidebar",
  "sidebar.expand": "Expand sidebar",
  // Tree — depot integration
  "tree.depots": "Depots",
  "tree.selectDepot": "Select a depot to browse files",
  // Clipboard (Iter 4)
  "clipboard.copied": "{count} item(s) copied",
  "clipboard.cut": "{count} item(s) cut",
  "clipboard.pasted": "Pasted successfully",
  "clipboard.pasteError": "Paste failed",
  // Detail panel (Iter 4)
  "detail.title": "Details",
  "detail.name": "Name",
  "detail.path": "Path",
  "detail.size": "Size",
  "detail.type": "Type",
  "detail.nodeKey": "Node Key",
  "detail.childCount": "Children",
  "detail.refCount": "Ref Count",
  "detail.noSelection": "No item selected",
  "detail.multipleSelected": "{count} items selected",
  "detail.totalSize": "Total size",
  // Preview (Iter 4)
  "preview.title": "Preview",
  "preview.unsupported": "Preview not available for this file type",
  "preview.loading": "Loading preview\u2026",
  "preview.error": "Failed to load preview",
  "preview.tooLarge": "File is too large to preview",
  "preview.open": "Open",
  "preview.lines": "{count} lines",
  // Conflict (Iter 4)
  "conflict.title": "File Conflict",
  "conflict.message": 'A file named "{name}" already exists in the destination',
  "conflict.overwrite": "Overwrite",
  "conflict.skip": "Skip",
  "conflict.rename": "Keep both (rename)",
  "conflict.applyToAll": "Apply to all conflicts",
  "conflict.source": "Source",
  "conflict.existing": "Existing",
  // Drag and drop (Iter 4)
  "dnd.moveItems": "Move {count} item(s)",
  "dnd.copyItems": "Copy {count} item(s)",
  // Upload enhancements (Iter 4)
  "upload.cancelAll": "Cancel all",
  "upload.overallProgress": "Overall progress",
  // Depot history (Iter 5)
  "depot.historyTab": "History",
  "depot.infoTab": "Info",
  "depot.historyEmpty": "No history",
  "depot.historyCurrent": "Current",
  "depot.historyRollback": "Rollback to this version",
  "depot.historyRollbackConfirm":
    "Are you sure you want to rollback to the version from {time}? This will create a new commit pointing to that version.",
  "depot.historyRollbackSuccess": "Rolled back successfully",
  "depot.historyRollbackError": "Failed to rollback",
  "depot.historyDiffAdded": "Added",
  "depot.historyDiffRemoved": "Removed",
  "depot.historyDiffModified": "Modified",
  "depot.historyDiffMoved": "Moved",
  "depot.historyDiffTruncated": "…and more changes",
  "depot.historyDiffNone": "No diff available",
  "depot.historyRollingBack": "Rolling back…",  // Viewer (Iter 6)
  "menu.openWith": "Open with\u2026",
  "menu.addAsViewer": "Add as Viewer",
  "preview.viewer": "Viewer",};

/**
 * Create the English translation function.
 */
export const createEnUsT = (): ExplorerT => {
  return (key, params) => {
    let text = messages[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replaceAll(`{${k}}`, String(v));
      }
    }
    return text;
  };
};
