/**
 * Explorer core Zustand store.
 *
 * Manages: depot selection, directory browsing, pagination, loading states,
 * file selection, upload queue, permissions, and error state.
 */

import type { CasfaClient } from "@casfa/client";
import type { HashProvider, StorageProvider } from "@casfa/core";
import { createFsService, isFsError, type FsService } from "@casfa/fs";
import type { DepotListItem, FsLsChild } from "@casfa/protocol";
import { createStore } from "zustand/vanilla";
import type {
  ExplorerError,
  ExplorerItem,
  ExplorerPermissions,
  UploadQueueItem,
} from "../types.ts";

// ============================================================================
// Types
// ============================================================================

export type ExplorerState = {
  // ── Connection ──
  client: CasfaClient;
  /** Local @casfa/fs service — all tree operations (read & write) run locally */
  localFs: FsService;
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

  // ── Selection (Iter 2) ──
  selectedItems: ExplorerItem[];

  // ── Upload queue (Iter 2) ──
  uploadQueue: UploadQueueItem[];

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

  // ── Selection (Iter 2) ──
  setSelectedItems: (items: ExplorerItem[]) => void;
  clearSelection: () => void;

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
  /** BLAKE3s-128 hash provider for CAS node encoding */
  hash: HashProvider;
  depotId?: string;
  initialPath?: string;
  initialLayout?: "list" | "grid";
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
      hash: opts.hash,
    },
  });

  return createStore<ExplorerStore>()((set, get) => ({
    // ── Initial state ──
    client: opts.client,
    localFs,
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

    // ── Iter 2 initial state ──
    selectedItems: [],
    uploadQueue: [],
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
      const { localFs, depotRoot } = get();
      if (!depotRoot) return;

      set({
        currentPath: path,
        items: [],
        isLoading: true,
        cursor: null,
        hasMore: false,
        totalItems: 0,
        selectedItems: [],
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
      const { currentPath } = get();
      await get().navigate(currentPath);
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
          cursor,
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

    // ── Selection ──
    setSelectedItems: (items) => set({ selectedItems: items }),
    clearSelection: () => set({ selectedItems: [] }),

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
        uploadQueue: uploadQueue.map((item) =>
          item.id === id ? { ...item, ...patch } : item,
        ),
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
      const { client, depotId, depotRoot, currentPath } = get();
      if (!depotRoot || !depotId) return false;

      set({ operationLoading: { ...get().operationLoading, createFolder: true } });
      const targetPath = currentPath ? `${currentPath}/${name}` : name;

      try {
        const result = await client.fs.mkdir(depotRoot, targetPath);
        if (!result.ok) {
          handleApiError(get, result.error);
          set({ operationLoading: { ...get().operationLoading, createFolder: false } });
          return false;
        }
        // Commit new root to depot (persists across refresh)
        await client.depots.commit(depotId, { root: result.data.newRoot });
        set({
          depotRoot: result.data.newRoot,
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
          const result = await client.fs.rm(currentRoot, item.path);
          if (result.ok) {
            currentRoot = result.data.newRoot;
            success++;
          } else {
            handleApiError(get, result.error);
            failed++;
          }
        } catch {
          failed++;
        }
      }

      // Commit final root to depot (single commit for all deletions)
      if (currentRoot !== depotRoot) {
        await client.depots.commit(depotId, { root: currentRoot }).catch(() => {});
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
      const { client, depotId, depotRoot } = get();
      if (!depotRoot || !depotId) return false;

      set({ operationLoading: { ...get().operationLoading, rename: true } });

      const parentPath = item.path.includes("/")
        ? item.path.substring(0, item.path.lastIndexOf("/"))
        : "";
      const newPath = parentPath ? `${parentPath}/${newName}` : newName;

      try {
        const result = await client.fs.mv(depotRoot, item.path, newPath);
        if (!result.ok) {
          handleApiError(get, result.error);
          set({ operationLoading: { ...get().operationLoading, rename: false } });
          return false;
        }
        // Commit new root to depot
        await client.depots.commit(depotId, { root: result.data.newRoot });
        set({
          depotRoot: result.data.newRoot,
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
    setPermissions: (perms) =>
      set({ permissions: { ...get().permissions, ...perms } }),

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
  error: { code: string; status: number; message: string },
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
  error: { code: string; message: string; status?: number },
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
