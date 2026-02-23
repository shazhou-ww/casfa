/**
 * Buffered HTTP StorageProvider — buffers `put()` calls and syncs to remote
 * in batched, topologically-ordered flushes.
 *
 * Designed as the Layer 1 sync engine for CAS trees:
 *   put(key, value)  → buffer locally (no network)
 *   flush()          → topoSort → batch checkMany → claim/put dispatch
 *
 * Compose with `createCachedStorage` for a full cache + sync stack:
 *   const storage = createCachedStorage(indexedDB, bufferedHttp);
 *   // storage.put → indexedDB + buffer (instant)
 *   // bufferedHttp.flush() → upload to server
 *
 * @packageDocumentation
 */

import type { StorageProvider } from "@casfa/storage-core";
import type { CheckManyResult, HttpStorageProvider } from "./http-storage.ts";

// ============================================================================
// Types
// ============================================================================

/**
 * Result of a flush (sync) cycle.
 */
export type SyncResult = {
  /** Keys successfully uploaded to remote */
  synced: string[];
  /** Keys already present on remote (no upload needed) */
  skipped: string[];
  /** Keys that failed to sync */
  failed: Array<{ key: string; error: unknown }>;
};

/**
 * Configuration for createBufferedHttpStorage.
 */
export type BufferedHttpStorageConfig = {
  /**
   * Extract direct child storage keys from raw CAS node bytes.
   * Used for topological ordering — children are uploaded before parents
   * to prevent server-side "missing_nodes" rejections.
   */
  getChildKeys: (value: Uint8Array) => string[];
  /** Called when a flush cycle begins (may be async — awaited before flushing) */
  onSyncStart?: () => void | Promise<void>;
  /** Called when a flush cycle completes */
  onSyncEnd?: (result: SyncResult) => void;
  /** Called for each key during flush: uploading → done / error */
  onKeySync?: (key: string, status: "uploading" | "done" | "error", error?: unknown) => void;
  /**
   * Maximum number of concurrent upload/claim operations per topological level.
   * Prevents overwhelming the network / RPC channel when flushing many blocks.
   * Default: 8.
   */
  maxConcurrency?: number;
};

/**
 * StorageProvider extended with flush control.
 *
 * - `get` / `put` — standard StorageProvider interface
 * - `flush()` — upload all buffered entries to the HTTP backend
 * - `dispose()` — clean up internal resources
 */
