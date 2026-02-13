/**
 * Keyboard navigation hook for full keyboard control.
 * (Iter 4)
 *
 * Handles: arrow keys, Enter, Delete, F2, Ctrl+C/X/V/A, Ctrl+Shift+N, etc.
 */

import { useCallback } from "react";
import type { ExplorerItem } from "../types.ts";
import { useExplorerStore } from "./use-explorer-context.ts";

type UseKeyboardNavigationOpts = {
  onNavigate?: (path: string) => void;
  onFileOpen?: (item: ExplorerItem) => void;
  onNewFolder?: () => void;
  onUpload?: () => void;
};

export function useKeyboardNavigation(opts?: UseKeyboardNavigationOpts) {
  const navigate = useExplorerStore((s) => s.navigate);
  const goBack = useExplorerStore((s) => s.goBack);
  const goForward = useExplorerStore((s) => s.goForward);
  const goUp = useExplorerStore((s) => s.goUp);
  const canGoBack = useExplorerStore((s) => s.canGoBack);
  const canGoForward = useExplorerStore((s) => s.canGoForward);
  const canGoUp = useExplorerStore((s) => s.canGoUp);
  const setLayout = useExplorerStore((s) => s.setLayout);
  const setSearchTerm = useExplorerStore((s) => s.setSearchTerm);
  const refresh = useExplorerStore((s) => s.refresh);
  const permissions = useExplorerStore((s) => s.permissions);

  // Selection
  const selectedItems = useExplorerStore((s) => s.selectedItems);
  const setSelectedItems = useExplorerStore((s) => s.setSelectedItems);
  const getSortedItems = useExplorerStore((s) => s.getSortedItems);

  // Focus
  const focusIndex = useExplorerStore((s) => s.focusIndex);
  const setFocusIndex = useExplorerStore((s) => s.setFocusIndex);
  const layout = useExplorerStore((s) => s.layout);

  // Clipboard
  const copyItems = useExplorerStore((s) => s.copyItems);
  const cutItems = useExplorerStore((s) => s.cutItems);
  const pasteItems = useExplorerStore((s) => s.pasteItems);
  const canPaste = useExplorerStore((s) => s.canPaste);
  const currentPath = useExplorerStore((s) => s.currentPath);

  // Dialogs
  const openDialog = useExplorerStore((s) => s.openDialog);

  // Detail/Preview
  const toggleDetailPanel = useExplorerStore((s) => s.toggleDetailPanel);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Don't intercept when typing in input fields
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement).isContentEditable) {
        return;
      }

      const items = getSortedItems();
      const ctrlOrMeta = e.ctrlKey || e.metaKey;

      // ── Navigation shortcuts ──

      // Alt+Left → go back
      if (e.altKey && e.key === "ArrowLeft" && canGoBack()) {
        e.preventDefault();
        goBack();
        return;
      }

      // Alt+Right → go forward
      if (e.altKey && e.key === "ArrowRight" && canGoForward()) {
        e.preventDefault();
        goForward();
        return;
      }

      // Alt+Up or Backspace → go up (Backspace only when nothing selected)
      if ((e.altKey && e.key === "ArrowUp") || (e.key === "Backspace" && selectedItems.length === 0)) {
        if (canGoUp()) {
          e.preventDefault();
          goUp();
        }
        return;
      }

      // ── Clipboard ──

      // Ctrl+C → copy
      if (ctrlOrMeta && e.key === "c") {
        if (selectedItems.length > 0) {
          e.preventDefault();
          copyItems(selectedItems);
        }
        return;
      }

      // Ctrl+X → cut
      if (ctrlOrMeta && e.key === "x") {
        if (selectedItems.length > 0 && permissions.canUpload) {
          e.preventDefault();
          cutItems(selectedItems);
        }
        return;
      }

      // Ctrl+V → paste
      if (ctrlOrMeta && e.key === "v") {
        if (canPaste() && permissions.canUpload) {
          e.preventDefault();
          pasteItems(currentPath);
        }
        return;
      }

      // Ctrl+A → select all
      if (ctrlOrMeta && e.key === "a") {
        e.preventDefault();
        setSelectedItems(items);
        return;
      }

      // ── View shortcuts ──

      // Ctrl+Shift+1 → list view
      if (ctrlOrMeta && e.shiftKey && e.key === "1") {
        e.preventDefault();
        setLayout("list");
        return;
      }

      // Ctrl+Shift+2 → grid view
      if (ctrlOrMeta && e.shiftKey && e.key === "2") {
        e.preventDefault();
        setLayout("grid");
        return;
      }

      // Ctrl+F → focus search
      if (ctrlOrMeta && e.key === "f") {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent("explorer:focus-search"));
        return;
      }

      // Ctrl+Shift+N → new folder
      if (ctrlOrMeta && e.shiftKey && (e.key === "N" || e.key === "n")) {
        if (permissions.canUpload) {
          e.preventDefault();
          opts?.onNewFolder?.();
        }
        return;
      }

      // Ctrl+U → upload
      if (ctrlOrMeta && e.key === "u") {
        if (permissions.canUpload) {
          e.preventDefault();
          opts?.onUpload?.();
        }
        return;
      }

      // F5 → refresh
      if (e.key === "F5") {
        e.preventDefault();
        refresh();
        return;
      }

      // Ctrl+I → toggle detail panel
      if (ctrlOrMeta && e.key === "i") {
        e.preventDefault();
        toggleDetailPanel();
        return;
      }

      // ── Item operations ──

      // Delete or Backspace → delete selected
      if ((e.key === "Delete" || e.key === "Backspace") && permissions.canUpload && selectedItems.length > 0) {
        e.preventDefault();
        openDialog("delete", selectedItems[0]);
        return;
      }

      // F2 → rename
      if (e.key === "F2" && permissions.canUpload && selectedItems.length === 1) {
        e.preventDefault();
        openDialog("rename", selectedItems[0]);
        return;
      }

      // Enter → open focused/selected item
      if (e.key === "Enter") {
        const target = focusIndex !== null ? items[focusIndex] : selectedItems[0];
        if (target) {
          e.preventDefault();
          if (target.isDirectory) {
            navigate(target.path);
            opts?.onNavigate?.(target.path);
          } else {
            opts?.onFileOpen?.(target);
          }
        }
        return;
      }

      // Escape → clear search / selection / close panel
      if (e.key === "Escape") {
        setSearchTerm("");
        setSelectedItems([]);
        setFocusIndex(null);
        return;
      }

      // ── Arrow key focus navigation ──

      if (
        e.key === "ArrowDown" ||
        e.key === "ArrowUp" ||
        e.key === "ArrowLeft" ||
        e.key === "ArrowRight"
      ) {
        if (items.length === 0) return;
        e.preventDefault();

        let newIndex = focusIndex ?? -1;

        if (layout === "list") {
          // List view: up/down only
          if (e.key === "ArrowDown") newIndex = Math.min(newIndex + 1, items.length - 1);
          if (e.key === "ArrowUp") newIndex = Math.max(newIndex - 1, 0);
        } else {
          // Grid view: 2D navigation
          // Estimate columns from container (default 6)
          const cols = 6;
          if (e.key === "ArrowRight") newIndex = Math.min(newIndex + 1, items.length - 1);
          if (e.key === "ArrowLeft") newIndex = Math.max(newIndex - 1, 0);
          if (e.key === "ArrowDown") newIndex = Math.min(newIndex + cols, items.length - 1);
          if (e.key === "ArrowUp") newIndex = Math.max(newIndex - cols, 0);
        }

        setFocusIndex(newIndex);

        // If no modifier, also select the focused item
        if (!e.shiftKey && !ctrlOrMeta) {
          const item = items[newIndex];
          if (item) setSelectedItems([item]);
        }
        // Shift+Arrow → extend selection
        if (e.shiftKey) {
          const item = items[newIndex];
          if (item && !selectedItems.some((i) => i.path === item.path)) {
            setSelectedItems([...selectedItems, item]);
          }
        }
      }
    },
    [
      getSortedItems,
      canGoBack,
      canGoForward,
      canGoUp,
      goBack,
      goForward,
      goUp,
      navigate,
      selectedItems,
      setSelectedItems,
      focusIndex,
      setFocusIndex,
      layout,
      copyItems,
      cutItems,
      pasteItems,
      canPaste,
      currentPath,
      setLayout,
      setSearchTerm,
      refresh,
      openDialog,
      toggleDetailPanel,
      permissions,
      opts,
    ]
  );

  return { handleKeyDown, focusIndex };
}
