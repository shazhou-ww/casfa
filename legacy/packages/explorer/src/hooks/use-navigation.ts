/**
 * Navigation-related hooks for Iter 3.
 */

import { useCallback } from "react";
import { useExplorerStore } from "./use-explorer-context.ts";

/**
 * Hook that returns navigation state and actions.
 */
export function useNavigation() {
  const goBack = useExplorerStore((s) => s.goBack);
  const goForward = useExplorerStore((s) => s.goForward);
  const goUp = useExplorerStore((s) => s.goUp);
  const navigate = useExplorerStore((s) => s.navigate);
  const canGoBack = useExplorerStore((s) => s.canGoBack);
  const canGoForward = useExplorerStore((s) => s.canGoForward);
  const canGoUp = useExplorerStore((s) => s.canGoUp);
  const currentPath = useExplorerStore((s) => s.currentPath);

  return {
    goBack,
    goForward,
    goUp,
    navigate,
    canGoBack: canGoBack(),
    canGoForward: canGoForward(),
    canGoUp: canGoUp(),
    currentPath,
  };
}

/**
 * Hook for keyboard navigation shortcuts.
 *
 * Returns a keydown handler to attach to the container element.
 */
export function useNavigationKeyboard(opts?: { onNavigate?: (path: string) => void }) {
  const { goBack, goForward, goUp, canGoBack, canGoForward, canGoUp } = useNavigation();
  const setLayout = useExplorerStore((s) => s.setLayout);
  const setSearchTerm = useExplorerStore((s) => s.setSearchTerm);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Alt+Left → go back
      if (e.altKey && e.key === "ArrowLeft" && canGoBack) {
        e.preventDefault();
        goBack();
        return;
      }

      // Alt+Right → go forward
      if (e.altKey && e.key === "ArrowRight" && canGoForward) {
        e.preventDefault();
        goForward();
        return;
      }

      // Alt+Up → go up
      if (e.altKey && e.key === "ArrowUp" && canGoUp) {
        e.preventDefault();
        goUp();
        return;
      }

      // Ctrl/Cmd+Shift+1 → list view
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "1") {
        e.preventDefault();
        setLayout("list");
        return;
      }

      // Ctrl/Cmd+Shift+2 → grid view
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "2") {
        e.preventDefault();
        setLayout("grid");
        return;
      }

      // Ctrl/Cmd+F → focus search
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        // Focus is handled by SearchBox via ref
        // We dispatch a custom event that SearchBox listens to
        document.dispatchEvent(new CustomEvent("explorer:focus-search"));
        return;
      }

      // Escape → clear search
      if (e.key === "Escape") {
        setSearchTerm("");
      }
    },
    [goBack, goForward, goUp, canGoBack, canGoForward, canGoUp, setLayout, setSearchTerm]
  );

  return handleKeyDown;
}
