/**
 * Explorer core Zustand store.
 *
 * Manages: depot selection, directory browsing, pagination, loading states.
 */

import type { CasfaClient } from "@casfa/client";
import type { DepotListItem, FsLsChild } from "@casfa/protocol";
import { createStore } from "zustand/vanilla";
import type { ExplorerItem } from "../types.ts";

// ============================================================================
// Types
// ============================================================================

export type ExplorerState = {
  // ── Connection ──
  client: CasfaClient;
  depotId: string | null;
  depotRoot: string | null; // current root node key

  // ── Depot list ──
  depots: DepotListItem[];
  depotsLoading: boolean;

  // ── Directory browsing ──
  currentPath: string;
  items: ExplorerItem[];
  isLoading: boolean;
  cursor: string | null;
  hasMore: boolean;
  totalItems: number;

  // ── Layout ──
  layout: "list" | "grid";
};

export type ExplorerActions = {
  // ── Depot ──
  loadDepots: () => Promise<void>;
  selectDepot: (depotId: string) => Promise<void>;

  // ── Navigation ──
  navigate: (path: string) => Promise<void>;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;

  // ── Layout ──
  setLayout: (layout: "list" | "grid") => void;
};

export type ExplorerStore = ExplorerState & ExplorerActions;

// ============================================================================
// Helpers
// ============================================================================

/** Convert FsLsChild to ExplorerItem */
function toExplorerItem(child: FsLsChild, parentPath: string): ExplorerItem {
  const path = parentPath ? `${parentPath}/${child.name}` : child.name;
  return {
    name: child.name,
    path,
    isDirectory: child.type === "dir",
    size: child.size,
    contentType: child.contentType,
    nodeKey: child.key,
    childCount: child.childCount,
    index: child.index,
  };
}

// ============================================================================
// Store Factory
// ============================================================================

export type CreateExplorerStoreOpts = {
  client: CasfaClient;
  depotId?: string;
  initialPath?: string;
  initialLayout?: "list" | "grid";
};

const LS_PAGE_SIZE = 200;

export const createExplorerStore = (opts: CreateExplorerStoreOpts) => {
  return createStore<ExplorerStore>()((set, get) => ({
    // ── Initial state ──
    client: opts.client,
    depotId: opts.depotId ?? null,
    depotRoot: null,
    depots: [],
    depotsLoading: false,
    currentPath: opts.initialPath ?? "",
    items: [],
    isLoading: false,
    cursor: null,
    hasMore: false,
    totalItems: 0,
    layout: opts.initialLayout ?? "list",

    // ── Depot actions ──
    loadDepots: async () => {
      set({ depotsLoading: true });
      const { client } = get();
      try {
        const result = await client.depots.list({ limit: 100 });
        if (result.ok) {
          set({ depots: result.data.depots, depotsLoading: false });
        } else {
          set({ depotsLoading: false });
        }
      } catch {
        set({ depotsLoading: false });
      }
    },

    selectDepot: async (depotId: string) => {
      const { client } = get();
      // Fetch depot detail to get root node key
      const result = await client.depots.get(depotId);
      if (result.ok) {
        set({
          depotId,
          depotRoot: result.data.root,
          currentPath: "",
          items: [],
          cursor: null,
          hasMore: false,
          totalItems: 0,
        });
        // Load root directory
        await get().navigate("");
      }
    },

    // ── Navigation ──
    navigate: async (path: string) => {
      const { client, depotRoot } = get();
      if (!depotRoot) return;

      set({ currentPath: path, items: [], isLoading: true, cursor: null, hasMore: false, totalItems: 0 });

      try {
        const result = await client.fs.ls(depotRoot, path || undefined, { limit: LS_PAGE_SIZE });
        if (result.ok) {
          const items = result.data.children.map((c) => toExplorerItem(c, path));
          set({
            items,
            cursor: result.data.nextCursor,
            hasMore: result.data.nextCursor !== null,
            totalItems: result.data.total,
            isLoading: false,
          });
        } else {
          set({ isLoading: false });
        }
      } catch {
        set({ isLoading: false });
      }
    },

    refresh: async () => {
      const { currentPath } = get();
      await get().navigate(currentPath);
    },

    loadMore: async () => {
      const { client, depotRoot, currentPath, cursor, items } = get();
      if (!depotRoot || !cursor) return;

      set({ isLoading: true });

      try {
        const result = await client.fs.ls(depotRoot, currentPath || undefined, {
          limit: LS_PAGE_SIZE,
          cursor,
        });
        if (result.ok) {
          const newItems = result.data.children.map((c) => toExplorerItem(c, currentPath));
          set({
            items: [...items, ...newItems],
            cursor: result.data.nextCursor,
            hasMore: result.data.nextCursor !== null,
            isLoading: false,
          });
        } else {
          set({ isLoading: false });
        }
      } catch {
        set({ isLoading: false });
      }
    },

    // ── Layout ──
    setLayout: (layout) => set({ layout }),
  }));
};

export type ExplorerStoreApi = ReturnType<typeof createExplorerStore>;
