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

// ============================================================================
// Types
// ============================================================================

/**
 * Minimal interface for Layer 1 storage — only needs flush().
 * Matches CachedStorageProvider from @casfa/storage-cached
 * without requiring the dependency.
 */
export type FlushableStorage = {
  flush(): Promise<void>;
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

export type SyncManagerConfig = {
  /** Layer 1: storage with flush() — used to sync CAS nodes before committing */
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

  // -- Helpers --

  /**
   * Determine whether a server error response is retryable.
   * Only transient failures (429 rate-limit, 5xx server errors) warrant retry.
   * Client errors (4xx except 429) are permanent — the request itself is wrong.
   * When status is undefined we treat it as retryable (unknown failure).
   */
  function isRetryableStatus(status: number | undefined): boolean {
    if (status === undefined) return true;
    return status === 429 || status >= 500;
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

  /** Increment retryCount for a transient failure (network error or 5xx/429). */
  function bumpRetry(entry: DepotSyncEntry): void {
    const updated: DepotSyncEntry = {
      ...entry,
      retryCount: entry.retryCount + 1,
      updatedAt: Date.now(),
    };
    memQueue.set(entry.depotId, updated);
    queueStore.upsert(updated).catch(() => {});
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

    // ── Layer 1: flush all pending CAS nodes ──
    // flush() is global and idempotent. If it fails, we must NOT commit
    // because the server would get a tree pointer referencing missing nodes.
    try {
      await storage.flush();
    } catch (err) {
      console.error("[SyncManager] flush failed, aborting sync cycle:", err);
      setState("error");
      scheduleRetry(5_000);
      return;
    }

    // ── Layer 2: commit each depot ──
    const entries = [...memQueue.values()];

    for (const entry of entries) {
      if (disposed) return;

      if (entry.retryCount >= MAX_RETRY_COUNT) {
        console.error(
          `[SyncManager] depot ${entry.depotId} exceeded max retries (${MAX_RETRY_COUNT}), giving up`
        );
        memQueue.delete(entry.depotId);
        await queueStore.remove(entry.depotId);
        emitError({
          depotId: entry.depotId,
          targetRoot: entry.targetRoot,
          error: { code: "max_retries", message: `Exceeded ${MAX_RETRY_COUNT} retries` },
          permanent: true,
        });
        continue;
      }

      try {
        // Check current server state
        const result = await client.depots.get(entry.depotId);
        if (!result.ok) {
          if (isRetryableStatus(result.error.status)) {
            // Transient — retry later
            bumpRetry(entry);
          } else {
            // Permanent server error — give up
            memQueue.delete(entry.depotId);
            await queueStore.remove(entry.depotId);
            emitError({
              depotId: entry.depotId,
              targetRoot: entry.targetRoot,
              error: result.error,
              permanent: true,
            });
          }
          continue;
        }

        const serverRoot = result.data.root;

        // Already synced — remove
        if (serverRoot === entry.targetRoot) {
          memQueue.delete(entry.depotId);
          await queueStore.remove(entry.depotId);
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
          if (isRetryableStatus(commitResult.error.status)) {
            // Transient — retry later
            bumpRetry(entry);
          } else {
            // Permanent server error — give up
            memQueue.delete(entry.depotId);
            await queueStore.remove(entry.depotId);
            emitError({
              depotId: entry.depotId,
              targetRoot: entry.targetRoot,
              error: commitResult.error,
              permanent: true,
            });
          }
          continue;
        }

        // Success — remove from queue
        memQueue.delete(entry.depotId);
        await queueStore.remove(entry.depotId);
      } catch (_err) {
        // Network error (fetch threw) — always retry
        bumpRetry(entry);
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
        // Merge: only update targetRoot + updatedAt.
        // lastKnownServerRoot stays from first enqueue.
        const merged: DepotSyncEntry = {
          ...existing,
          targetRoot: newRoot,
          updatedAt: now,
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
