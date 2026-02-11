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
  /** Called when a sync cycle begins (may be async — awaited before syncing) */
  onSyncStart?: () => void | Promise<void>;
  /** Called when a sync cycle completes */
  onSyncEnd?: (result: SyncResult) => void;
  /** Called for each key during sync: uploading → done / error */
  onKeySync?: (key: string, status: "uploading" | "done" | "error", error?: unknown) => void;
  /**
   * Extract child storage keys from raw node bytes.
   * When provided, sync uploads nodes in topological order (children first)
   * to prevent server-side "missing_nodes" rejections.
   */
  getChildKeys?: (value: Uint8Array) => string[];
};

/** Three-way check result */
export type CheckManyResult = {
  missing: string[];
  unowned: string[];
  owned: string[];
};

export type CachedStorageConfig = {
  /** Local cache layer (e.g., IndexedDB, FS, memory) */
  cache: StorageProvider;
  /**
   * Remote / slower backend (e.g., HTTP, S3, FS).
   *
   * When the remote supports `checkMany` + `claim`, sync will:
   *   1. Batch-check all pending keys in a single call
   *   2. `put` missing nodes (upload bytes)
   *   3. `claim` unowned nodes (PoP only, no bytes uploaded)
   *   4. Skip already-owned nodes
   *
   * Without these methods, sync falls back to individual `put()` calls,
   * relying on the remote's put implementation to handle claim internally.
   */
  remote: StorageProvider & {
    /** Batch check returning three-way status for each key. */
    checkMany?: (keys: string[]) => Promise<CheckManyResult>;
    /** Claim an unowned node via PoP. The value is used locally for PoP computation, NOT uploaded. */
    claim?: (key: string, value: Uint8Array) => Promise<void>;
  };
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
// Topological Sort
// ============================================================================

/**
 * Topologically sort entries so children come before parents.
 * Returns an array of levels — each level contains entries whose
 * children (within the batch) have all been placed in earlier levels.
 *
 * Nodes at the same level have no dependency on each other and can
 * be uploaded in parallel.
 *
 * Uses Kahn's algorithm. For valid CAS data, cycles are impossible
 * since a node's hash depends on its children's hashes.
 */
const topoSortLevels = (
  entries: Array<{ key: string; value: Uint8Array }>,
  getChildKeys: (value: Uint8Array) => string[]
): Array<Array<{ key: string; value: Uint8Array }>> => {
  if (entries.length <= 1) return [entries];

  const entryMap = new Map(entries.map((e) => [e.key, e]));

  // For each entry, in-degree = number of children in this batch
  const inDegree = new Map<string, number>();
  // Reverse map: child → parents that depend on it
  const dependents = new Map<string, string[]>();

  for (const entry of entries) {
    const children = getChildKeys(entry.value);
    let degree = 0;
    for (const child of children) {
      if (entryMap.has(child)) {
        degree++;
        let parents = dependents.get(child);
        if (!parents) {
          parents = [];
          dependents.set(child, parents);
        }
        parents.push(entry.key);
      }
    }
    inDegree.set(entry.key, degree);
  }

  const levels: Array<Array<{ key: string; value: Uint8Array }>> = [];
  const processed = new Set<string>();

  // Seed: all entries with in-degree 0 (leaves — no pending children)
  let current = entries.filter((e) => (inDegree.get(e.key) ?? 0) === 0);

  while (current.length > 0) {
    levels.push(current);
    const next: Array<{ key: string; value: Uint8Array }> = [];

    for (const entry of current) {
      processed.add(entry.key);
      const parents = dependents.get(entry.key);
      if (parents) {
        for (const parentKey of parents) {
          const newDegree = (inDegree.get(parentKey) ?? 1) - 1;
          inDegree.set(parentKey, newDegree);
          if (newDegree === 0 && !processed.has(parentKey)) {
            next.push(entryMap.get(parentKey)!);
          }
        }
      }
    }

    current = next;
  }

  // Safety: add any remaining entries (shouldn't happen for valid CAS data)
  const remaining = entries.filter((e) => !processed.has(e.key));
  if (remaining.length > 0) {
    levels.push(remaining);
  }

  return levels;
};

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

  const {
    debounceMs = DEFAULT_DEBOUNCE_MS,
    onSyncStart,
    onSyncEnd,
    onKeySync,
    getChildKeys,
  } = writeBack;

  const pendingKeys = new Set<string>();
  let syncTimer: ReturnType<typeof setTimeout> | null = null;
  let activeSyncPromise: Promise<void> | null = null;

  /**
   * Run a single sync cycle: read from cache, topologically sort,
   * then sync to remote (children before parents).
   *
   * When the remote supports `checkMany` + `claim`:
   *   1. Single batch check for all pending keys
   *   2. `put` for missing nodes (upload bytes)
   *   3. `claim` for unowned nodes (PoP only, no bytes re-uploaded)
   *   4. Skip owned nodes
   *
   * Without these methods, falls back to individual `put()` calls
   * that rely on the remote implementation to handle claim internally.
   */
  const runSync = async (): Promise<void> => {
    if (pendingKeys.size === 0) return;

    // Snapshot & clear — new puts during sync accumulate for next batch
    const keys = [...pendingKeys];
    pendingKeys.clear();

    const synced: string[] = [];
    const skipped: string[] = [];
    const failed: Array<{ key: string; error: unknown }> = [];

    await onSyncStart?.();

    // 1. Read all pending data from cache
    const entries: Array<{ key: string; value: Uint8Array }> = [];
    for (const key of keys) {
      const data = await cache.get(key);
      if (!data) {
        const err = new Error(`Pending key missing from cache: ${key}`);
        onKeySync?.(key, "error", err);
        failed.push({ key, error: err });
        continue;
      }
      entries.push({ key, value: data });
    }

    // 2. Topological sort (children first) if getChildKeys is provided
    const levels = getChildKeys ? topoSortLevels(entries, getChildKeys) : [entries]; // no dependency info → single level (all parallel)

    // 3. Sync — level by level, children before parents
    if (remote.checkMany) {
      // ---- Batch check + explicit put / claim / skip ----
      const allKeys = entries.map((e) => e.key);

      // 3a. Discover external children — referenced by entries but NOT in pending set.
      //     These may be unowned on the remote and need claiming before parents can be PUT.
      const entryKeySet = new Set(allKeys);
      const externalChildKeys: string[] = [];
      if (getChildKeys) {
        for (const entry of entries) {
          for (const childKey of getChildKeys(entry.value)) {
            if (!entryKeySet.has(childKey) && !externalChildKeys.includes(childKey)) {
              externalChildKeys.push(childKey);
            }
          }
        }
      }

      // 3b. Batch check: all pending keys + external children in a single call
      const checkKeys = [...allKeys, ...externalChildKeys];
      const status = await remote.checkMany(checkKeys);
      const missingSet = new Set(status.missing);
      const unownedSet = new Set(status.unowned);

      // Owned keys → skip immediately (only for pending entries, not external children)
      for (const key of status.owned) {
        if (entryKeySet.has(key)) {
          skipped.push(key);
        }
      }

      // 3c. Claim all unowned external children first (they must be owned before
      //     any parent node referencing them can be PUT)
      if (externalChildKeys.length > 0 && remote.claim) {
        const unownedExternal = externalChildKeys.filter((k) => unownedSet.has(k));
        for (const childKey of unownedExternal) {
          try {
            // Read child bytes from cache (needed for PoP computation)
            const childData = await cache.get(childKey);
            if (!childData) {
              // Not in cache — fetch from remote, then claim
              const fetched = await remote.get(childKey);
              if (fetched) {
                await remote.claim(childKey, fetched);
              }
            } else {
              await remote.claim(childKey, childData);
            }
          } catch (_err) {
            // External child claim failure is not fatal for the sync result
            // — the parent put will fail with CHILD_NOT_AUTHORIZED and be retried
          }
        }
      }

      // 3d. Process each level: claim unowned entries first, then put missing entries.
      //     Two-phase within each level prevents race conditions where a parent's
      //     PUT arrives at the server before its child's CLAIM completes.
      for (const level of levels) {
        const unownedEntries = level.filter((e) => unownedSet.has(e.key));
        const missingEntries = level.filter((e) => missingSet.has(e.key));

        // Phase 1: claim all unowned entries in this level
        if (unownedEntries.length > 0) {
          const claimResults = await Promise.allSettled(
            unownedEntries.map(async (entry) => {
              onKeySync?.(entry.key, "uploading");
              try {
                if (remote.claim) {
                  await remote.claim(entry.key, entry.value);
                } else {
                  await remote.put(entry.key, entry.value);
                }
                onKeySync?.(entry.key, "done");
                return entry.key;
              } catch (err) {
                onKeySync?.(entry.key, "error", err);
                throw err;
              }
            })
          );

          for (const [i, result] of claimResults.entries()) {
            if (result.status === "fulfilled") {
              synced.push(result.value);
            } else {
              const key = unownedEntries[i]!.key;
              failed.push({ key, error: result.reason });
              pendingKeys.add(key);
            }
          }
        }

        // Phase 2: put all missing entries (children are now owned)
        if (missingEntries.length > 0) {
          const putResults = await Promise.allSettled(
            missingEntries.map(async (entry) => {
              onKeySync?.(entry.key, "uploading");
              try {
                await remote.put(entry.key, entry.value);
                onKeySync?.(entry.key, "done");
                return entry.key;
              } catch (err) {
                onKeySync?.(entry.key, "error", err);
                throw err;
              }
            })
          );

          for (const [i, result] of putResults.entries()) {
            if (result.status === "fulfilled") {
              synced.push(result.value);
            } else {
              const key = missingEntries[i]!.key;
              failed.push({ key, error: result.reason });
              pendingKeys.add(key);
            }
          }
        }
      }
    } else {
      // ---- Fallback: individual put() calls (remote handles claim internally) ----
      for (const level of levels) {
        const results = await Promise.allSettled(
          level.map(async (entry) => {
            onKeySync?.(entry.key, "uploading");
            try {
              await remote.put(entry.key, entry.value);
              onKeySync?.(entry.key, "done");
            } catch (err) {
              onKeySync?.(entry.key, "error", err);
              throw err;
            }
            return entry.key;
          })
        );

        for (const [i, result] of results.entries()) {
          if (result.status === "fulfilled") {
            synced.push(result.value);
          } else {
            const key = level[i]!.key;
            failed.push({ key, error: result.reason });
            pendingKeys.add(key);
          }
        }
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
