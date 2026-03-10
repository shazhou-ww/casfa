/**
 * Clipboard hook for cut/copy/paste operations.
 * (Iter 4)
 */

import { useCallback } from "react";
import { useExplorerStore } from "./use-explorer-context.ts";

export function useClipboard() {
  const clipboard = useExplorerStore((s) => s.clipboard);
  const selectedItems = useExplorerStore((s) => s.selectedItems);
  const currentPath = useExplorerStore((s) => s.currentPath);
  const copyItems = useExplorerStore((s) => s.copyItems);
  const cutItems = useExplorerStore((s) => s.cutItems);
  const pasteItems = useExplorerStore((s) => s.pasteItems);
  const canPaste = useExplorerStore((s) => s.canPaste);

  const copy = useCallback(() => {
    if (selectedItems.length > 0) {
      copyItems(selectedItems);
    }
  }, [selectedItems, copyItems]);

  const cut = useCallback(() => {
    if (selectedItems.length > 0) {
      cutItems(selectedItems);
    }
  }, [selectedItems, cutItems]);

  const paste = useCallback(() => {
    if (canPaste()) {
      pasteItems(currentPath);
    }
  }, [currentPath, pasteItems, canPaste]);

  return {
    clipboard,
    copy,
    cut,
    paste,
    canPaste: canPaste(),
    hasCopied: !!clipboard,
    isCutOperation: clipboard?.operation === "cut",
  };
}
