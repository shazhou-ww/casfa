import { Box } from "@mui/material";
import { useCallback, useState } from "react";
import { DirectoryTree } from "../components/explorer/directory-tree";

export function ExplorerPage() {
  const [currentPath, setCurrentPath] = useState("/");

  const handlePathChange = useCallback((path: string) => {
    setCurrentPath(path || "/");
  }, []);

  return (
    <Box display="flex" flexDirection="column" height="100%" overflow="hidden">
      <DirectoryTree
        currentPath={currentPath}
        onPathChange={handlePathChange}
        useMock={true}
      />
    </Box>
  );
}
