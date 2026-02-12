/**
 * Explorer core Zustand store.
 *
 * Manages: depot selection, directory browsing, pagination, loading states,
 * file selection, upload queue, permissions, and error state.
 */

import type { CasfaClient } from "@casfa/client";
import type { KeyProvider, StorageProvider } from "@casfa/core";
import { createFsService, type FsService, isFsError } from "@casfa/fs";
import type { DepotListItem, FsLsChild } from "@casfa/protocol";
import { createStore } from "zustand/vanilla";
import type {
  ClipboardData,
  ExplorerError,
  ExplorerItem,
  ExplorerPermissions,
  SortDirection,
  SortField,
  TreeNode,
  UploadQueueItem,
} from "../types.ts";
import { nextSortState, sortItems } from "../utils/sort.ts";

// ============================================================================
// Types
// ============================================================================

export type ExplorerState = {
  // ── Connection ──
  client: CasfaClient;
  /** Local @casfa/fs service — all tree operations (read & write) run locally */
  localFs: FsService;
  /** @deprecated Use scheduleCommit for background sync instead. */
  beforeCommit: (() => Promise<void>) | null;
  /** When provided, write ops enqueue background commit instead of direct call. */
  scheduleCommit:
    | ((depotId: string, newRoot: string, lastKnownServerRoot: string | null) => void)
    | null;
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

  // ── Navigation history (Iter 3) ──
  pathHistory: string[];
  historyIndex: number;

  // ── Tree sidebar (Iter 3) ──
  treeNodes: Map<string, TreeNode>;
  sidebarWidth: number;
  sidebarCollapsed: boolean;

  // ── Search (Iter 3) ──
  searchTerm: string;

  // ── Sort (Iter 3) ──
  sortField: SortField | null;
  sortDirection: SortDirection;

  // ── Clipboard (Iter 4) ──
  clipboard: ClipboardData | null;

  // ── Selection (Iter 2 + 4) ──
  selectedItems: ExplorerItem[];
  lastSelectedIndex: number | null;

  // ── Focus (Iter 4) ──
  focusIndex: number | null;

  // ── Detail Panel (Iter 4) ──
  detailPanelOpen: boolean;

  // ── Upload queue (Iter 2) ──
  uploadQueue: UploadQueueItem[];
  uploadConcurrency: number;

  // ── Operation loading (Iter 2) ──
  operationLoading: Record<string, boolean>;

  // ── Permissions (Iter 2) ──
  permissions: ExplorerPermissions;

  // ── Error (Iter 2) ──
  lastError: ExplorerError | null;

  // ── Dialog state (Iter 2) ──
  dialogState: {
    type: "none" | "createFolder" | "rename" | "delete";
    targetItem?: ExplorerItem;
  };
};

