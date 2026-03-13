import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { pathToRoute } from "../lib/explorer-routes";
import { useExplorerStore } from "../stores/explorer-store";

/**
 * Returns a function that sets the explorer path in the store and navigates to the corresponding route.
 */
export function useExplorerNavigate(): (path: string) => void {
  const navigate = useNavigate();
  const setCurrentPath = useExplorerStore((s) => s.setCurrentPath);

  return useCallback(
    (path: string) => {
      const p = path || "/";
      setCurrentPath(p);
      navigate(pathToRoute(p));
    },
    [navigate, setCurrentPath]
  );
}
