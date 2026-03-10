/**
 * Enhanced multi-selection hook.
 * (Iter 4)
 *
 * Supports: single click, Ctrl+Click toggle, Shift+Click range, Ctrl+A select all.
 */

import { useCallback } from "react";
import type { ExplorerItem } from "../types.ts";
import { useExplorerStore } from "./use-explorer-context.ts";

export function useSelection() {
  const selectedItems = useExplorerStore((s) => s.selectedItems);
  const setSelectedItems = useExplorerStore((s) => s.setSelectedItems);
  const lastSelectedIndex = useExplorerStore((s) => s.lastSelectedIndex);
  const setLastSelectedIndex = useExplorerStore((s) => s.setLastSelectedIndex);
  const getSortedItems = useExplorerStore((s) => s.getSortedItems);

  /** Single-click: select only this item */
  const select = useCallback(
    (item: ExplorerItem, items: ExplorerItem[]) => {
      setSelectedItems([item]);
      const idx = items.findIndex((i) => i.path === item.path);
      setLastSelectedIndex(idx >= 0 ? idx : null);
    },
    [setSelectedItems, setLastSelectedIndex]
  );

  /** Ctrl/Cmd+Click: toggle item in selection */
  const toggleSelect = useCallback(
    (item: ExplorerItem, items: ExplorerItem[]) => {
      const isSelected = selectedItems.some((i) => i.path === item.path);
      if (isSelected) {
        setSelectedItems(selectedItems.filter((i) => i.path !== item.path));
      } else {
        setSelectedItems([...selectedItems, item]);
      }
      const idx = items.findIndex((i) => i.path === item.path);
      setLastSelectedIndex(idx >= 0 ? idx : null);
    },
    [selectedItems, setSelectedItems, setLastSelectedIndex]
  );

  /** Shift+Click: range select from last selected to current */
  const rangeSelect = useCallback(
    (item: ExplorerItem, items: ExplorerItem[]) => {
      const currentIdx = items.findIndex((i) => i.path === item.path);
      if (currentIdx < 0) return;

      const anchor = lastSelectedIndex ?? 0;
      const start = Math.min(anchor, currentIdx);
      const end = Math.max(anchor, currentIdx);
      const rangeItems = items.slice(start, end + 1);

      setSelectedItems(rangeItems);
      // Keep the anchor (lastSelectedIndex) unchanged for range
    },
    [lastSelectedIndex, setSelectedItems]
  );

  /** Ctrl+A: select all items */
  const selectAll = useCallback(() => {
    const items = getSortedItems();
    setSelectedItems(items);
  }, [getSortedItems, setSelectedItems]);

  /** Clear selection */
  const clearSelection = useCallback(() => {
    setSelectedItems([]);
    setLastSelectedIndex(null);
  }, [setSelectedItems, setLastSelectedIndex]);

  /**
   * Handle a click on an item, dispatching to the correct selection mode
   * based on modifier keys.
   */
  const handleItemClick = useCallback(
    (item: ExplorerItem, e: React.MouseEvent, items: ExplorerItem[]) => {
      if (e.shiftKey) {
        rangeSelect(item, items);
      } else if (e.metaKey || e.ctrlKey) {
        toggleSelect(item, items);
      } else {
        select(item, items);
      }
    },
    [select, toggleSelect, rangeSelect]
  );

  return {
    selectedItems,
    lastSelectedIndex,
    select,
    toggleSelect,
    rangeSelect,
    selectAll,
    clearSelection,
    handleItemClick,
  };
}
