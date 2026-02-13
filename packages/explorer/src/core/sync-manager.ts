/**
 * SyncManager — Layer 2 of the background sync model.
 *
 * Manages the depot commit queue: enqueue → debounce → flush (Layer 1) → commit.
 *
 * Layer 1 (CAS Node Sync) is fully idempotent and handled by CachedStorage.
 * Layer 2 (Depot Commit Sync) is stateful, has conflict risk, and is managed here.
 *
 * Persistence is injected via SyncQueueStore so the core logic is
 * platform-agnostic and testable without IndexedDB.
 *
 * @packageDocumentation
 */

import type { CasfaClient } from "@casfa/client";
import { nodeKeyToStorageKey } from "@casfa/protocol";

// ============================================================================
// Types
// ============================================================================

/**
 * Minimal interface for Layer 1 storage.
 * Matches CachedStorageProvider from @casfa/storage-cached
 * without requiring the dependency.
 */
export type FlushableStorage = {
  /** @deprecated No-op — use syncTree instead. */
  flush(): Promise<void>;
  /**
   * Walk a CAS tree from `rootKey`, batch-check against remote,
   * prune already-owned subtrees, and upload only missing nodes.
   *
   * @param rootKey — CB32 storage key of the tree root
   */
  syncTree(rootKey: string): Promise<void>;
};

/**
 * Persistent depot sync queue entry.
 *
 * When multiple operations enqueue the same depot before the debounce fires,
 * only `targetRoot` and `updatedAt` are updated (merged).
 * `lastKnownServerRoot` retains the value from the first enqueue — because
 * intermediate roots were never committed to the server.
 */
export type DepotSyncEntry = {
  /** Depot ID (primary key) */
  depotId: string;
  /** Latest root to commit (updated on merge) */
  targetRoot: string;
  /** Server root at first enqueue time (not updated on merge — for conflict detection) */
  lastKnownServerRoot: string | null;
  /** First enqueue timestamp */
  createdAt: number;
  /** Last update timestamp */
  updatedAt: number;
  /** Retry count (max MAX_RETRY_COUNT, then give up) */
  retryCount: number;
};

/**
 * Pluggable persistence for the depot sync queue.
 * Frontend provides an IndexedDB implementation; tests can use in-memory.
 */
export type SyncQueueStore = {
  loadAll(): Promise<DepotSyncEntry[]>;
  upsert(entry: DepotSyncEntry): Promise<void>;
  remove(depotId: string): Promise<void>;
};

export type SyncState = "idle" | "recovering" | "syncing" | "error" | "conflict";

export type ConflictEvent = {
  depotId: string;
  localRoot: string;
  serverRoot: string | null;
  /** Current resolution strategy */
  resolution: "lww-overwrite";
};

/**
 * Emitted when a sync entry permanently fails (non-retryable server error
 * or max retries exhausted).
 */
export type SyncErrorEvent = {
  depotId: string;
  targetRoot: string;
  error: { code: string; message: string; status?: number };
  /** true = permanently abandoned; false = will still retry */
  permanent: boolean;
};

/**
 * Emitted when a depot root is successfully committed to the server
 * (or was already in sync).
 */
export type SyncCommitEvent = {
  depotId: string;
  committedRoot: string;
};

export type SyncManagerConfig = {
  /** Layer 1: storage with syncTree() — used to sync CAS nodes before committing */
  storage: FlushableStorage;
  /** Depot API client */
  client: CasfaClient;
  /** Persistent queue store */
  queueStore: SyncQueueStore;
  /** Debounce delay in ms (default: 2000) */
  debounceMs?: number;
};

export type SyncManager = {
  /**
   * Enqueue a new root for background commit.
   * If the depot already has a pending entry, merges by updating
   * targetRoot + updatedAt only (lastKnownServerRoot stays).
   */
  enqueue(depotId: string, newRoot: string, lastKnownServerRoot: string | null): void;

  /**
   * Recover pending entries from persistent store and start sync.
   * Call on page load.
   */
  recover(): Promise<void>;

  /**
   * Force immediate sync: flush Layer 1 + commit all pending entries.
   * Used before logout or on explicit user request.
   */
  flushNow(): Promise<void>;

  /** Subscribe to state changes. Returns unsubscribe function. */
  onStateChange(listener: (state: SyncState) => void): () => void;

  /** Subscribe to conflict events. Returns unsubscribe function. */
  onConflict(listener: (event: ConflictEvent) => void): () => void;

  /** Subscribe to sync error events (permanent failures). Returns unsubscribe function. */
  onError(listener: (event: SyncErrorEvent) => void): () => void;

  /** Subscribe to successful commit events. Returns unsubscribe function. */
  onCommit(listener: (event: SyncCommitEvent) => void): () => void;

  /**
   * Get the pending (uncommitted) target root for a depot.
   * Returns null if no pending entry exists for this depot.
   */
  getPendingRoot(depotId: string): string | null;

  /** Get current state */
  getState(): SyncState;

  /** Get number of pending entries */
  getPendingCount(): number;

  /** Dispose — cancel timers, stop sync */
  dispose(): void;
};

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_DEBOUNCE_MS = 2000;
const MAX_RETRY_COUNT = 10;
const MIN_RETRY_DELAY = 1000;
const MAX_RETRY_DELAY = 60_000;

