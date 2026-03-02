import { Box } from "@mui/material";
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { DirectoryTree } from "../components/explorer/directory-tree";
import { pathToRoute, routeToPath } from "../lib/explorer-routes";
import { useExplorerStore } from "../stores/explorer-store";
import { useExplorerNavigate } from "../hooks/use-explorer-navigate";

export function ExplorerPage() {
  const location = useLocation();
  const { setCurrentPath } = useExplorerStore();
  const setPath = useExplorerNavigate();

  const pathFromRoute = routeToPath(location.pathname);

  useEffect(() => {
    setCurrentPath(pathFromRoute);
  }, [pathFromRoute, setCurrentPath]);

  return (
    <Box display="flex" flexDirection="column" height="100%" overflow="hidden">
      <DirectoryTree
        currentPath={pathFromRoute}
        onPathChange={setPath}
      />
    </Box>
  );
}
