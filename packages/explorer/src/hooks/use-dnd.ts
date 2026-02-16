/**
 * Drag-and-drop hook using @dnd-kit/core.
 * (Iter 4)
 *
 * Manages drag state and drop logic for moving/copying items
 * between directories.
 */

import { useCallback, useState } from "react";
import type { ExplorerItem } from "../types.ts";
import { useExplorerStore } from "./use-explorer-context.ts";

export type DragState = {
  /** Items being dragged */
  items: ExplorerItem[];
  /** Whether Alt is held (copy mode) */
  isCopy: boolean;
};

/**
 * Check whether dropping `srcPath` into `targetPath` would create a cycle.
 */
export function isDescendantPath(srcPath: string, targetPath: string): boolean {
  if (srcPath === targetPath) return true;
  return targetPath.startsWith(`${srcPath}/`);
}

export function useDnd() {
  const localFs = useExplorerStore((s) => s.localFs);
  const client = useExplorerStore((s) => s.client);
  const depotId = useExplorerStore((s) => s.depotId);
  const depotRoot = useExplorerStore((s) => s.depotRoot);
  const serverRoot = useExplorerStore((s) => s.serverRoot);
  const beforeCommit = useExplorerStore((s) => s.beforeCommit);
  const scheduleCommit = useExplorerStore((s) => s.scheduleCommit);
  const reloadDir = useExplorerStore((s) => s.reloadDir);
  const selectedItems = useExplorerStore((s) => s.selectedItems);
  const setSelectedItems = useExplorerStore((s) => s.setSelectedItems);
  const updateDepotRoot = useExplorerStore((s) => s.updateDepotRoot);
  const setError = useExplorerStore((s) => s.setError);

  const [dragState, setDragState] = useState<DragState | null>(null);

  const handleDragStart = useCallback(
    (item: ExplorerItem, altKey: boolean) => {
      // If the dragged item is in the selection, drag all selected
      const items = selectedItems.some((i) => i.path === item.path) ? selectedItems : [item];
      setDragState({ items, isCopy: altKey });
    },
    [selectedItems]
  );

  const handleDragEnd = useCallback(
    async (targetPath: string | null, isCopy: boolean) => {
      if (!dragState || !targetPath || !depotRoot || !depotId) {
        setDragState(null);
        return;
      }

      // Validate: can't drop into self or descendant
      for (const item of dragState.items) {
        if (isDescendantPath(item.path, targetPath)) {
          setDragState(null);
          return;
        }
      }

      let currentRoot = depotRoot;
      const op = isCopy ? "cp" : "mv";

      try {
        for (const item of dragState.items) {
          const dstPath = targetPath ? `${targetPath}/${item.name}` : item.name;
          const result = await localFs[op](currentRoot, item.path, dstPath);
          if ("newRoot" in result) {
            currentRoot = result.newRoot;
          } else {
            setError({ type: "unknown", message: result.message });
          }
        }

        if (currentRoot !== depotRoot) {
          if (scheduleCommit) {
            scheduleCommit(depotId, currentRoot, serverRoot);
          } else {
            await beforeCommit?.();
            await client.depots.commit(depotId, { root: currentRoot });
          }
          updateDepotRoot(currentRoot);
        }

        setSelectedItems([]);
        await reloadDir();
      } catch {
        setError({ type: "network", message: "Drag operation failed" });
      } finally {
        setDragState(null);
      }
    },
    [
      dragState,
      depotRoot,
      depotId,
      localFs,
      client,
      beforeCommit,
      scheduleCommit,
      serverRoot,
      updateDepotRoot,
      setSelectedItems,
      reloadDir,
      setError,
    ]
  );

  const cancelDrag = useCallback(() => {
    setDragState(null);
  }, []);

  return {
    dragState,
    handleDragStart,
    handleDragEnd,
    cancelDrag,
    isDescendantPath,
  };
}
