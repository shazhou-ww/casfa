/**
 * CAS StorageProvider + KeyProvider for the frontend.
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
 * - KeyProvider: BLAKE3s-128 via @noble/hashes (pure JS, browser-compatible).
 *   Required for write operations (mkdir, write, rm, mv) which encode new
 *   CAS nodes locally before pushing them to the server.
 */

import type { KeyProvider } from "@casfa/core";
import { computeSizeFlagByte, encodeCB32, validateNodeStructure } from "@casfa/core";
import type { PopContext } from "@casfa/proof";
import { type CachedStorageProvider, createCachedStorage } from "@casfa/storage-cached";
import { createHttpStorage } from "@casfa/storage-http";
import { createIndexedDBStorage } from "@casfa/storage-indexeddb";
import { blake3 } from "@noble/hashes/blake3";
import { getClient } from "./client.ts";

// ============================================================================
// KeyProvider — BLAKE3s-128 with size-flag byte (browser-compatible)
// ============================================================================

const keyProvider: KeyProvider = {
  computeKey: async (data: Uint8Array) => {
    const raw = blake3(data, { dkLen: 16 });
    raw[0] = computeSizeFlagByte(data.length);
    return raw;
  },
};

/**
 * Get the BLAKE3s-128 key provider (singleton, synchronous).
 */
export function getKeyProvider(): KeyProvider {
  return keyProvider;
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
// Sync log — per-key operation log, observable by UI
// ============================================================================

export type SyncLogEntry = {
  id: number;
  label: string;
  status: "active" | "done" | "error";
};

let syncLogId = 0;
const syncLog: SyncLogEntry[] = [];
const keyToLogId = new Map<string, number>();
const syncLogListeners = new Set<() => void>();

function notifySyncLog() {
  for (const fn of syncLogListeners) fn();
}

function clearSyncLogInternal() {
  syncLog.length = 0;
  keyToLogId.clear();
  notifySyncLog();
}

function handleKeySync(key: string, status: "uploading" | "done" | "error") {
  const short = key.length > 12 ? `${key.slice(0, 12)}…` : key;
  if (status === "uploading") {
    const id = ++syncLogId;
    keyToLogId.set(key, id);
    syncLog.push({ id, label: `put ${short}`, status: "active" });
  } else {
    const logId = keyToLogId.get(key);
    if (logId != null) {
      const entry = syncLog.find((e) => e.id === logId);
      if (entry) entry.status = status === "done" ? "done" : "error";
      keyToLogId.delete(key);
    }
  }
  notifySyncLog();
}

/**
 * Subscribe to sync log changes. Fires whenever entries are added/updated/cleared.
 */
export function onSyncLogChange(listener: () => void): () => void {
  syncLogListeners.add(listener);
  return () => syncLogListeners.delete(listener);
}

/** Get a snapshot of the current sync log. */
export function getSyncLog(): readonly SyncLogEntry[] {
  return syncLog;
}

/** Clear all sync log entries. */
export function clearSyncLog(): void {
  clearSyncLogInternal();
}

/** Push a custom entry to the sync log (e.g., "commit"). */
export function pushSyncLog(label: string, status: SyncLogEntry["status"] = "done"): number {
  const id = ++syncLogId;
  syncLog.push({ id, label, status });
  notifySyncLog();
  return id;
}

// ============================================================================
// StorageProvider — CachedStorage (IndexedDB + HTTP, write-back)
// ============================================================================

let storagePromise: Promise<CachedStorageProvider> | null = null;
let flushInProgress = false;

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

      // PoP context for claiming unowned nodes
      const popContext: PopContext = {
        blake3_256: (data: Uint8Array) => blake3(data),
        blake3_128_keyed: (data: Uint8Array, key: Uint8Array) => blake3(data, { dkLen: 16, key }),
        crockfordBase32Encode: (bytes: Uint8Array) => encodeCB32(bytes),
      };

      // Cached token bytes — refreshed lazily before each sync
      let cachedTokenBytes: Uint8Array | null = null;

      /** Extract direct child storage keys from raw CAS node bytes. */
      const getChildKeys = (bytes: Uint8Array): string[] => {
        const result = validateNodeStructure(bytes);
        return result.valid ? (result.childKeys ?? []) : [];
      };

      const httpStorage = createHttpStorage({
        client,
        getTokenBytes: () => cachedTokenBytes,
        popContext,
        getChildKeys,
      });

      const indexedDBStorage = createIndexedDBStorage();

      return createCachedStorage({
        cache: indexedDBStorage,
        remote: httpStorage,
        writeBack: {
          debounceMs: 2000,
          onSyncStart: async () => {
            if (!flushInProgress) clearSyncLogInternal();
            // Refresh token bytes before each sync cycle
            const at = await client.getAccessToken();
            cachedTokenBytes = at?.tokenBytes ?? null;
            setSyncing(true);
          },
          onSyncEnd: () => {
            if (!flushInProgress) setSyncing(false);
          },
          onKeySync: handleKeySync,
          getChildKeys,
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
  flushInProgress = true;
  setSyncing(true);
  try {
    await storage.flush();
  } finally {
    flushInProgress = false;
    setSyncing(false);
  }
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
