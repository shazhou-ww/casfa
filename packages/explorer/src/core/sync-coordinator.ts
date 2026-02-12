/**
 * SyncCoordinator — SW variant of SyncManager.
 *
 * Same core logic (enqueue → debounce → Layer 1 flush → Layer 2 commit),
 * but adapted for the Service Worker environment:
 *
 * - **Late-bound client**: SW may start without authentication. Client is
 *   set via `setClient()` after token recovery or `set-user-token` RPC.
 * - **Broadcast events**: Instead of listener sets, events are broadcast
 *   to all tabs via BroadcastChannel (injected as `broadcast()` config).
 * - **Public `runSync()`**: Called by Background Sync API (`sync` event).
 * - **No `dispose()`**: Lives for the SW lifetime.
 *
 * Reuses all types from sync-manager.ts (FlushableStorage, SyncQueueStore,
 * DepotSyncEntry, SyncState, ConflictEvent, SyncErrorEvent, SyncCommitEvent).
 *
 * @packageDocumentation
 */

import type { CasfaClient } from "@casfa/client";
import type {
  ConflictEvent,
  DepotSyncEntry,
  FlushableStorage,
  SyncCommitEvent,
  SyncErrorEvent,
  SyncQueueStore,
  SyncState,
} from "./sync-manager.ts";

// ============================================================================
// Types
// ============================================================================

/** Broadcast message shape — matches BroadcastMessage in @casfa/client-bridge. */
export type SyncBroadcastMessage =
  | { type: "sync-state"; payload: SyncState }
  | { type: "conflict"; payload: ConflictEvent }
  | { type: "sync-error"; payload: SyncErrorEvent }
  | { type: "commit"; payload: SyncCommitEvent }
  | { type: "pending-count"; payload: number };

export type SyncCoordinator = {
  /** Enqueue a depot root for background commit. */
  enqueue(
    depotId: string,
    targetRoot: string,
    lastKnownServerRoot: string | null,
  ): void;

  /** Force-flush all pending sync. */
  flushNow(): Promise<void>;

  /**
   * Run a full sync cycle. Public entry point for the Background Sync API.
   * Also called internally after debounce.
   */
  runSync(): Promise<void>;

  /** Set (or replace) the CasfaClient used for API calls. */
  setClient(client: CasfaClient): void;

  /**
   * Recover pending entries from the persistent queue store.
   * Requires `setClient()` to have been called first.
   */
  recover(): Promise<void>;

  /** Get the pending (uncommitted) target root for a depot, or null. */
  getPendingRoot(depotId: string): string | null;

  /** Get current sync state. */
  getState(): SyncState;

  /** Get number of pending entries. */
  getPendingCount(): number;
};