export type BufferedHttpStorageProvider = StorageProvider & {
  /**
   * Upload all buffered entries to the HTTP backend.
   *
   * Performs a full sync cycle: collect buffered entries → topological sort
   * (children first) → batch checkMany → claim unowned / put missing nodes.
   *
   * Safe to call concurrently — subsequent calls wait for the active flush.
   */
  flush(): Promise<void>;
  /** Clean up internal resources. */
  dispose(): void;
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
export const topoSortLevels = (
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
// Concurrency Limiter
// ============================================================================

/**
 * Run async tasks with bounded concurrency (like p-limit).
 * Returns PromiseSettledResult[] matching the input order.
 */
async function mapSettledConcurrent<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      try {
        const value = await fn(items[i]!);
        results[i] = { status: "fulfilled", value };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a buffered HTTP StorageProvider that defers uploads.
 *
 * `put()` buffers entries locally (no network). Call `flush()` to upload
 * all buffered entries in topological order via batch checkMany + claim/put.
 *
 * @param http — underlying HttpStorageProvider (with checkMany + claim)
 * @param config — child key extractor and lifecycle callbacks
 */
export const createBufferedHttpStorage = (
  http: HttpStorageProvider,
  config: BufferedHttpStorageConfig
): BufferedHttpStorageProvider => {
  const { getChildKeys, onSyncStart, onSyncEnd, onKeySync } = config;
  const maxConcurrency = config.maxConcurrency ?? 8;

  /** Buffered entries awaiting flush */
  const buffer = new Map<string, Uint8Array>();

  /** Active flush promise (for coalescing concurrent flush calls) */
  let activeFlush: Promise<void> | null = null;

  const doFlush = async (): Promise<void> => {
    const entries = [...buffer.entries()].map(([key, value]) => ({ key, value }));
    buffer.clear();
    if (entries.length === 0) {
      onSyncEnd?.({ synced: [], skipped: [], failed: [] });
      return;
    }

    await onSyncStart?.();

    const synced: string[] = [];
    const skipped: string[] = [];
    const failed: Array<{ key: string; error: unknown }> = [];

    try {
      // ── Phase 1: Batch check all entries ──
      const allKeys = entries.map((e) => e.key);
      let statusMap: Map<string, "owned" | "unowned" | "missing">;

      const checkResult: CheckManyResult = await http.checkMany(allKeys);
      statusMap = new Map<string, "owned" | "unowned" | "missing">();
      for (const k of checkResult.owned) statusMap.set(k, "owned");
      for (const k of checkResult.unowned) statusMap.set(k, "unowned");
      for (const k of checkResult.missing) statusMap.set(k, "missing");

      // Filter out already-owned entries
      const toProcess: Array<{ key: string; value: Uint8Array }> = [];
      const toClaimKeys = new Set<string>();

      for (const entry of entries) {
        const status = statusMap.get(entry.key) ?? "missing";
        if (status === "owned") {
          skipped.push(entry.key);
          continue;
        }
        if (status === "unowned") {
          toClaimKeys.add(entry.key);
        }
        toProcess.push(entry);
      }

      if (toProcess.length === 0) return;

      // ── Phase 2: Topological sort + upload/claim ──
      const levels = topoSortLevels(toProcess, getChildKeys);

      for (const level of levels) {
        // Phase A: claim unowned entries (concurrency-limited)
        const claimEntries = level.filter((e) => toClaimKeys.has(e.key));
        if (claimEntries.length > 0) {
          const results = await mapSettledConcurrent(
            claimEntries,
            async (entry) => {
              onKeySync?.(entry.key, "uploading");
              try {
                await http.claim(entry.key, entry.value);
                onKeySync?.(entry.key, "done");
                return entry.key;
              } catch (err) {
                onKeySync?.(entry.key, "error", err);
                throw err;
              }
            },
            maxConcurrency
          );
          for (const [i, result] of results.entries()) {
            if (result.status === "fulfilled") {
              synced.push(result.value);
            } else {
              failed.push({ key: claimEntries[i]!.key, error: result.reason });
            }
          }
        }

        // Phase B: put missing entries (concurrency-limited)
        const putEntries = level.filter((e) => !toClaimKeys.has(e.key));
        if (putEntries.length > 0) {
          const results = await mapSettledConcurrent(
            putEntries,
            async (entry) => {
              onKeySync?.(entry.key, "uploading");
              try {
                await http.put(entry.key, entry.value);
                onKeySync?.(entry.key, "done");
                return entry.key;
              } catch (err) {
                onKeySync?.(entry.key, "error", err);
                throw err;
              }
            },
            maxConcurrency
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
      // Re-add failed entries to the buffer so they can be retried on next flush
      if (failed.length > 0) {
        const failedKeys = new Set(failed.map((f) => f.key));
        for (const entry of entries) {
          if (failedKeys.has(entry.key) && !buffer.has(entry.key)) {
            buffer.set(entry.key, entry.value);
          }
        }
      }
      onSyncEnd?.({ synced, skipped, failed });
    }

    if (failed.length > 0) {
      throw new Error(
        `flush: failed to sync ${failed.length} nodes: ${failed
          .slice(0, 5)
          .map((f) => f.key)
          .join(", ")}`
      );
    }
  };

  return {
    get(key: string): Promise<Uint8Array | null> {
      // Check buffer first (for recently-put entries not yet flushed)
      const buffered = buffer.get(key);
      if (buffered) return Promise.resolve(buffered);
      return http.get(key);
    },

    async put(key: string, value: Uint8Array): Promise<void> {
      buffer.set(key, value);
    },

    async flush(): Promise<void> {
      // Coalesce concurrent flush calls
      if (activeFlush) {
        await activeFlush;
        return;
      }
      try {
        activeFlush = doFlush();
        await activeFlush;
      } finally {
        activeFlush = null;
      }
    },

    dispose(): void {
      buffer.clear();
    },
  };
};
