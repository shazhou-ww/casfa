/**
 * <ViewToggle /> - List / Grid view toggle buttons.
 * (Iter 3)
 */

import GridViewIcon from "@mui/icons-material/GridView";
import ViewListIcon from "@mui/icons-material/ViewList";
import { ToggleButton, ToggleButtonGroup, Tooltip } from "@mui/material";
import { useCallback } from "react";
import { useExplorerStore, useExplorerT } from "../hooks/use-explorer-context.ts";

export function ViewToggle() {
  const t = useExplorerT();
  const layout = useExplorerStore((s) => s.layout);
  const setLayout = useExplorerStore((s) => s.setLayout);

  const handleChange = useCallback(
    (_e: React.MouseEvent, value: "list" | "grid" | null) => {
      if (value) setLayout(value);
    },
    [setLayout]
  );

  return (
    <ToggleButtonGroup
      value={layout}
      exclusive
      onChange={handleChange}
      size="small"
      sx={{ height: 28 }}
    >
      <ToggleButton value="list" sx={{ px: 0.75 }}>
        <Tooltip title={t("toolbar.viewList")}>
          <ViewListIcon fontSize="small" />
        </Tooltip>
      </ToggleButton>
      <ToggleButton value="grid" sx={{ px: 0.75 }}>
        <Tooltip title={t("toolbar.viewGrid")}>
          <GridViewIcon fontSize="small" />
        </Tooltip>
      </ToggleButton>
    </ToggleButtonGroup>
  );
}