export type ExplorerActions = {
  // ── Depot ──
  loadDepots: () => Promise<void>;
  selectDepot: (depotId: string) => Promise<void>;
  createDepot: (title?: string) => Promise<string | null>;
  deleteDepot: (depotId: string) => Promise<boolean>;
  deselectDepot: () => void;

  // ── Navigation ──
  navigate: (path: string) => Promise<void>;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;

  // ── Layout ──
  setLayout: (layout: "list" | "grid") => void;

  // ── Navigation history (Iter 3) ──
  goBack: () => Promise<void>;
  goForward: () => Promise<void>;
  goUp: () => Promise<void>;

  // ── Tree sidebar (Iter 3) ──
  expandTreeNode: (path: string) => Promise<void>;
  collapseTreeNode: (path: string) => void;
  setSidebarWidth: (width: number) => void;
  toggleSidebar: () => void;

  // ── Search (Iter 3) ──
  setSearchTerm: (term: string) => void;

  // ── Sort (Iter 3) ──
  setSort: (field: SortField) => void;

  // ── Computed helpers (Iter 3) ──
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  canGoUp: () => boolean;
  getFilteredItems: () => ExplorerItem[];
  getSortedItems: () => ExplorerItem[];

  // ── Clipboard (Iter 4) ──
  copyItems: (items: ExplorerItem[]) => void;
  cutItems: (items: ExplorerItem[]) => void;
  pasteItems: (targetPath: string) => Promise<void>;
  canPaste: () => boolean;
  clearClipboard: () => void;

  // ── Selection (Iter 2 + 4) ──
  setSelectedItems: (items: ExplorerItem[]) => void;
  setLastSelectedIndex: (index: number | null) => void;
  clearSelection: () => void;

  // ── Focus (Iter 4) ──
  setFocusIndex: (index: number | null) => void;

  // ── Detail Panel (Iter 4) ──
  toggleDetailPanel: () => void;

  // ── Upload queue (Iter 2) ──
  addToUploadQueue: (files: File[]) => void;
  removeFromUploadQueue: (id: string) => void;
  updateUploadItem: (id: string, patch: Partial<UploadQueueItem>) => void;
  clearCompletedUploads: () => void;

  // ── Root pointer ──
  updateDepotRoot: (newRoot: string) => void;

  // ── File operations (Iter 2) ──
  createFolder: (name: string) => Promise<boolean>;
  deleteItems: (items: ExplorerItem[]) => Promise<{ success: number; failed: number }>;
  renameItem: (item: ExplorerItem, newName: string) => Promise<boolean>;

  // ── Operation loading (Iter 2) ──
  setOperationLoading: (op: string, loading: boolean) => void;

  // ── Permissions (Iter 2) ──
  setPermissions: (perms: Partial<ExplorerPermissions>) => void;

  // ── Error (Iter 2) ──
  setError: (error: ExplorerError | null) => void;

  // ── Dialog state (Iter 2) ──
  openDialog: (type: "createFolder" | "rename" | "delete", targetItem?: ExplorerItem) => void;
  closeDialog: () => void;
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
  /** CAS StorageProvider (CachedStorage: IndexedDB + HTTP) for local tree operations */
  storage: StorageProvider;
  /** Key provider for CAS node encoding */
  key: KeyProvider;
  depotId?: string;
  initialPath?: string;
  initialLayout?: "list" | "grid";
  /** @deprecated Use `scheduleCommit` for background sync instead. */
  beforeCommit?: () => Promise<void>;
  /**
   * When provided, write operations enqueue a background commit instead
   * of calling `client.depots.commit()` directly.
   */
  scheduleCommit?: (depotId: string, newRoot: string, lastKnownServerRoot: string | null) => void;
};

const LS_PAGE_SIZE = 200;

let uploadIdCounter = 0;
function nextUploadId(): string {
  return `upload_${++uploadIdCounter}_${Date.now()}`;
}

