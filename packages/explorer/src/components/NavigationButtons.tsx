/**
 * <NavigationButtons /> - Back / Forward / Up navigation buttons.
 * (Iter 3)
 */

import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import { IconButton, Tooltip } from "@mui/material";
import { useExplorerStore, useExplorerT } from "../hooks/use-explorer-context.ts";

type NavigationButtonsProps = {
  onNavigate?: (path: string) => void;
};

export function NavigationButtons({ onNavigate }: NavigationButtonsProps) {
  const t = useExplorerT();
  const goBack = useExplorerStore((s) => s.goBack);
  const goForward = useExplorerStore((s) => s.goForward);
  const goUp = useExplorerStore((s) => s.goUp);
  const canGoBack = useExplorerStore((s) => s.canGoBack);
  const canGoForward = useExplorerStore((s) => s.canGoForward);
  const canGoUp = useExplorerStore((s) => s.canGoUp);

  return (
    <>
      <Tooltip title={t("nav.back")}>
        <span>
          <IconButton size="small" disabled={!canGoBack()} onClick={() => goBack()}>
            <ArrowBackIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={t("nav.forward")}>
        <span>
          <IconButton size="small" disabled={!canGoForward()} onClick={() => goForward()}>
            <ArrowForwardIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={t("nav.up")}>
        <span>
          <IconButton size="small" disabled={!canGoUp()} onClick={() => goUp()}>
            <ArrowUpwardIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
    </>
  );
}