export type SyncCoordinatorConfig = {
  /** Layer 1 storage with flush(). */
  storage: FlushableStorage;
  /** Persistent depot sync queue store. */
  queueStore: SyncQueueStore;
  /** Broadcast events to all tabs. */
  broadcast: (msg: SyncBroadcastMessage) => void;
  /** Debounce delay in ms (default: 2000). */
  debounceMs?: number;
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

export function createSyncCoordinator(
  config: SyncCoordinatorConfig,
): SyncCoordinator {
  const {
    storage,
    queueStore,
    broadcast,
    debounceMs = DEFAULT_DEBOUNCE_MS,
  } = config;

  // -- State --
  let state: SyncState = "idle";
  let client: CasfaClient | null = null;

  // -- In-memory queue mirror --
  const memQueue = new Map<string, DepotSyncEntry>();

  // -- Timers --
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let activeSyncPromise: Promise<void> | null = null;

  // -- Helpers --

  function isRetryableStatus(status: number | undefined): boolean {
    if (status === undefined) return true;
    return status === 429 || status >= 500;
  }

  function setState(s: SyncState): void {
    if (state === s) return;
    state = s;
    broadcast({ type: "sync-state", payload: s });
  }

  function broadcastPendingCount(): void {
    broadcast({ type: "pending-count", payload: memQueue.size });
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
    clearTimers();
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      triggerSync();
    }, debounceMs);
  }

  function scheduleRetry(delay: number): void {
    retryTimer = setTimeout(() => {
      retryTimer = null;
      triggerSync();
    }, delay);
  }

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
    if (!client || activeSyncPromise || memQueue.size === 0) return;
    activeSyncPromise = runSyncInternal().finally(() => {
      activeSyncPromise = null;
      if (memQueue.size > 0) {
        scheduleSyncDebounced();
      }
    });
  }

  // -- Core sync cycle --

  async function runSyncInternal(): Promise<void> {
    if (!client || memQueue.size === 0) return;

    setState("syncing");

    // ── Layer 1: flush all pending CAS nodes ──
    try {
      await storage.flush();
    } catch (err) {
      console.error("[SyncCoordinator] flush failed:", err);
      setState("error");
      scheduleRetry(5_000);
      return;
    }

    // ── Layer 2: commit each depot ──
    const entries = [...memQueue.values()];

    for (const entry of entries) {
      if (!client) return; // client may have been cleared

      if (entry.retryCount >= MAX_RETRY_COUNT) {
        console.error(
          `[SyncCoordinator] depot ${entry.depotId} exceeded max retries (${MAX_RETRY_COUNT}), giving up`,
        );
        memQueue.delete(entry.depotId);
        await queueStore.remove(entry.depotId);
        broadcast({
          type: "sync-error",
          payload: {
            depotId: entry.depotId,
            targetRoot: entry.targetRoot,
            error: {
              code: "max_retries",
              message: `Exceeded ${MAX_RETRY_COUNT} retries`,
            },
            permanent: true,
          },
        });
        continue;
      }

      try {
        // Check current server state
        const result = await client.depots.get(entry.depotId);
        if (!result.ok) {
          if (isRetryableStatus(result.error.status)) {
            bumpRetry(entry);
          } else {
            memQueue.delete(entry.depotId);
            await queueStore.remove(entry.depotId);
            broadcast({
              type: "sync-error",
              payload: {
                depotId: entry.depotId,
                targetRoot: entry.targetRoot,
                error: result.error,
                permanent: true,
              },
            });
          }
          continue;
        }

        const serverRoot = result.data.root;

        // Already synced
        if (serverRoot === entry.targetRoot) {
          memQueue.delete(entry.depotId);
          await queueStore.remove(entry.depotId);
          broadcast({
            type: "commit",
            payload: {
              depotId: entry.depotId,
              committedRoot: entry.targetRoot,
            },
          });
          continue;
        }

        // Conflict detection
        if (
          entry.lastKnownServerRoot !== null &&
          serverRoot !== entry.lastKnownServerRoot
        ) {
          broadcast({
            type: "conflict",
            payload: {
              depotId: entry.depotId,
              localRoot: entry.targetRoot,
              serverRoot,
              resolution: "lww-overwrite",
            },
          });
        }

        // LWW commit
        const commitResult = await client.depots.commit(entry.depotId, {
          root: entry.targetRoot,
        });
        if (!commitResult.ok) {
          if (isRetryableStatus(commitResult.error.status)) {
            bumpRetry(entry);
          } else {
            memQueue.delete(entry.depotId);
            await queueStore.remove(entry.depotId);
            broadcast({
              type: "sync-error",
              payload: {
                depotId: entry.depotId,
                targetRoot: entry.targetRoot,
                error: commitResult.error,
                permanent: true,
              },
            });
          }
          continue;
        }

        // Success
        memQueue.delete(entry.depotId);
        await queueStore.remove(entry.depotId);
        broadcast({
          type: "commit",
          payload: {
            depotId: entry.depotId,
            committedRoot: entry.targetRoot,
          },
        });
      } catch (_err) {
        // Network error — always retry
        bumpRetry(entry);
      }
    }

    broadcastPendingCount();

    if (memQueue.size > 0) {
      setState("error");
      const maxRetry = Math.max(
        ...[...memQueue.values()].map((e) => e.retryCount),
      );
      const baseDelay = Math.min(
        MIN_RETRY_DELAY * 2 ** maxRetry,
        MAX_RETRY_DELAY,
      );
      const jitter = baseDelay * (0.5 + Math.random());
      scheduleRetry(jitter);
    } else {
      setState("idle");
    }
  }

  // -- Public API --

  return {
    enqueue(
      depotId: string,
      targetRoot: string,
      lastKnownServerRoot: string | null,
    ): void {
      const existing = memQueue.get(depotId);
      const now = Date.now();

      if (existing) {
        const merged: DepotSyncEntry = {
          ...existing,
          targetRoot,
          updatedAt: now,
        };
        memQueue.set(depotId, merged);
        queueStore.upsert(merged).catch(() => {});
      } else {
        const entry: DepotSyncEntry = {
          depotId,
          targetRoot,
          lastKnownServerRoot,
          createdAt: now,
          updatedAt: now,
          retryCount: 0,
        };
        memQueue.set(depotId, entry);
        queueStore.upsert(entry).catch(() => {});
      }

      broadcastPendingCount();
      scheduleSyncDebounced();
    },

    async flushNow(): Promise<void> {
      clearTimers();
      if (activeSyncPromise) await activeSyncPromise;
      if (memQueue.size > 0) {
        await runSyncInternal();
      }
    },

    async runSync(): Promise<void> {
      clearTimers();
      if (activeSyncPromise) await activeSyncPromise;
      if (memQueue.size > 0) {
        await runSyncInternal();
      }
    },

    setClient(c: CasfaClient): void {
      client = c;
    },

    async recover(): Promise<void> {
      setState("recovering");

      const entries = await queueStore.loadAll();
      if (entries.length === 0) {
        setState("idle");
        return;
      }

      for (const entry of entries) {
        memQueue.set(entry.depotId, entry);
      }
      broadcastPendingCount();

      triggerSync();
    },

    getPendingRoot(depotId: string): string | null {
      return memQueue.get(depotId)?.targetRoot ?? null;
    },

    getState(): SyncState {
      return state;
    },

    getPendingCount(): number {
      return memQueue.size;
    },
  };
}
