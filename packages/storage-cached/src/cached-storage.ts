/**
 * Cached StorageProvider — composes a local cache with a remote backend.
 *
 * CAS blocks are immutable, so cache entries never need invalidation.
 *
 * Read path:
 *   cache.get → hit? return : remote.get → write-back to cache → return
 *
 * Has path:
 *   cache.has → true? return : remote.has
 *
 * Write path:
 *   Write-through (default):
 *     cache.put → remote.put
 *   Write-back (when writeBack config is provided):
 *     cache.put → return immediately → debounced batch sync to remote
 *
 * Typical pairings:
 *   - IndexedDB  + HTTP   (browser)
 *   - FS storage + HTTP   (CLI / Node.js)
 *   - Memory     + HTTP   (short-lived scripts)
 *   - Memory     + FS     (warm process cache over disk)
 *
 * @packageDocumentation
 */

import type { StorageProvider } from "@casfa/storage-core";

// ============================================================================
// Types
// ============================================================================

/**
 * Result of a background sync cycle.
 */
export type SyncResult = {
  /** Keys successfully uploaded to remote */
  synced: string[];
  /** Keys already present on remote (no upload needed) */
  skipped: string[];
  /** Keys that failed to sync (will be retried on next cycle) */
  failed: Array<{ key: string; error: unknown }>;
};

/**
 * Write-back configuration for deferred, batched remote sync.
 */
export type WriteBackConfig = {
  /** Debounce interval in milliseconds before triggering a sync (default: 100) */
  debounceMs?: number;
  /** Called when a sync cycle begins */
  onSyncStart?: () => void;
  /** Called when a sync cycle completes */
  onSyncEnd?: (result: SyncResult) => void;
  /** Called for each key during sync: uploading → done / error */
  onKeySync?: (key: string, status: "uploading" | "done" | "error", error?: unknown) => void;
};

export type CachedStorageConfig = {
  /** Local cache layer (e.g., IndexedDB, FS, memory) */
  cache: StorageProvider;
  /** Remote / slower backend (e.g., HTTP, S3, FS) */
  remote: StorageProvider;
  /**
   * Enable write-back mode.
   * When set, `put` writes only to cache and returns immediately.
   * Pending keys are synced to remote in debounced batches.
   */
  writeBack?: WriteBackConfig;
};

/**
 * Extended StorageProvider with sync control methods.
 */
export type CachedStorageProvider = StorageProvider & {
  /**
   * Force-sync all pending writes to remote.
   * Resolves when all pending keys have been synced (or failed).
   * In write-through mode this is a no-op.
   */
  flush: () => Promise<void>;
  /**
   * Clean up internal timers. Does NOT flush pending writes.
   * Call `flush()` first if you need to ensure all data is synced.
   */
  dispose: () => void;
};

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_DEBOUNCE_MS = 100;

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a cached StorageProvider that layers a local cache over a remote backend.
 *
 * Read path: cache → remote → write-back to cache.
 * Write path: depends on config — write-through (default) or write-back.
 */
