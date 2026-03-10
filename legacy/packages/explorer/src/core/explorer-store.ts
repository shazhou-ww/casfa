/**
 * Explorer core Zustand store.
 *
 * Manages: depot selection, directory browsing, pagination, loading states,
 * file selection, upload queue, permissions, and error state.
 */

import type { CasfaClient } from "@casfa/client";
import type { KeyProvider, StorageProvider } from "@casfa/core";
import { type ChildMeta, createFsService, type FsService, isFsError } from "@casfa/fs";
import type { DepotListItem, FsLsChild } from "@casfa/protocol";
import { nodeKeyToStorageKey, storageKeyToNodeKey } from "@casfa/protocol";
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
import { pathToSegments } from "./path-segments.ts";
import type { SyncCommitEvent } from "./sync-manager.ts";

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
  /** Server-confirmed root — may lag behind depotRoot when sync is pending */
  serverRoot: string | null;
  /** Paths of items that differ between local and server root (pending sync) */
  pendingPaths: Set<string>;

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
  /** Re-load the current directory listing from local CAS (no server fetch). */
  reloadDir: () => Promise<void>;
  /** Fetch latest server root; adopt as depotRoot if no local uncommitted changes. */
  pullServerRoot: () => Promise<void>;
  loadMore: () => Promise<void>;

  // ── Layout ──
  setLayout: (layout: "list" | "grid") => void;

  // ── Navigation history (Iter 3) ──
  goBack: () => Promise<void>;
  goForward: () => Promise<void>;
  goUp: () => Promise<void>;

  // ── Tree sidebar (Iter 3) ──
  expandTreeNode: (path: string, force?: boolean) => Promise<void>;
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
  /** Update the server-confirmed root. If it matches depotRoot, clears pending state. */
  updateServerRoot: (newRoot: string) => void;

  /**
   * Handle a depot commit event (from SyncManager or cross-tab broadcast).
   *
   * - Updates serverRoot
   * - If merge changed root and no new local writes occurred, updates depotRoot + refresh
   * - Broadcasts to other tabs via BroadcastChannel
   */
  onRootCommitted: (event: SyncCommitEvent, fromBroadcast?: boolean) => void;

  /** Release internal resources (BroadcastChannel, subscriptions). */
  dispose: () => void;

  /** Re-establish BroadcastChannel + commit subscription after a dispose. */
  connect: () => void;

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

/**
 * Compare the current directory listing against the server root.
 * Items whose nodeKey differs (or is absent in the server tree) are marked
 * with `syncStatus: "pending"`.
 *
 * This only compares the currently displayed directory (shallow),
 * not the entire tree.
 *
 * Staleness guard: if `serverRoot` has changed since we started, the diff
 * result is stale and we skip the state update.
 */
async function diffCurrentDir(
  localFs: FsService,
  localRoot: string,
  srvRoot: string | null,
  currentPath: string,
  get: () => ExplorerStore,
  set: (partial: Partial<ExplorerStore>) => void
): Promise<void> {
  if (!srvRoot || localRoot === srvRoot) {
    // No diff needed — roots match or no server root
    set({ pendingPaths: new Set<string>() });
    return;
  }

  try {
    // List the same directory under the server root
    const serverResult = await localFs.ls(srvRoot, pathToSegments(currentPath), 10000);

    // ── Staleness guard: abort if serverRoot moved while we were reading ──
    if (get().serverRoot !== srvRoot) return;

    if (isFsError(serverResult)) {
      // Server tree doesn't have this path — all items are pending
      const { items } = get();
      const pending = new Set(items.map((i) => i.path));
      set({
        pendingPaths: pending,
        items: items.map((i) => ({ ...i, syncStatus: "pending" as const })),
      });
      return;
    }

    // Build a map of name → nodeKey from the server listing
    const serverKeyMap = new Map<string, string | undefined>();
    for (const child of serverResult.children) {
      serverKeyMap.set(child.name, child.key);
    }

    // ── Second staleness guard (after building the map) ──
    if (get().serverRoot !== srvRoot) return;

    // Compare against current items
    const { items } = get();
    const pending = new Set<string>();
    const updatedItems = items.map((item) => {
      const serverKey = serverKeyMap.get(item.name);
      // Item is pending if: not on server, or nodeKey differs
      if (serverKey === undefined || (item.nodeKey && serverKey !== item.nodeKey)) {
        pending.add(item.path);
        return { ...item, syncStatus: "pending" as const };
      }
      return item.syncStatus ? { ...item, syncStatus: undefined } : item;
    });

    set({ pendingPaths: pending, items: updatedItems });
  } catch {
    // If diff fails, don't block — just clear pending state
    set({ pendingPaths: new Set<string>() });
  }
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
  /**
   * Return the pending (uncommitted) root for a depot, or null.
   * Used after refresh to display local data instead of stale server root.
   */
  getSyncPendingRoot?: (depotId: string) => string | null | Promise<string | null>;
  /**
   * Subscribe to depot commit events (e.g. `appClient.onCommit`).
   * When provided, the store auto-subscribes and handles root updates internally.
   * Returns an unsubscribe function.
   */
  subscribeCommit?: (listener: (event: SyncCommitEvent) => void) => () => void;
};

