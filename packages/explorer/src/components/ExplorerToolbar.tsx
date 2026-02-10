/**
 * <ExplorerToolbar /> - Breadcrumb navigation + action buttons.
 */

import { useCallback } from "react";
import { Box, IconButton, Tooltip } from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import { useExplorerStore, useExplorerT } from "../hooks/use-explorer-context.ts";
import type { PathSegment } from "../types.ts";
import { Breadcrumb } from "./Breadcrumb.tsx";

type ExplorerToolbarProps = {
  renderBreadcrumb?: (segments: PathSegment[]) => React.ReactNode;
};

export function ExplorerToolbar({ renderBreadcrumb }: ExplorerToolbarProps) {
  const t = useExplorerT();
  const refresh = useExplorerStore((s) => s.refresh);

  const handleRefresh = useCallback(() => {
    refresh();
  }, [refresh]);

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        px: 1,
        py: 0.5,
        borderBottom: 1,
        borderColor: "divider",
        minHeight: 40,
        gap: 0.5,
      }}
    >
      <Box sx={{ flex: 1, overflow: "hidden" }}>
        <Breadcrumb renderBreadcrumb={renderBreadcrumb} />
      </Box>
      <Tooltip title={t("toolbar.refresh")}>
        <IconButton size="small" onClick={handleRefresh}>
          <RefreshIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  );
}
