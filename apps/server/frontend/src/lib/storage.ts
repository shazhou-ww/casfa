/**
 * CAS StorageProvider + HashProvider for the frontend.
 *
 * - StorageProvider: IndexedDB (local cache) + HTTP (remote backend) via CachedStorage.
 *   CAS nodes are immutable — once cached in IndexedDB, they never need
 *   invalidation. This dramatically reduces HTTP requests when browsing
 *   directories (parent/sibling nodes are served from cache on repeat visits).
 *
 *   Write-back mode: put() writes to IndexedDB immediately and returns.
 *   Pending nodes are synced to the HTTP backend in debounced batches (2s).
 *   This makes write operations (mkdir, upload, rename, rm) feel instant.
 *   Before committing a new root pointer, call flushStorage() to ensure
 *   all referenced nodes are on the remote.
 *
 * - HashProvider: BLAKE3s-128 via @noble/hashes (pure JS, browser-compatible).
 *   Required for write operations (mkdir, write, rm, mv) which encode new
 *   CAS nodes locally before pushing them to the server.
 */

import type { HashProvider } from "@casfa/core";
import type { CachedStorageProvider } from "@casfa/storage-cached";
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
// Sync status — observable by UI
// ============================================================================

type SyncStatusListener = (syncing: boolean) => void;

const syncListeners = new Set<SyncStatusListener>();
let currentSyncStatus = false;

function setSyncing(syncing: boolean) {
  if (syncing === currentSyncStatus) return;
  currentSyncStatus = syncing;
  for (const listener of syncListeners) {
    listener(syncing);
  }
}

/**
 * Subscribe to storage sync status changes.
 * Returns an unsubscribe function.
 */
export function onSyncStatusChange(listener: SyncStatusListener): () => void {
  syncListeners.add(listener);
  // Immediately notify current state
  listener(currentSyncStatus);
  return () => syncListeners.delete(listener);
}

// ============================================================================
// StorageProvider — CachedStorage (IndexedDB + HTTP, write-back)
// ============================================================================

let storagePromise: Promise<CachedStorageProvider> | null = null;

/**
 * Get or initialize the cached CAS StorageProvider singleton.
 *
 * - IndexedDB: local cache with LRU eviction (50K entries ≈ 200MB)
 * - HTTP: reads individual CAS nodes via client.nodes.get()
 * - CachedStorage: write-back mode — put() writes to IndexedDB only,
 *   then syncs to HTTP in debounced 2s batches.
 */
export function getStorage(): Promise<CachedStorageProvider> {
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
        writeBack: {
          debounceMs: 2000,
          onSyncStart: () => setSyncing(true),
          onSyncEnd: () => setSyncing(false),
        },
      });
    })();
  }
  return storagePromise;
}

/**
 * Flush all pending CAS node writes to the remote.
 * Call this before committing a new root pointer to the server.
 */
export async function flushStorage(): Promise<void> {
  if (!storagePromise) return;
  const storage = await storagePromise;
  await storage.flush();
}

/**
 * Reset the storage singleton (e.g., after logout).
 * Flushes pending writes before clearing.
 */
export async function resetStorage(): Promise<void> {
  if (storagePromise) {
    const storage = await storagePromise;
    await storage.flush();
    storage.dispose();
  }
  storagePromise = null;
}
