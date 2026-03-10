/**
 * React context and hooks for accessing the explorer store.
 */

import { createContext, useContext } from "react";
import { useStore } from "zustand";
import type { ExplorerStore, ExplorerStoreApi } from "../core/explorer-store.ts";
import type { ExplorerT } from "../types.ts";

// ============================================================================
// Store Context
// ============================================================================

export const ExplorerStoreContext = createContext<ExplorerStoreApi | null>(null);

/**
 * Access the explorer Zustand store from within <CasfaExplorer>.
 * Must be used inside the ExplorerStoreContext provider.
 */
export function useExplorerStore<T>(selector: (state: ExplorerStore) => T): T {
  const store = useContext(ExplorerStoreContext);
  if (!store) {
    throw new Error("useExplorerStore must be used within <CasfaExplorer>");
  }
  return useStore(store, selector);
}

// ============================================================================
// i18n Context
// ============================================================================

export const ExplorerI18nContext = createContext<ExplorerT | null>(null);

/**
 * Access the translation function.
 */
export function useExplorerT(): ExplorerT {
  const t = useContext(ExplorerI18nContext);
  if (!t) {
    throw new Error("useExplorerT must be used within <CasfaExplorer>");
  }
  return t;
}
