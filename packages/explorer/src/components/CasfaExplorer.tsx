/**
 * <CasfaExplorer /> - Top-level file explorer component.
 */

import { useMemo, useRef } from "react";
import { Box } from "@mui/material";
import {
  createExplorerStore,
  type ExplorerStoreApi,
} from "../core/explorer-store.ts";
import {
  ExplorerStoreContext,
  ExplorerI18nContext,
} from "../hooks/use-explorer-context.ts";
import { createEnUsT } from "../i18n/en-US.ts";
import { createZhCnT } from "../i18n/zh-CN.ts";
import type { CasfaExplorerProps, ExplorerT } from "../types.ts";
import { DepotSelector } from "./DepotSelector.tsx";
import { ExplorerShell } from "./ExplorerShell.tsx";

const localeFactories: Record<string, () => ExplorerT> = {
  "en-US": createEnUsT,
  "zh-CN": createZhCnT,
};

export function CasfaExplorer(props: CasfaExplorerProps) {
  const store = useRef<ExplorerStoreApi | null>(null);

  if (!store.current) {
    store.current = createExplorerStore({
      client: props.client,
      depotId: props.depotId,
      initialPath: props.initialPath,
      initialLayout: props.initialLayout,
    });
  }

  const t = useMemo<ExplorerT>(() => {
    const locale = props.locale ?? "en-US";
    const factory = localeFactories[locale] ?? createEnUsT;
    const builtinT = factory();
    return props.i18n ? props.i18n(builtinT) : builtinT;
  }, [props.locale, props.i18n]);

  return (
    <ExplorerStoreContext.Provider value={store.current}>
      <ExplorerI18nContext.Provider value={t}>
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            height: props.height ?? "100%",
            width: props.width ?? "100%",
            overflow: "hidden",
            border: 1,
            borderColor: "divider",
            borderRadius: 1,
            ...((props.sx ?? {}) as Record<string, unknown>),
          }}
        >
          <ExplorerShell
            onNavigate={props.onNavigate}
            onSelect={props.onSelect}
            onFileOpen={props.onFileOpen}
            onError={props.onError}
            onDepotChange={props.onDepotChange}
            renderEmptyState={props.renderEmptyState}
            renderBreadcrumb={props.renderBreadcrumb}
            renderNodeIcon={props.renderNodeIcon}
            extraContextMenuItems={props.extraContextMenuItems}
            extraToolbarItems={props.extraToolbarItems}
          />
        </Box>
      </ExplorerI18nContext.Provider>
    </ExplorerStoreContext.Provider>
  );
}
