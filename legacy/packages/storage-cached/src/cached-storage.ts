/**
 * Cached StorageProvider — composes a local cache with a remote backend.
 *
 * CAS blocks are immutable, so cache entries never need invalidation.
 *
 * Read path:
 *   cache.get → hit? return : remote.get → write-back to cache → return
 *
 * Write path:
 *   cache.put → remote.put (write-through to both layers)
 *
 * Typical pairings:
 *   - IndexedDB  + BufferedHTTP (browser — instant reads, deferred sync)
 *   - Memory     + FS           (warm process cache over disk)
 *   - Memory     + HTTP         (short-lived scripts)
 *
 * @packageDocumentation
 */

import type { StorageProvider } from "@casfa/storage-core";

/**
 * Create a cached StorageProvider that layers a local cache over a remote backend.
 *
 * Read path: cache → remote → write-back to cache.
 * Write path: write-through — cache.put then remote.put.
 */
export const createCachedStorage = (
  cache: StorageProvider,
  remote: StorageProvider
): StorageProvider => ({
  async get(key: string): Promise<Uint8Array | null> {
    const cached = await cache.get(key);
    if (cached) return cached;

    const data = await remote.get(key);
    if (data) {
      cache.put(key, data).catch(() => {
        // Silently ignore cache write failures
      });
    }
    return data;
  },

  async put(key: string, value: Uint8Array): Promise<void> {
    await cache.put(key, value);
    await remote.put(key, value);
  },

  async del(key: string): Promise<void> {
    await cache.del(key);
    await remote.del(key);
  },
});
