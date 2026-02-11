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
 * Write path (write-through):
 *   cache.put → remote.put
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

export type CachedStorageConfig = {
  /** Local cache layer (e.g., IndexedDB, FS, memory) */
  cache: StorageProvider;
  /** Remote / slower backend (e.g., HTTP, S3, FS) */
  remote: StorageProvider;
};

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a cached StorageProvider that layers a local cache over a remote backend.
 *
 * Read path: cache → remote → write-back to cache.
 * Write path: write to both cache and remote (write-through).
 */
export const createCachedStorage = (config: CachedStorageConfig): StorageProvider => {
  const { cache, remote } = config;

  return {
    async get(key: string): Promise<Uint8Array | null> {
      // Try cache first
      const cached = await cache.get(key);
      if (cached) return cached;

      // Cache miss — fetch from remote
      const data = await remote.get(key);
      if (data) {
        // Write back to cache (fire-and-forget to avoid blocking reads)
        cache.put(key, data).catch(() => {
          // Silently ignore cache write failures (e.g., quota exceeded)
        });
      }
      return data;
    },

    async has(key: string): Promise<boolean> {
      const inCache = await cache.has(key);
      if (inCache) return true;
      return remote.has(key);
    },

    async put(key: string, value: Uint8Array): Promise<void> {
      // Write to cache first (instant local availability)
      await cache.put(key, value);
      // Then write to remote (upload / check+claim)
      await remote.put(key, value);
    },
  };
};
