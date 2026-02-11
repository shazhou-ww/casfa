/**
 * CAS StorageProvider + HashProvider for the frontend.
 *
 * - StorageProvider: IndexedDB (local cache) + HTTP (remote backend) via CachedStorage.
 *   CAS nodes are immutable — once cached in IndexedDB, they never need
 *   invalidation. This dramatically reduces HTTP requests when browsing
 *   directories (parent/sibling nodes are served from cache on repeat visits).
 *
 * - HashProvider: BLAKE3s-128 via @noble/hashes (pure JS, browser-compatible).
 *   Required for write operations (mkdir, write, rm, mv) which encode new
 *   CAS nodes locally before pushing them to the server.
 */

import type { HashProvider, StorageProvider } from "@casfa/core";
import { createHttpStorage } from "@casfa/storage-http";
import { createCachedStorage, createIndexedDBStorage } from "@casfa/storage-indexeddb";
import { blake3 } from "@noble/hashes/blake3";
import { getClient } from "./client.ts";

// ============================================================================
// HashProvider — BLAKE3s-128 (browser-compatible)
// ============================================================================

const hashProvider: HashProvider = {
  hash: async (data: Uint8Array) => blake3(data, { dkLen: 16 }),
};

/**
 * Get the BLAKE3s-128 hash provider (singleton, synchronous).
 */
export function getHashProvider(): HashProvider {
  return hashProvider;
}

// ============================================================================
// StorageProvider — CachedStorage (IndexedDB + HTTP)
// ============================================================================

let storagePromise: Promise<StorageProvider> | null = null;

/**
 * Get or initialize the cached CAS StorageProvider singleton.
 *
 * - IndexedDB: local cache with LRU eviction (50K entries ≈ 200MB)
 * - HTTP: reads individual CAS nodes via client.nodes.get()
 * - CachedStorage: cache → miss → HTTP → write-back to cache
 */
export function getStorage(): Promise<StorageProvider> {
  if (!storagePromise) {
    storagePromise = (async () => {
      const client = await getClient();

      const httpStorage = createHttpStorage({
        client,
        // getTokenBytes is only needed for smart put (PoP claims).
        // Read-only caching never calls put on the HTTP layer.
        getTokenBytes: () => null,
      });

      const indexedDBStorage = createIndexedDBStorage();

      return createCachedStorage({
        cache: indexedDBStorage,
        remote: httpStorage,
      });
    })();
  }
  return storagePromise;
}

/**
 * Reset the storage singleton (e.g., after logout).
 */
export function resetStorage(): void {
  storagePromise = null;
}
