/**
 * Cached StorageProvider — composes a local cache with a remote backend.
 *
 * - `get`: cache → miss → remote.get → cache.put → return
 * - `has`: cache → miss → remote.has
 * - `put`: cache.put → remote.put (write-through)
 *
 * CAS blocks are immutable — cache hits are always valid.
 */

import type { StorageProvider } from "@casfa/storage-core";

// ============================================================================
// Types
// ============================================================================

export type CachedStorageConfig = {
  /** Local cache (e.g., IndexedDB) */
  cache: StorageProvider;
  /** Remote backend (e.g., HTTP) */
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
