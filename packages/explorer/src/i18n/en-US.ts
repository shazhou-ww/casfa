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
  "upload.fileTooLarge": '"{name}" is too large (max 4 MB), skipped',
  // Errors
  "error.network": "Network error. Please check your connection.",
  "error.authExpired": "Session expired. Please log in again.",
  "error.permissionDenied": "Permission denied.",
  "error.notFound": "Not found.",
  "error.fileTooLarge": "File is too large (max 4 MB).",
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
};

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
