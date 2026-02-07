import { useEffect } from "react";
import { useFileBrowserStore } from "../stores/file-browser-store";

type KeyboardHandlers = {
  onDelete: () => void;
  onRename: () => void;
  allNames: string[];
};

export function useKeyboardShortcuts({ onDelete, onRename, allNames }: KeyboardHandlers) {
  const { selection, selectAll, clearSelection } = useFileBrowserStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle shortcuts when typing in inputs
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "Delete" || e.key === "Backspace") {
        if (selection.size > 0) {
          e.preventDefault();
          onDelete();
        }
      }

      if (e.key === "F2") {
        if (selection.size === 1) {
          e.preventDefault();
          onRename();
        }
      }

      if (e.key === "a" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        selectAll(allNames);
      }

      if (e.key === "Escape") {
        clearSelection();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selection, selectAll, clearSelection, onDelete, onRename, allNames]);
}