export const createExplorerStore = (opts: CreateExplorerStoreOpts) => {
  // Build local @casfa/fs service — all tree operations (read & write) run locally.
  // Nodes are fetched/stored via CachedStorage (IndexedDB + HTTP).
  // After write operations, the new root is committed to the server via depot API.
  const localFs: FsService = createFsService({
    ctx: {
      storage: opts.storage,
      key: opts.key,
    },
  });

  return createStore<ExplorerStore>()((set, get) => ({
    // ── Initial state ──
    client: opts.client,
    localFs,
    beforeCommit: opts.beforeCommit ?? null,
    scheduleCommit: opts.scheduleCommit ?? null,
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

    // ── Iter 3 initial state ──
    pathHistory: [opts.initialPath ?? ""],
    historyIndex: 0,
    treeNodes: new Map<string, TreeNode>(),
    sidebarWidth: 240,
    sidebarCollapsed: false,
    searchTerm: "",
    sortField: null,
    sortDirection: "asc" as SortDirection,

    // ── Iter 2 + 4 initial state ──
    clipboard: null,
    selectedItems: [],
    lastSelectedIndex: null,
    focusIndex: null,
    detailPanelOpen: false,
    uploadQueue: [],
    uploadConcurrency: 3,
    operationLoading: {},
    permissions: { canUpload: true, canManageDepot: true },
    lastError: null,
    dialogState: { type: "none" },

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

    createDepot: async (title?: string) => {
      const { client } = get();
      try {
        const result = await client.depots.create({ title, maxHistory: 20 });
        if (result.ok) {
          // Reload depot list
          await get().loadDepots();
          return result.data.depotId;
        }
        handleApiError(get, result.error);
        return null;
      } catch {
        get().setError({ type: "network", message: "Network error" });
        return null;
      }
    },

    deleteDepot: async (depotId: string) => {
      const { client } = get();
      try {
        const result = await client.depots.delete(depotId);
        if (result.ok) {
          // If the deleted depot is the currently selected one, deselect it
          if (get().depotId === depotId) {
            get().deselectDepot();
          }
          // Reload depot list
          await get().loadDepots();
          return true;
        }
        handleApiError(get, result.error);
        return false;
      } catch {
        get().setError({ type: "network", message: "Network error" });
        return false;
      }
    },

    deselectDepot: () => {
      set({
        depotId: null,
        depotRoot: null,
        currentPath: "",
        items: [],
        cursor: null,
        hasMore: false,
        totalItems: 0,
        selectedItems: [],
      });
    },

    // ── Navigation ──
    navigate: async (path: string) => {
      const { localFs, depotRoot, pathHistory, historyIndex } = get();
      if (!depotRoot) return;

      // Push to history stack (truncate forward history)
      const newHistory = [...pathHistory.slice(0, historyIndex + 1), path];
      set({
        currentPath: path,
        items: [],
        isLoading: true,
        cursor: null,
        hasMore: false,
        totalItems: 0,
        selectedItems: [],
        searchTerm: "",
        pathHistory: newHistory,
        historyIndex: newHistory.length - 1,
      });

      try {
        const result = await localFs.ls(depotRoot, path || undefined, undefined, LS_PAGE_SIZE);
        if (isFsError(result)) {
          handleFsError(get, result);
          set({ isLoading: false });
          return;
        }
        const items = result.children.map((c) => toExplorerItem(c, path));
        set({
          items,
          cursor: result.nextCursor,
          hasMore: result.nextCursor !== null,
          totalItems: result.total,
          isLoading: false,
        });
      } catch {
        set({ isLoading: false });
      }
    },

    refresh: async () => {
      const { localFs, depotRoot, currentPath } = get();
      if (!depotRoot) return;
      // Refresh without pushing to history
      set({
        items: [],
        isLoading: true,
        cursor: null,
        hasMore: false,
        totalItems: 0,
      });
      try {
        const result = await localFs.ls(
          depotRoot,
          currentPath || undefined,
          undefined,
          LS_PAGE_SIZE
        );
        if (isFsError(result)) {
          handleFsError(get, result);
          set({ isLoading: false });
          return;
        }
        const items = result.children.map((c) => toExplorerItem(c, currentPath));
        set({
          items,
          cursor: result.nextCursor,
          hasMore: result.nextCursor !== null,
          totalItems: result.total,
          isLoading: false,
        });
        // Also refresh tree node cache for current path
        const treeNodes = new Map(get().treeNodes);
        const node = treeNodes.get(currentPath);
        if (node?.isExpanded) {
          // Re-expand to refresh children
          await get().expandTreeNode(currentPath);
        }
      } catch {
        set({ isLoading: false });
      }
    },

    loadMore: async () => {
      const { localFs, depotRoot, currentPath, cursor, items } = get();
      if (!depotRoot || !cursor) return;

      set({ isLoading: true });

      try {
        const result = await localFs.ls(
          depotRoot,
          currentPath || undefined,
          undefined,
          LS_PAGE_SIZE,
          cursor
        );
        if (isFsError(result)) {
          handleFsError(get, result);
          set({ isLoading: false });
          return;
        }
        const newItems = result.children.map((c) => toExplorerItem(c, currentPath));
        set({
          items: [...items, ...newItems],
          cursor: result.nextCursor,
          hasMore: result.nextCursor !== null,
          isLoading: false,
        });
      } catch {
        set({ isLoading: false });
      }
    },

    // ── Layout ──
    setLayout: (layout) => set({ layout }),

    // ── Navigation history (Iter 3) ──
    goBack: async () => {
      const { historyIndex, pathHistory, localFs, depotRoot } = get();
      if (historyIndex <= 0 || !depotRoot) return;
      const newIndex = historyIndex - 1;
      const path = pathHistory[newIndex]!;
      set({
        historyIndex: newIndex,
        currentPath: path,
        items: [],
        isLoading: true,
        cursor: null,
        hasMore: false,
        totalItems: 0,
        selectedItems: [],
        searchTerm: "",
      });
      try {
        const result = await localFs.ls(depotRoot, path || undefined, undefined, LS_PAGE_SIZE);
        if (isFsError(result)) {
          handleFsError(get, result);
          set({ isLoading: false });
          return;
        }
        const items = result.children.map((c) => toExplorerItem(c, path));
        set({
          items,
          cursor: result.nextCursor,
          hasMore: result.nextCursor !== null,
          totalItems: result.total,
          isLoading: false,
        });
      } catch {
        set({ isLoading: false });
      }
    },

    goForward: async () => {
      const { historyIndex, pathHistory, localFs, depotRoot } = get();
      if (historyIndex >= pathHistory.length - 1 || !depotRoot) return;
      const newIndex = historyIndex + 1;
      const path = pathHistory[newIndex]!;
      set({
        historyIndex: newIndex,
        currentPath: path,
        items: [],
        isLoading: true,
        cursor: null,
        hasMore: false,
        totalItems: 0,
        selectedItems: [],
        searchTerm: "",
      });
      try {
        const result = await localFs.ls(depotRoot, path || undefined, undefined, LS_PAGE_SIZE);
        if (isFsError(result)) {
          handleFsError(get, result);
          set({ isLoading: false });
          return;
        }
        const items = result.children.map((c) => toExplorerItem(c, path));
        set({
          items,
          cursor: result.nextCursor,
          hasMore: result.nextCursor !== null,
          totalItems: result.total,
          isLoading: false,
        });
      } catch {
        set({ isLoading: false });
      }
    },

    goUp: async () => {
      const { currentPath } = get();
      if (!currentPath) return;
      const parentPath = currentPath.includes("/")
        ? currentPath.substring(0, currentPath.lastIndexOf("/"))
        : "";
      await get().navigate(parentPath);
    },

    // ── Computed navigation helpers (Iter 3) ──
    canGoBack: () => get().historyIndex > 0,
    canGoForward: () => get().historyIndex < get().pathHistory.length - 1,
    canGoUp: () => get().currentPath !== "",

    // ── Tree sidebar (Iter 3) ──
    expandTreeNode: async (path: string) => {
      const { localFs, depotRoot, treeNodes } = get();
      if (!depotRoot) return;

      const newMap = new Map(treeNodes);
      const existing = newMap.get(path);
      if (existing) {
        newMap.set(path, { ...existing, isExpanded: true, isLoading: true });
      } else {
        const name = path ? path.split("/").pop()! : "root";
        newMap.set(path, { path, name, children: null, isExpanded: true, isLoading: true });
      }
      set({ treeNodes: newMap });

      try {
        const result = await localFs.ls(depotRoot, path || undefined, undefined, LS_PAGE_SIZE);
        if (isFsError(result)) {
          const errMap = new Map(get().treeNodes);
          const node = errMap.get(path);
          if (node) errMap.set(path, { ...node, isLoading: false });
          set({ treeNodes: errMap });
          return;
        }
        const children: TreeNode[] = result.children
          .filter((c) => c.type === "dir")
          .map((c) => {
            const childPath = path ? `${path}/${c.name}` : c.name;
            // Preserve existing expanded state if previously loaded
            const prev = get().treeNodes.get(childPath);
            return (
              prev ?? {
                path: childPath,
                name: c.name,
                children: null,
                isExpanded: false,
                isLoading: false,
              }
            );
          });
        const doneMap = new Map(get().treeNodes);
        const node = doneMap.get(path);
        if (node) doneMap.set(path, { ...node, children, isLoading: false });
        set({ treeNodes: doneMap });
      } catch {
        const errMap = new Map(get().treeNodes);
        const node = errMap.get(path);
        if (node) errMap.set(path, { ...node, isLoading: false });
        set({ treeNodes: errMap });
      }
    },

    collapseTreeNode: (path: string) => {
      const newMap = new Map(get().treeNodes);
      const node = newMap.get(path);
      if (node) newMap.set(path, { ...node, isExpanded: false });
      set({ treeNodes: newMap });
    },

    setSidebarWidth: (width: number) => set({ sidebarWidth: width }),
    toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),

    // ── Search (Iter 3) ──
    setSearchTerm: (term: string) => set({ searchTerm: term }),

    // ── Sort (Iter 3) ──
    setSort: (field: SortField) => {
      const { sortField, sortDirection } = get();
      const next = nextSortState(sortField, sortDirection, field);
      set({ sortField: next.field, sortDirection: next.direction });
    },

    // ── Computed helpers (Iter 3) ──
    getFilteredItems: () => {
      const { items, searchTerm } = get();
      if (!searchTerm) return items;
      const lower = searchTerm.toLowerCase();
      return items.filter((item) => item.name.toLowerCase().includes(lower));
    },

    getSortedItems: () => {
      const { sortField, sortDirection } = get();
      const filtered = get().getFilteredItems();
      return sortItems(filtered, sortField, sortDirection);
    },

    // ── Clipboard (Iter 4) ──
    copyItems: (items: ExplorerItem[]) => {
      set({ clipboard: { items, operation: "copy" } });
    },

    cutItems: (items: ExplorerItem[]) => {
      set({ clipboard: { items, operation: "cut" } });
    },

    pasteItems: async (targetPath: string) => {
      const { clipboard, localFs, depotRoot, depotId, client, beforeCommit, scheduleCommit } =
        get();
      if (!clipboard || !depotRoot || !depotId) return;

      set({ operationLoading: { ...get().operationLoading, paste: true } });

      const op = clipboard.operation === "copy" ? "cp" : "mv";
      let currentRoot = depotRoot;

      try {
        for (const item of clipboard.items) {
          const dstPath = targetPath ? `${targetPath}/${item.name}` : item.name;
          const result = await localFs[op](currentRoot, item.path, dstPath);
          if (isFsError(result)) {
            handleFsError(get, result);
            continue;
          }
          currentRoot = result.newRoot;
        }

        if (currentRoot !== depotRoot) {
          if (scheduleCommit) {
            scheduleCommit(depotId, currentRoot, depotRoot);
          } else {
            await beforeCommit?.();
            await client.depots.commit(depotId, { root: currentRoot });
          }
          set({ depotRoot: currentRoot });
        }

        // Copy keeps clipboard, cut clears it
        if (clipboard.operation === "cut") {
          set({ clipboard: null });
        }

        set({ operationLoading: { ...get().operationLoading, paste: false } });
        await get().refresh();
      } catch {
        set({
          operationLoading: { ...get().operationLoading, paste: false },
          lastError: { type: "network", message: "Paste operation failed" },
        });
      }
    },

    canPaste: () => get().clipboard !== null && get().clipboard!.items.length > 0,
    clearClipboard: () => set({ clipboard: null }),

    // ── Selection (Iter 2 + 4) ──
    setSelectedItems: (items) => set({ selectedItems: items }),
    setLastSelectedIndex: (index: number | null) => set({ lastSelectedIndex: index }),
    clearSelection: () => set({ selectedItems: [], lastSelectedIndex: null, focusIndex: null }),

    // ── Focus (Iter 4) ──
    setFocusIndex: (index: number | null) => set({ focusIndex: index }),

    // ── Detail Panel (Iter 4) ──
    toggleDetailPanel: () => set({ detailPanelOpen: !get().detailPanelOpen }),

    // ── Upload queue ──
    addToUploadQueue: (files: File[]) => {
      const { currentPath, uploadQueue } = get();
      const newItems: UploadQueueItem[] = files.map((file) => ({
        id: nextUploadId(),
        file,
        targetPath: currentPath ? `${currentPath}/${file.name}` : file.name,
        status: "pending" as const,
      }));
      set({ uploadQueue: [...uploadQueue, ...newItems] });
    },

    removeFromUploadQueue: (id: string) => {
      const { uploadQueue } = get();
      set({ uploadQueue: uploadQueue.filter((item) => item.id !== id) });
    },

    updateUploadItem: (id: string, patch: Partial<UploadQueueItem>) => {
      const { uploadQueue } = get();
      set({
        uploadQueue: uploadQueue.map((item) => (item.id === id ? { ...item, ...patch } : item)),
      });
    },

    clearCompletedUploads: () => {
      const { uploadQueue } = get();
      set({ uploadQueue: uploadQueue.filter((item) => item.status !== "done") });
    },

    // ── Root pointer ──
    updateDepotRoot: (newRoot: string) => set({ depotRoot: newRoot }),

    // ── File operations ──
    createFolder: async (name: string) => {
      const { client, depotId, depotRoot, currentPath, beforeCommit, scheduleCommit } = get();
      if (!depotRoot || !depotId) return false;

      set({ operationLoading: { ...get().operationLoading, createFolder: true } });
      const targetPath = currentPath ? `${currentPath}/${name}` : name;

      try {
        const result = await localFs.mkdir(depotRoot, targetPath);
        if (isFsError(result)) {
          handleFsError(get, result);
          set({ operationLoading: { ...get().operationLoading, createFolder: false } });
          return false;
        }
        // Commit new root to depot (persists across refresh)
        if (scheduleCommit) {
          scheduleCommit(depotId, result.newRoot, depotRoot);
        } else {
          await beforeCommit?.();
          await client.depots.commit(depotId, { root: result.newRoot });
        }
        set({
          depotRoot: result.newRoot,
          operationLoading: { ...get().operationLoading, createFolder: false },
        });
        await get().refresh();
        return true;
      } catch {
        set({
          operationLoading: { ...get().operationLoading, createFolder: false },
          lastError: { type: "network", message: "Network error" },
        });
        return false;
      }
    },

    deleteItems: async (items: ExplorerItem[]) => {
      const { client, depotId, depotRoot } = get();
      if (!depotRoot || !depotId) return { success: 0, failed: items.length };

      set({ operationLoading: { ...get().operationLoading, delete: true } });
      let success = 0;
      let failed = 0;
      let currentRoot = depotRoot;

      for (const item of items) {
        try {
          const result = await localFs.rm(currentRoot, item.path);
          if (!isFsError(result)) {
            currentRoot = result.newRoot;
            success++;
          } else {
            handleFsError(get, result);
            failed++;
          }
        } catch {
          failed++;
        }
      }

      // Commit final root to depot (single commit for all deletions)
      if (currentRoot !== depotRoot) {
        const { beforeCommit, scheduleCommit } = get();
        if (scheduleCommit) {
          scheduleCommit(depotId, currentRoot, depotRoot);
        } else {
          await beforeCommit?.();
          await client.depots.commit(depotId, { root: currentRoot }).catch(() => {});
        }
      }

      set({
        depotRoot: currentRoot,
        operationLoading: { ...get().operationLoading, delete: false },
        selectedItems: [],
      });
      await get().refresh();
      return { success, failed };
    },

    renameItem: async (item: ExplorerItem, newName: string) => {
      const { client, depotId, depotRoot, beforeCommit, scheduleCommit } = get();
      if (!depotRoot || !depotId) return false;

      set({ operationLoading: { ...get().operationLoading, rename: true } });

      const parentPath = item.path.includes("/")
        ? item.path.substring(0, item.path.lastIndexOf("/"))
        : "";
      const newPath = parentPath ? `${parentPath}/${newName}` : newName;

      try {
        const result = await localFs.mv(depotRoot, item.path, newPath);
        if (isFsError(result)) {
          handleFsError(get, result);
          set({ operationLoading: { ...get().operationLoading, rename: false } });
          return false;
        }
        // Commit new root to depot
        if (scheduleCommit) {
          scheduleCommit(depotId, result.newRoot, depotRoot);
        } else {
          await beforeCommit?.();
          await client.depots.commit(depotId, { root: result.newRoot });
        }
        set({
          depotRoot: result.newRoot,
          operationLoading: { ...get().operationLoading, rename: false },
        });
        await get().refresh();
        return true;
      } catch {
        set({
          operationLoading: { ...get().operationLoading, rename: false },
          lastError: { type: "network", message: "Network error" },
        });
        return false;
      }
    },

    // ── Operation loading ──
    setOperationLoading: (op, loading) =>
      set({ operationLoading: { ...get().operationLoading, [op]: loading } }),

    // ── Permissions ──
    setPermissions: (perms) => set({ permissions: { ...get().permissions, ...perms } }),

    // ── Error ──
    setError: (error) => set({ lastError: error }),

    // ── Dialog ──
    openDialog: (type, targetItem) => set({ dialogState: { type, targetItem } }),
    closeDialog: () => set({ dialogState: { type: "none" } }),
  }));
};