// ============================================================================
// Factory
// ============================================================================

export const createSyncManager = (config: SyncManagerConfig): SyncManager => {
  const { storage, client, queueStore, debounceMs = DEFAULT_DEBOUNCE_MS } = config;

  // -- State --
  let state: SyncState = "idle";
  let pendingCount = 0;
  let disposed = false;

  // -- In-memory queue mirror (for fast enqueue merging) --
  const memQueue = new Map<string, DepotSyncEntry>();

  // -- Timers --
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let activeSyncPromise: Promise<void> | null = null;

  // -- Listeners --
  const stateListeners = new Set<(state: SyncState) => void>();
  const conflictListeners = new Set<(event: ConflictEvent) => void>();
  const errorListeners = new Set<(event: SyncErrorEvent) => void>();
  const commitListeners = new Set<(event: SyncCommitEvent) => void>();

  // -- Helpers --

  /** Check if an error is a network error (fetch throws TypeError). */
  function isNetworkError(err: unknown): boolean {
    return err instanceof TypeError && /fetch|network/i.test((err as TypeError).message);
  }

  function setState(s: SyncState): void {
    if (state === s) return;
    state = s;
    for (const fn of stateListeners) fn(s);
  }

  function updatePendingCount(): void {
    pendingCount = memQueue.size;
  }

  function emitConflict(event: ConflictEvent): void {
    for (const fn of conflictListeners) fn(event);
  }

  function emitError(event: SyncErrorEvent): void {
    for (const fn of errorListeners) fn(event);
  }

  function emitCommit(event: SyncCommitEvent): void {
    for (const fn of commitListeners) fn(event);
  }

  function clearTimers(): void {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function scheduleSyncDebounced(): void {
    if (disposed) return;
    clearTimers();
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      triggerSync();
    }, debounceMs);
  }

  function scheduleRetry(delay: number): void {
    if (disposed) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      triggerSync();
    }, delay);
  }

  /** Increment retryCount for a transient network failure. */
  function bumpRetry(entry: DepotSyncEntry): void {
    const updated: DepotSyncEntry = {
      ...entry,
      retryCount: entry.retryCount + 1,
      updatedAt: Date.now(),
    };
    memQueue.set(entry.depotId, updated);
    queueStore.upsert(updated).catch(() => {});
  }

  /** Permanent failure — remove from queue and emit error. */
  function failPermanently(
    entry: DepotSyncEntry,
    error: { code: string; message: string; status?: number }
  ): void {
    memQueue.delete(entry.depotId);
    queueStore.remove(entry.depotId).catch(() => {});
    emitError({ depotId: entry.depotId, targetRoot: entry.targetRoot, error, permanent: true });
  }

  function triggerSync(): void {
    if (disposed || activeSyncPromise || memQueue.size === 0) return;
    activeSyncPromise = runSync().finally(() => {
      activeSyncPromise = null;
      // If more entries arrived during sync, schedule another cycle
      if (memQueue.size > 0 && !disposed) {
        scheduleSyncDebounced();
      }
    });
  }

  // -- Core sync cycle --

  async function runSync(): Promise<void> {
    if (memQueue.size === 0) return;

    setState("syncing");

    // ── Layer 2: sync tree + commit each depot ──
    const entries = [...memQueue.values()];

    for (const entry of entries) {
      if (disposed) return;

      if (entry.retryCount >= MAX_RETRY_COUNT) {
        console.error(
          `[SyncManager] depot ${entry.depotId} exceeded max retries (${MAX_RETRY_COUNT}), giving up`
        );
        failPermanently(entry, {
          code: "max_retries",
          message: `Exceeded ${MAX_RETRY_COUNT} retries`,
        });
        continue;
      }

      try {
        // Layer 1: sync this depot's tree — walk from root, upload missing nodes
        const storageKey = nodeKeyToStorageKey(entry.targetRoot);
        await storage.syncTree(storageKey);

        // Layer 2: commit — check current server state
        const result = await client.depots.get(entry.depotId);
        if (!result.ok) {
          console.error(`[SyncManager] depots.get failed for ${entry.depotId}:`, result.error);
          failPermanently(entry, result.error);
          continue;
        }

        const serverRoot = result.data.root;

        // Already synced — remove
        if (serverRoot === entry.targetRoot) {
          memQueue.delete(entry.depotId);
          await queueStore.remove(entry.depotId);
          emitCommit({ depotId: entry.depotId, committedRoot: entry.targetRoot });
          continue;
        }

        // Conflict detection
        if (entry.lastKnownServerRoot !== null && serverRoot !== entry.lastKnownServerRoot) {
          emitConflict({
            depotId: entry.depotId,
            localRoot: entry.targetRoot,
            serverRoot,
            resolution: "lww-overwrite",
          });
        }

        // LWW commit
        const commitResult = await client.depots.commit(entry.depotId, {
          root: entry.targetRoot,
        });
        if (!commitResult.ok) {
          console.error(
            `[SyncManager] depots.commit failed for ${entry.depotId}:`,
            commitResult.error
          );
          failPermanently(entry, commitResult.error);
          continue;
        }

        // Success — remove from queue
        memQueue.delete(entry.depotId);
        await queueStore.remove(entry.depotId);
        emitCommit({ depotId: entry.depotId, committedRoot: entry.targetRoot });
      } catch (err) {
        if (isNetworkError(err)) {
          // Network failure (fetch TypeError) — retry with backoff
          console.warn(
            `[SyncManager] network error for depot ${entry.depotId} (retry #${entry.retryCount + 1}):`,
            err
          );
          bumpRetry(entry);
        } else {
          // Local error (syncTree failure, etc.) — permanent
          console.error(`[SyncManager] sync failed for depot ${entry.depotId}:`, err);
          failPermanently(entry, {
            code: "sync_error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    updatePendingCount();

    if (memQueue.size > 0) {
      setState("error");
      // Exponential backoff + jitter
      const maxRetry = Math.max(...[...memQueue.values()].map((e) => e.retryCount));
      const baseDelay = Math.min(MIN_RETRY_DELAY * 2 ** maxRetry, MAX_RETRY_DELAY);
      const jitter = baseDelay * (0.5 + Math.random());
      scheduleRetry(jitter);
    } else {
      setState("idle");
    }
  }

  // -- Recover cycle (with user confirmation for conflicts) --

  async function runRecover(): Promise<void> {
    setState("recovering");

    const entries = await queueStore.loadAll();
    if (entries.length === 0) {
      setState("idle");
      return;
    }

    // Populate in-memory queue
    for (const entry of entries) {
      memQueue.set(entry.depotId, entry);
    }
    updatePendingCount();

    // Trigger normal sync (which handles flush + commit + conflict detection)
    triggerSync();
  }

  // -- Public API --

  const manager: SyncManager = {
    enqueue(depotId: string, newRoot: string, lastKnownServerRoot: string | null): void {
      if (disposed) return;

      const existing = memQueue.get(depotId);
      const now = Date.now();

      if (existing) {
        // Merge: update targetRoot + updatedAt, reset retryCount.
        // lastKnownServerRoot stays from first enqueue.
        const merged: DepotSyncEntry = {
          ...existing,
          targetRoot: newRoot,
          updatedAt: now,
          retryCount: 0,
        };
        memQueue.set(depotId, merged);
        queueStore.upsert(merged).catch(() => {});
      } else {
        const entry: DepotSyncEntry = {
          depotId,
          targetRoot: newRoot,
          lastKnownServerRoot,
          createdAt: now,
          updatedAt: now,
          retryCount: 0,
        };
        memQueue.set(depotId, entry);
        queueStore.upsert(entry).catch(() => {});
      }

      updatePendingCount();
      scheduleSyncDebounced();
    },

    async recover(): Promise<void> {
      if (disposed) return;
      await runRecover();
    },

    async flushNow(): Promise<void> {
      if (disposed) return;
      clearTimers();

      // Wait for any in-progress sync
      if (activeSyncPromise) await activeSyncPromise;

      // Run sync immediately (no debounce)
      if (memQueue.size > 0) {
        await runSync();
      }
    },

    onStateChange(listener: (state: SyncState) => void): () => void {
      stateListeners.add(listener);
      listener(state); // notify current state immediately
      return () => stateListeners.delete(listener);
    },

    onConflict(listener: (event: ConflictEvent) => void): () => void {
      conflictListeners.add(listener);
      return () => conflictListeners.delete(listener);
    },

    onError(listener: (event: SyncErrorEvent) => void): () => void {
      errorListeners.add(listener);
      return () => errorListeners.delete(listener);
    },

    onCommit(listener: (event: SyncCommitEvent) => void): () => void {
      commitListeners.add(listener);
      return () => commitListeners.delete(listener);
    },

    getPendingRoot(depotId: string): string | null {
      return memQueue.get(depotId)?.targetRoot ?? null;
    },

    getState(): SyncState {
      return state;
    },

    getPendingCount(): number {
      return pendingCount;
    },

    dispose(): void {
      disposed = true;
      clearTimers();
    },
  };

  return manager;
};
