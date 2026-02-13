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
 * Pluggable persistence for pending sync keys.
 *
 * Layer 1 of the sync model: CAS Node Sync is fully idempotent.
 * This store enables recovery of pending keys across page reloads.
 */
export type PendingKeyStore = {
  /** Load all previously persisted pending keys */
  load(): Promise<string[]>;
  /** Persist newly added pending keys */
  add(keys: string[]): Promise<void>;
  /** Remove keys that have been successfully synced */
  remove(keys: string[]): Promise<void>;
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
  /**
   * Optional: persist pending keys so they survive page close / refresh.
   * On initialization, persisted keys are loaded and queued for sync.
   */
  pendingKeyStore?: PendingKeyStore;
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
   * @deprecated Use `syncTree(rootKey)` instead.
   * No-op in the current implementation — kept for backward compatibility.
   */
  flush: () => Promise<void>;
  /**
   * Sync a CAS tree rooted at `rootKey` to the remote backend.
   *
   * Walks the tree starting from `rootKey`, batch-checks which nodes already
   * exist on the remote, and only uploads missing/unowned nodes.
   *
   * **Pruning**: If a node is already "owned" on the remote, its entire subtree
   * is skipped — in a Merkle/CAS tree, an existing parent implies all
   * descendants also exist.
   *
   * Requires `writeBack.getChildKeys` to be set.
   *
   * @param rootKey — CB32 storage key of the tree root
   */
  syncTree: (rootKey: string) => Promise<void>;
  /**
   * Clean up internal resources.
   */
  dispose: () => void;
};

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
      syncTree: async () => {},
      dispose: () => {},
    };
  }

  // --------------------------------------------------------------------------
  // Write-back mode
  //
  // put() writes only to local cache — no pending-key tracking.
  // syncTree(rootKey) walks the Merkle tree from the given root, batch-checks
  // against the remote, prunes already-owned subtrees, and uploads only the
  // missing / unowned nodes in topological (children-first) order.
  // --------------------------------------------------------------------------

  const { onSyncStart, onSyncEnd, onKeySync, getChildKeys } = writeBack;

  return {
    get,
    has,

    async put(key: string, value: Uint8Array): Promise<void> {
      await cache.put(key, value);
    },

    /** @deprecated No-op — use `syncTree(rootKey)` instead. */
    async flush(): Promise<void> {},

    async syncTree(rootKey: string): Promise<void> {
      if (!getChildKeys) {
        throw new Error("syncTree requires writeBack.getChildKeys to be configured");
      }

      await onSyncStart?.();

      const synced: string[] = [];
      const skipped: string[] = [];
      const failed: Array<{ key: string; error: unknown }> = [];

      try {
        // ── Phase 1: Walk tree, batch-check, prune — collect nodes to upload ──
        const toUpload = new Map<string, Uint8Array>();
        const toClaimKeys = new Set<string>();
        const visited = new Set<string>();

        let frontier = [rootKey];

        while (frontier.length > 0) {
          // Deduplicate and filter already-visited keys
          const unique = [...new Set(frontier)].filter((k) => !visited.has(k));
          if (unique.length === 0) break;
          for (const k of unique) visited.add(k);

          // Batch check against remote
          let statusMap: Map<string, "owned" | "unowned" | "missing">;
          if (remote.checkMany) {
            const status = await remote.checkMany(unique);
            statusMap = new Map<string, "owned" | "unowned" | "missing">();
            for (const k of status.owned) statusMap.set(k, "owned");
            for (const k of status.unowned) statusMap.set(k, "unowned");
            for (const k of status.missing) statusMap.set(k, "missing");
          } else {
            // Fallback: individual has() checks
            statusMap = new Map();
            for (const k of unique) {
              const exists = await remote.has(k);
              statusMap.set(k, exists ? "owned" : "missing");
            }
          }

          const nextFrontier: string[] = [];

          for (const key of unique) {
            const status = statusMap.get(key) ?? "missing";

            if (status === "owned") {
              // Already on remote and owned → prune entire subtree
              skipped.push(key);
              continue;
            }

            // Need to process this node — read from cache
            const data = await cache.get(key);
            if (!data) {
              // Not in local cache — assumed to be on remote already
              skipped.push(key);
              continue;
            }

            if (status === "missing") {
              toUpload.set(key, data);
            } else {
              // unowned — claim instead of upload
              toClaimKeys.add(key);
              toUpload.set(key, data);
            }

            // Expand children for next frontier
            const children = getChildKeys(data);
            for (const child of children) {
              if (!visited.has(child)) {
                nextFrontier.push(child);
              }
            }
          }

          frontier = nextFrontier;
        }

        if (toUpload.size === 0) return; // nothing to sync

        // ── Phase 2: Upload / claim in topological order (children first) ──
        const entries = [...toUpload.entries()].map(([key, value]) => ({ key, value }));
        const levels = topoSortLevels(entries, getChildKeys);

        for (const level of levels) {
          // Phase A: claim unowned entries
          const claimEntries = level.filter((e) => toClaimKeys.has(e.key));
          if (claimEntries.length > 0) {
            const results = await Promise.allSettled(
              claimEntries.map(async (entry) => {
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
            for (const [i, result] of results.entries()) {
              if (result.status === "fulfilled") {
                synced.push(result.value);
              } else {
                failed.push({ key: claimEntries[i]!.key, error: result.reason });
              }
            }
          }

          // Phase B: put missing entries (children already claimed/uploaded)
          const putEntries = level.filter((e) => !toClaimKeys.has(e.key));
          if (putEntries.length > 0) {
            const results = await Promise.allSettled(
              putEntries.map(async (entry) => {
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
            for (const [i, result] of results.entries()) {
              if (result.status === "fulfilled") {
                synced.push(result.value);
              } else {
                failed.push({ key: putEntries[i]!.key, error: result.reason });
              }
            }
          }
        }
      } finally {
        onSyncEnd?.({ synced, skipped, failed });
      }

      if (failed.length > 0) {
        throw new Error(
          `syncTree: failed to sync ${failed.length} nodes: ${failed
            .slice(0, 5)
            .map((f) => f.key)
            .join(", ")}`
        );
      }
    },

    dispose(): void {},
  };
};
