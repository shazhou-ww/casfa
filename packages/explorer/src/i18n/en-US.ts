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
  // Errors
  "error.network": "Network error. Please check your connection.",
  "error.authExpired": "Session expired. Please log in again.",
  "error.permissionDenied": "Permission denied.",
  "error.notFound": "Not found.",
  "error.fileTooLarge": "File is too large (max 4 MB).",
  "error.nameConflict": "A file or folder with this name already exists.",
  "error.unknown": "An unexpected error occurred.",
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
