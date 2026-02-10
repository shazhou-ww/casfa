/**
 * <ExplorerShell /> - Layout shell that switches between
 * DepotSelector and the file browser views.
 */

import { useEffect } from "react";
import { Box } from "@mui/material";
import { useExplorerStore } from "../hooks/use-explorer-context.ts";
import type { ExplorerError, ExplorerItem, PathSegment } from "../types.ts";
import { DepotSelector } from "./DepotSelector.tsx";
import { ExplorerToolbar } from "./ExplorerToolbar.tsx";
import { FileList } from "./FileList.tsx";
import { StatusBar } from "./StatusBar.tsx";

type ExplorerShellProps = {
  onNavigate?: (path: string) => void;
  onSelect?: (items: ExplorerItem[]) => void;
  onFileOpen?: (item: ExplorerItem) => void;
  onError?: (error: ExplorerError) => void;
  onDepotChange?: (depotId: string) => void;
  renderEmptyState?: () => React.ReactNode;
  renderBreadcrumb?: (segments: PathSegment[]) => React.ReactNode;
  renderNodeIcon?: (item: ExplorerItem) => React.ReactNode;
};

export function ExplorerShell(props: ExplorerShellProps) {
  const depotId = useExplorerStore((s) => s.depotId);
  const depotRoot = useExplorerStore((s) => s.depotRoot);
  const selectDepot = useExplorerStore((s) => s.selectDepot);

  useEffect(() => {
    if (depotId && !depotRoot) {
      selectDepot(depotId);
    }
  }, [depotId, depotRoot, selectDepot]);

  if (!depotId) {
    return (
      <DepotSelector
        onSelect={(id) => {
          selectDepot(id);
          props.onDepotChange?.(id);
        }}
      />
    );
  }

  if (!depotRoot) {
    return null;
  }

  return (
    <>
      <ExplorerToolbar renderBreadcrumb={props.renderBreadcrumb} />
      <Box sx={{ flex: 1, overflow: "auto" }}>
        <FileList
          onNavigate={props.onNavigate}
          onFileOpen={props.onFileOpen}
          renderEmptyState={props.renderEmptyState}
          renderNodeIcon={props.renderNodeIcon}
        />
      </Box>
      <StatusBar />
    </>
  );
}
