/**
 * <StatusBar /> - Bottom status bar showing item count and depot info.
 */

import { Box, Typography } from "@mui/material";
import { useExplorerStore, useExplorerT } from "../hooks/use-explorer-context.ts";

export function StatusBar() {
  const t = useExplorerT();
  const totalItems = useExplorerStore((s) => s.totalItems);
  const depotId = useExplorerStore((s) => s.depotId);

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
      <Typography variant="caption" color="text.secondary">
        {t("status.items", { count: totalItems })}
      </Typography>
      {depotId && (
        <Typography variant="caption" color="text.secondary" noWrap sx={{ ml: 2 }}>
          {depotId}
        </Typography>
      )}
    </Box>
  );
}