/** Map FsError (from @casfa/fs) to ExplorerError */
function handleFsError(
  get: () => ExplorerStore,
  error: { code: string; status: number; message: string }
) {
  const { setError, setPermissions } = get();
  if (error.status === 403) {
    setPermissions({ canUpload: false });
    setError({ type: "permission_denied", message: error.message });
  } else if (error.status === 401) {
    setError({ type: "auth_expired", message: error.message });
  } else if (error.status === 404 || error.code === "PATH_NOT_FOUND") {
    setError({ type: "not_found", message: error.message });
  } else if (error.code === "FILE_TOO_LARGE") {
    setError({ type: "file_too_large", message: error.message });
  } else if (error.code === "TARGET_EXISTS") {
    setError({ type: "name_conflict", message: error.message });
  } else {
    setError({ type: "unknown", message: error.message });
  }
}

/** Map HTTP API errors to ExplorerError */
function handleApiError(
  get: () => ExplorerStore,
  error: { code: string; message: string; status?: number }
) {
  const { setError, setPermissions } = get();
  if (error.status === 403) {
    setPermissions({ canUpload: false });
    setError({ type: "permission_denied", message: error.message });
  } else if (error.status === 401) {
    setError({ type: "auth_expired", message: error.message });
  } else {
    setError({ type: "unknown", message: error.message });
  }
}

export type ExplorerStoreApi = ReturnType<typeof createExplorerStore>;
