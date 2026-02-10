/**
 * @casfa/explorer - CASFA file explorer React component
 *
 * @packageDocumentation
 */

// ── Main component ──
export { CasfaExplorer } from "./components/CasfaExplorer.tsx";

// ── Sub-components (for advanced composition) ──
export { Breadcrumb } from "./components/Breadcrumb.tsx";
export { DepotSelector } from "./components/DepotSelector.tsx";
export { ExplorerShell } from "./components/ExplorerShell.tsx";
export { ExplorerToolbar } from "./components/ExplorerToolbar.tsx";
export { FileList } from "./components/FileList.tsx";
export { StatusBar } from "./components/StatusBar.tsx";

// ── Hooks ──
export { useExplorerStore, useExplorerT } from "./hooks/use-explorer-context.ts";

// ── Store ──
export {
  createExplorerStore,
  type ExplorerState,
  type ExplorerStore,
  type ExplorerStoreApi,
} from "./core/explorer-store.ts";

// ── i18n ──
export { createEnUsT } from "./i18n/en-US.ts";
export { createZhCnT } from "./i18n/zh-CN.ts";

// ── Types ──
export type {
  CasfaExplorerProps,
  ExplorerError,
  ExplorerErrorType,
  ExplorerItem,
  ExplorerMenuItem,
  ExplorerT,
  ExplorerTextKey,
  ExplorerToolbarItem,
  PathSegment,
  PreviewProvider,
  PreviewRenderProps,
} from "./types.ts";
