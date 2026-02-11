/**
 * <StatusBar /> - Bottom status bar showing item count, selection, and depot info.
 */

import { Box, Typography } from "@mui/material";
import { useExplorerStore, useExplorerT } from "../hooks/use-explorer-context.ts";

export function StatusBar() {
  const t = useExplorerT();
  const totalItems = useExplorerStore((s) => s.totalItems);
  const depotId = useExplorerStore((s) => s.depotId);
  const selectedItems = useExplorerStore((s) => s.selectedItems);

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        px: 1.5,
        py: 0.5,
        borderTop: 1,
        borderColor: "divider",
        minHeight: 28,
      }}
    >
      <Box sx={{ display: "flex", gap: 2 }}>
        <Typography variant="caption" color="text.secondary">
          {t("status.items", { count: totalItems })}
        </Typography>
        {selectedItems.length > 0 && (
          <Typography variant="caption" color="text.secondary">
            {t("status.selected", { count: selectedItems.length })}
          </Typography>
        )}
      </Box>
      {depotId && (
        <Typography variant="caption" color="text.secondary" noWrap sx={{ ml: 2 }}>
          {depotId}
        </Typography>
      )}
    </Box>
  );
}