export const createCachedStorage = (config: CachedStorageConfig): CachedStorageProvider => {
  const { cache, remote, writeBack } = config;

  // --------------------------------------------------------------------------
  // Shared read logic
  // --------------------------------------------------------------------------

  const get = async (key: string): Promise<Uint8Array | null> => {
    const cached = await cache.get(key);
    if (cached) return cached;

    const data = await remote.get(key);
    if (data) {
      cache.put(key, data).catch(() => {
        // Silently ignore cache write failures
      });
    }
    return data;
  };

  const has = async (key: string): Promise<boolean> => {
    const inCache = await cache.has(key);
    if (inCache) return true;
    return remote.has(key);
  };

  // --------------------------------------------------------------------------
  // Write-through mode (no writeBack config)
  // --------------------------------------------------------------------------

  if (!writeBack) {
    return {
      get,
      has,
      async put(key: string, value: Uint8Array): Promise<void> {
        await cache.put(key, value);
        await remote.put(key, value);
      },
      flush: async () => {},
      dispose: () => {},
    };
  }

  // --------------------------------------------------------------------------
  // Write-back mode
  // --------------------------------------------------------------------------

  const { debounceMs = DEFAULT_DEBOUNCE_MS, onSyncStart, onSyncEnd, onKeySync } = writeBack;

  const pendingKeys = new Set<string>();
  let syncTimer: ReturnType<typeof setTimeout> | null = null;
  let activeSyncPromise: Promise<void> | null = null;

  /**
   * Run a single sync cycle: read from cache, put to remote in parallel.
   *
   * remote.put() already handles check+upload internally (via httpStorage),
   * so we skip a separate has-check to avoid double-checking and potential
   * cache staleness issues.
   */
  const runSync = async (): Promise<void> => {
    if (pendingKeys.size === 0) return;

    // Snapshot & clear — new puts during sync accumulate for next batch
    const keys = [...pendingKeys];
    pendingKeys.clear();

    const synced: string[] = [];
    const skipped: string[] = [];
    const failed: Array<{ key: string; error: unknown }> = [];

    onSyncStart?.();

    try {
      // Parallel put — remote.put() handles check+upload internally
      const results = await Promise.allSettled(
        keys.map(async (key) => {
          const data = await cache.get(key);
          if (!data) {
            onKeySync?.(key, "error", new Error("missing from cache"));
            throw new Error(`Pending key missing from cache: ${key}`);
          }
          onKeySync?.(key, "uploading");
          try {
            await remote.put(key, data);
            onKeySync?.(key, "done");
          } catch (err) {
            onKeySync?.(key, "error", err);
            throw err;
          }
          return key;
        })
      );

      for (const [i, result] of results.entries()) {
        if (result.status === "fulfilled") {
          synced.push(result.value);
        } else {
          const key = keys[i]!;
          failed.push({ key, error: result.reason });
          pendingKeys.add(key); // re-queue for retry
        }
      }
    } catch (error) {
      // Catastrophic failure — re-queue all
      for (const key of keys) {
        pendingKeys.add(key);
        failed.push({ key, error });
      }
    }

    onSyncEnd?.({ synced, skipped, failed });
  };

  /**
   * Trigger a sync cycle, guarding against concurrent runs.
   */
  const triggerSync = (): void => {
    if (activeSyncPromise || pendingKeys.size === 0) return;

    activeSyncPromise = runSync().finally(() => {
      activeSyncPromise = null;
      // If more keys arrived during sync, schedule another cycle
      if (pendingKeys.size > 0) {
        scheduleSync();
      }
    });
  };

  /**
   * Schedule a debounced sync.
   */
  const scheduleSync = (): void => {
    if (syncTimer !== null) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      syncTimer = null;
      triggerSync();
    }, debounceMs);
  };

  return {
    get,
    has,

    async put(key: string, value: Uint8Array): Promise<void> {
      await cache.put(key, value);
      pendingKeys.add(key);
      scheduleSync();
    },

    async flush(): Promise<void> {
      // Cancel scheduled timer
      if (syncTimer !== null) {
        clearTimeout(syncTimer);
        syncTimer = null;
      }

      // Wait for any in-progress sync
      if (activeSyncPromise) await activeSyncPromise;

      // Sync remaining pending keys (loop in case failures re-queue)
      let maxRetries = 3;
      while (pendingKeys.size > 0 && maxRetries-- > 0) {
        await runSync();
      }

      // If keys still remain after retries, throw so callers don't
      // proceed assuming data is on the remote
      if (pendingKeys.size > 0) {
        const remaining = [...pendingKeys];
        throw new Error(
          `Failed to sync ${remaining.length} keys after retries: ${remaining.slice(0, 5).join(", ")}`
        );
      }
    },

    dispose(): void {
      if (syncTimer !== null) {
        clearTimeout(syncTimer);
        syncTimer = null;
      }
    },
  };
};