/** BroadcastChannel message for cross-tab depot root sync. */
type DepotRootBroadcast = {
  type: "root-committed";
  depotId: string;
  committedRoot: string;
  requestedRoot: string;
};

const BROADCAST_CHANNEL_NAME = "casfa-explorer-depot-root";

const LS_PAGE_SIZE = 200;

let uploadIdCounter = 0;
function nextUploadId(): string {
  return `upload_${++uploadIdCounter}_${Date.now()}`;
}

export const createExplorerStore = (opts: CreateExplorerStoreOpts) => {
  // In-flight guard for selectDepot — prevents duplicate calls during StrictMode re-mount
  let selectDepotInFlight: string | null = null;
  // Build local @casfa/fs service — all tree operations (read & write) run locally.
  // Nodes are fetched/stored via CachedStorage (IndexedDB + HTTP).
  // After write operations, the new root is committed to the server via depot API.
  // Use server-reported maxNodeSize as nodeLimit for B-Tree splitting,
  // so block sizes match what the server expects.
  const serverNodeLimit = opts.client.getServerInfo()?.limits.maxNodeSize;
  const localFs: FsService = createFsService({
    ctx: {
      storage: opts.storage,
      key: opts.key,
      ...(serverNodeLimit ? { nodeLimit: serverNodeLimit } : {}),

      // Batch metadata provider — avoids fetching each child node individually
      // during ls(). Uses the server's extension API to batch-query "meta"
      // derived data (kind, size, contentType, childCount).
      getChildrenMeta: async (storageKeys) => {
        if (storageKeys.length === 0) return new Map();
        const nodeKeys = storageKeys.map(storageKeyToNodeKey);
        const result = await opts.client.nodes.batchGetExtension<{
          kind: "file" | "dict";
          size: number | null;
          contentType: string | null;
          childCount: number | null;
        }>("meta", nodeKeys);
        if (!result.ok) return new Map();

        const mapped = new Map<string, ChildMeta>();
        for (const [nodeKey, data] of Object.entries(result.data.data)) {
          if (data.kind === "file" || data.kind === "dict") {
            mapped.set(nodeKeyToStorageKey(nodeKey), {
              kind: data.kind,
              size: data.size ?? null,
              contentType: data.contentType ?? null,
              childCount: data.childCount ?? null,
            });
          }
        }
        return mapped;
      },
    },
  });

  // ── Cross-tab BroadcastChannel ──
  // Created/destroyed by connect()/dispose() — survives React StrictMode re-mount.
  let bc: BroadcastChannel | null = null;

  // Cleanup functions accumulated by connect() — called by dispose()
  const cleanups: Array<() => void> = [];

  const store = createStore<ExplorerStore>()((set, get) => ({
    // ── Initial state ──
    client: opts.client,
    localFs,
    beforeCommit: opts.beforeCommit ?? null,
    scheduleCommit: opts.scheduleCommit ?? null,
    depotId: opts.depotId ?? null,
    depotRoot: null,
    serverRoot: null,
    pendingPaths: new Set<string>(),
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
      if (get().depotsLoading) return; // prevent duplicate in-flight calls
      set({ depotsLoading: true });
      const { client } = get();
      try {
        const result = await client.depots.list({ limit: 100 });
        if (result.ok) {
          const depots = result.data.depots;
          set({ depots, depotsLoading: false });

          // Rebuild depot tree nodes
          const treeNodes = new Map(get().treeNodes);
          const depotChildren: TreeNode[] = depots.map((d) => {
            const key = `depot:${d.depotId}`;
            const existing = treeNodes.get(key);
            if (existing) {
              // Preserve expand state, update name
              return { ...existing, name: d.title || d.depotId };
            }
            return {
              path: key,
              name: d.title || d.depotId,
              type: "depot" as const,
              depotId: d.depotId,
              children: null,
              isExpanded: false,
              isLoading: false,
            };
          });

          // Update root node
          treeNodes.set("", {
            path: "",
            name: "Depots",
            type: "depot-root" as const,
            children: depotChildren,
            isExpanded: true,
            isLoading: false,
          });

          // Update individual depot entries
          for (const child of depotChildren) {
            treeNodes.set(child.path, child);
          }

          // Clean up removed depots and their subtrees
          const validDepotKeys = new Set(depotChildren.map((c) => c.path));
          for (const key of [...treeNodes.keys()]) {
            if (key === "" || !key.startsWith("depot:")) continue;
            const depotKey = key.includes("/") ? key.substring(0, key.indexOf("/")) : key;
            if (!validDepotKeys.has(depotKey)) {
              treeNodes.delete(key);
            }
          }

          set({ treeNodes });
        } else {
          set({ depotsLoading: false });
        }
      } catch {
        set({ depotsLoading: false });
      }
    },

    selectDepot: async (depotId: string) => {
      const { client } = get();
      // Prevent duplicate in-flight calls for the same depot (e.g. StrictMode re-mount)
      if (selectDepotInFlight === depotId) return;
      selectDepotInFlight = depotId;
      try {
        // Fetch depot detail to get root node key
        const result = await client.depots.get(depotId);
        if (result.ok) {
          const serverRoot = result.data.root;
          // Check if SyncManager has a pending root that hasn't been committed yet
          const pendingRoot = (await opts.getSyncPendingRoot?.(depotId)) ?? null;
          const effectiveRoot = pendingRoot ?? serverRoot;
          set({
            depotId,
            depotRoot: effectiveRoot,
            serverRoot,
            pendingPaths: new Set<string>(),
            currentPath: "",
            items: [],
            cursor: null,
            hasMore: false,
            totalItems: 0,
          });
          // Load root directory
          await get().navigate("");
        }
      } finally {
        selectDepotInFlight = null;
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
      const { depotRoot, pathHistory, historyIndex } = get();
      if (!depotRoot) return;

      // Push to history stack (truncate forward history)
      const newHistory = [...pathHistory.slice(0, historyIndex + 1), path];
      set({
        currentPath: path,
        selectedItems: [],
        searchTerm: "",
        pathHistory: newHistory,
        historyIndex: newHistory.length - 1,
      });

      await get().reloadDir();
    },

    refresh: async () => {
      await get().pullServerRoot();
      await get().reloadDir();
    },

    reloadDir: async () => {
      const { localFs, depotRoot, currentPath } = get();
      if (!depotRoot) return;

      // Keep existing items visible during reload to avoid skeleton flash.
      // They will be atomically replaced once the new listing arrives.
      set({ isLoading: true });
      try {
        const result = await localFs.ls(depotRoot, pathToSegments(currentPath), LS_PAGE_SIZE);
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
        // Diff against server root to mark pending items
        const { serverRoot, depotRoot: currentDepotRoot } = get();
        if (serverRoot && serverRoot !== currentDepotRoot) {
          diffCurrentDir(localFs, currentDepotRoot!, serverRoot, currentPath, get, set);
        } else {
          // Roots match — clear pending state
          set({ pendingPaths: new Set<string>() });
          const { items: currentItems } = get();
          if (currentItems.some((i) => i.syncStatus)) {
            set({ items: currentItems.map((i) => ({ ...i, syncStatus: undefined })) });
          }
        }
        // Refresh tree node cache for current path
        const { depotId } = get();
        if (depotId) {
          // Force re-fetch expanded tree nodes along the current path.
          // We keep existing children visible (no children: null) to avoid
          // a visual flash; expandTreeNode(…, true) replaces them atomically.
          const keysToRefresh: string[] = [];
          const depotKey = `depot:${depotId}`;
          keysToRefresh.push(depotKey);
          if (currentPath) {
            let acc = depotKey;
            for (const part of currentPath.split("/")) {
              acc = `${acc}/${part}`;
              keysToRefresh.push(acc);
            }
          }

          // Re-expand each node in order (root → leaf), forcing re-fetch
          for (const key of keysToRefresh) {
            const n = get().treeNodes.get(key);
            if (n?.isExpanded) {
              await get().expandTreeNode(key, true);
            }
          }
        }
      } catch {
        set({ isLoading: false });
      }
    },

    pullServerRoot: async () => {
      const { client, depotId, depotRoot, serverRoot } = get();
      if (!depotId) return;

      try {
        const result = await client.depots.get(depotId);
        if (!result.ok || !result.data.root) return;

        const newServerRoot = result.data.root;
        if (newServerRoot === serverRoot) return; // no change

        const noLocalChanges = depotRoot === serverRoot;
        if (noLocalChanges) {
          // Adopt the new server root
          set({
            depotRoot: newServerRoot,
            serverRoot: newServerRoot,
            pendingPaths: new Set<string>(),
          });
        } else {
          // Local changes exist — just update serverRoot
          set({ serverRoot: newServerRoot });
        }
      } catch {
        // Network error — proceed with current state
      }
    },

    loadMore: async () => {
      const { localFs, depotRoot, currentPath, cursor, items } = get();
      if (!depotRoot || !cursor) return;

      set({ isLoading: true });

      try {
        const result = await localFs.ls(
          depotRoot,
          pathToSegments(currentPath),
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
      const { historyIndex, pathHistory, depotRoot } = get();
      if (historyIndex <= 0 || !depotRoot) return;
      const newIndex = historyIndex - 1;
      set({
        historyIndex: newIndex,
        currentPath: pathHistory[newIndex]!,
        selectedItems: [],
        searchTerm: "",
      });
      await get().reloadDir();
    },

    goForward: async () => {
      const { historyIndex, pathHistory, depotRoot } = get();
      if (historyIndex >= pathHistory.length - 1 || !depotRoot) return;
      const newIndex = historyIndex + 1;
      set({
        historyIndex: newIndex,
        currentPath: pathHistory[newIndex]!,
        selectedItems: [],
        searchTerm: "",
      });
      await get().reloadDir();
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
    expandTreeNode: async (path: string, force?: boolean) => {
      const { treeNodes } = get();
      const node = treeNodes.get(path);

      // Already expanded with loaded children — nothing to do (unless forced)
      if (!force && node?.isExpanded && node.children !== null && !node.isLoading) return;

      // ── Depot node: select depot + load root directories ──
      if (node?.type === "depot" && node.depotId) {
        const depotIdToSelect = node.depotId;

        // Mark this depot as expanded + loading (skip loading indicator on force-refresh)
        const newMap = new Map(treeNodes);
        newMap.set(path, { ...node, isExpanded: true, isLoading: !force });
        set({ treeNodes: newMap });

        // Select the depot if not already selected or root not loaded
        if (get().depotId !== depotIdToSelect || !get().depotRoot) {
          await get().selectDepot(depotIdToSelect);
        }

        // Load root directories for the tree
        const { localFs, depotRoot } = get();
        if (!depotRoot) {
          const errMap = new Map(get().treeNodes);
          const n = errMap.get(path);
          if (n) errMap.set(path, { ...n, isLoading: false });
          set({ treeNodes: errMap });
          return;
        }

        try {
          const result = await localFs.ls(depotRoot, [], LS_PAGE_SIZE);
          if (isFsError(result)) {
            const errMap = new Map(get().treeNodes);
            const n = errMap.get(path);
            if (n) errMap.set(path, { ...n, isLoading: false });
            set({ treeNodes: errMap });
            return;
          }
          const children: TreeNode[] = result.children
            .filter((c) => c.type === "dir")
            .map((c) => {
              const childPath = `${path}/${c.name}`;
              const prev = get().treeNodes.get(childPath);
              return (
                prev ?? {
                  path: childPath,
                  name: c.name,
                  type: "directory" as const,
                  depotId: depotIdToSelect,
                  children: null,
                  isExpanded: false,
                  isLoading: false,
                }
              );
            });
          const doneMap = new Map(get().treeNodes);
          const doneNode = doneMap.get(path);
          if (doneNode) doneMap.set(path, { ...doneNode, children, isLoading: false });
          set({ treeNodes: doneMap });
        } catch {
          const errMap = new Map(get().treeNodes);
          const n = errMap.get(path);
          if (n) errMap.set(path, { ...n, isLoading: false });
          set({ treeNodes: errMap });
        }
        return;
      }

      // ── Directory node (within an expanded depot) ──
      const { localFs, depotRoot } = get();
      if (!depotRoot) return;

      // Extract relative path — tree key format: "depot:<id>/<relativePath>"
      let relativePath = path;
      let nodeDepotId: string | undefined;
      const depotPrefixMatch = path.match(/^depot:([^/]+)\/(.+)$/);
      if (depotPrefixMatch) {
        nodeDepotId = depotPrefixMatch[1];
        relativePath = depotPrefixMatch[2]!;
      }

      const newMap = new Map(treeNodes);
      const existing = newMap.get(path);
      if (existing) {
        newMap.set(path, { ...existing, isExpanded: true, isLoading: !force });
      } else {
        const name = relativePath ? relativePath.split("/").pop()! : "root";
        newMap.set(path, {
          path,
          name,
          type: "directory" as const,
          depotId: nodeDepotId,
          children: null,
          isExpanded: true,
          isLoading: true,
        });
      }
      set({ treeNodes: newMap });

      try {
        const result = await localFs.ls(depotRoot, pathToSegments(relativePath), LS_PAGE_SIZE);
        if (isFsError(result)) {
          const errMap = new Map(get().treeNodes);
          const n = errMap.get(path);
          if (n) errMap.set(path, { ...n, isLoading: false });
          set({ treeNodes: errMap });
          return;
        }
        const children: TreeNode[] = result.children
          .filter((c) => c.type === "dir")
          .map((c) => {
            const childPath = `${path}/${c.name}`;
            const prev = get().treeNodes.get(childPath);
            return (
              prev ?? {
                path: childPath,
                name: c.name,
                type: "directory" as const,
                depotId: nodeDepotId ?? node?.depotId,
                children: null,
                isExpanded: false,
                isLoading: false,
              }
            );
          });
        const doneMap = new Map(get().treeNodes);
        const n = doneMap.get(path);
        if (n) doneMap.set(path, { ...n, children, isLoading: false });
        set({ treeNodes: doneMap });
      } catch {
        const errMap = new Map(get().treeNodes);
        const n = errMap.get(path);
        if (n) errMap.set(path, { ...n, isLoading: false });
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
      const {
        clipboard,
        localFs,
        depotRoot,
        depotId,
        client,
        beforeCommit,
        scheduleCommit,
        serverRoot,
      } = get();
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
            scheduleCommit(depotId, currentRoot, serverRoot);
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
        await get().reloadDir();
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

    updateServerRoot: (newRoot: string) => {
      const { depotRoot, currentPath, localFs, serverRoot: oldServerRoot } = get();
      set({ serverRoot: newRoot });
      // If server caught up to local, clear pending state
      if (newRoot === depotRoot) {
        set({ pendingPaths: new Set<string>() });
        // Also clear syncStatus on current items
        const { items } = get();
        if (items.some((i) => i.syncStatus)) {
          set({ items: items.map((i) => ({ ...i, syncStatus: undefined })) });
        }
      } else if (oldServerRoot !== newRoot && depotRoot) {
        // Server root changed but still differs from local — re-diff current view
        diffCurrentDir(localFs, depotRoot, newRoot, currentPath, get, set);
      }
    },

    onRootCommitted: (event: SyncCommitEvent, fromBroadcast = false) => {
      const { depotId, depotRoot, serverRoot } = get();
      if (event.depotId !== depotId) return;

      // Case 1 — Merge changed root; adopt if no new local writes since.
      // Case 2 — Cross-tab broadcast; adopt if this tab has no local changes.
      const mergeChangedRoot = event.committedRoot !== event.requestedRoot;
      const noNewLocalWrites = depotRoot === event.requestedRoot;
      const noLocalPendingChanges = depotRoot === serverRoot;

      const shouldAdoptRoot =
        (mergeChangedRoot && noNewLocalWrites) || (fromBroadcast && noLocalPendingChanges);

      if (shouldAdoptRoot) {
        set({ depotRoot: event.committedRoot });
      }

      // Always update serverRoot
      get().updateServerRoot(event.committedRoot);

      // Reload directory view only when we adopted a new root
      if (shouldAdoptRoot) {
        get().reloadDir();
      }

      // Broadcast to other tabs (unless this event came from broadcast)
      if (!fromBroadcast && bc) {
        const msg: DepotRootBroadcast = {
          type: "root-committed",
          depotId: event.depotId,
          committedRoot: event.committedRoot,
          requestedRoot: event.requestedRoot,
        };
        bc.postMessage(msg);
      }
    },

    dispose: () => {
      for (const cleanup of cleanups) cleanup();
      cleanups.length = 0;
      if (bc) {
        bc.close();
        bc = null;
      }
    },

    connect: () => {
      // Idempotent — safe to call multiple times (StrictMode re-mount)
      // First dispose any existing connections
      get().dispose();

      // Re-create BroadcastChannel
      try {
        bc = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
        bc.onmessage = (ev: MessageEvent<DepotRootBroadcast>) => {
          if (ev.data?.type === "root-committed") {
            store.getState().onRootCommitted(ev.data, true);
          }
        };
      } catch {
        // BroadcastChannel not available (e.g. SSR, older browsers) — skip
      }

      // Re-subscribe to commit events
      if (opts.subscribeCommit) {
        const unsub = opts.subscribeCommit((event) => {
          store.getState().onRootCommitted(event);
        });
        cleanups.push(unsub);
      }
    },

    // ── File operations ──
    createFolder: async (name: string) => {
      const { client, depotId, depotRoot, currentPath, beforeCommit, scheduleCommit, serverRoot } =
        get();
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
        if (scheduleCommit) {
          scheduleCommit(depotId, result.newRoot, serverRoot);
        } else {
          await beforeCommit?.();
          await client.depots.commit(depotId, { root: result.newRoot });
        }
        set({
          depotRoot: result.newRoot,
          operationLoading: { ...get().operationLoading, createFolder: false },
        });
        await get().reloadDir();
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
          const result = await localFs.rm(currentRoot, pathToSegments(item.path));
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

      if (currentRoot !== depotRoot) {
        const { beforeCommit, scheduleCommit, serverRoot } = get();
        if (scheduleCommit) {
          scheduleCommit(depotId, currentRoot, serverRoot);
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
      await get().reloadDir();
      return { success, failed };
    },

    renameItem: async (item: ExplorerItem, newName: string) => {
      const { client, depotId, depotRoot, beforeCommit, scheduleCommit, serverRoot } = get();
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
        if (scheduleCommit) {
          scheduleCommit(depotId, result.newRoot, serverRoot);
        } else {
          await beforeCommit?.();
          await client.depots.commit(depotId, { root: result.newRoot });
        }
        set({
          depotRoot: result.newRoot,
          operationLoading: { ...get().operationLoading, rename: false },
        });
        await get().reloadDir();
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

  // Connection is handled by CasfaExplorer's useEffect (connect on mount,
  // dispose on unmount) — no need to call connect() here.

  return store;
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
