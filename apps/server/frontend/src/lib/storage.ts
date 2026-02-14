/**
 * CAS StorageProvider + KeyProvider for the frontend.
 *
 * - StorageProvider: IndexedDB (local cache) + BufferedHTTP (deferred sync)
 *   via CachedStorage. CAS nodes are immutable — once cached in IndexedDB,
 *   they never need invalidation.
 *
 *   put() writes to IndexedDB immediately AND buffers in the HTTP sync layer.
 *   Before committing a new root pointer, call flushBufferedStorage() to
 *   ensure all referenced nodes are on the remote.
 *
 * - KeyProvider: BLAKE3s-128 via @noble/hashes (pure JS, browser-compatible).
 *   Required for write operations (mkdir, write, rm, mv) which encode new
 *   CAS nodes locally before pushing them to the server.
 */

import type { KeyProvider } from "@casfa/core";
import { computeSizeFlagByte, encodeCB32, validateNodeStructure } from "@casfa/core";
import type { PopContext } from "@casfa/proof";
import { createCachedStorage } from "@casfa/storage-cached";
import type { StorageProvider } from "@casfa/storage-core";
import {
  type BufferedHttpStorageProvider,
  createBufferedHttpStorage,
  createHttpStorage,
} from "@casfa/storage-http";
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
// StorageProvider — CachedStorage (IndexedDB + BufferedHTTP)
// ============================================================================

/** Module-level reference to the buffered HTTP layer (for flush/dispose) */
let bufferedHttp: BufferedHttpStorageProvider | null = null;

let storagePromise: Promise<StorageProvider> | null = null;

/**
 * Get or initialize the cached CAS StorageProvider singleton.
 *
 * - IndexedDB: local cache (CAS immutable — no invalidation needed)
 * - BufferedHTTP: deferred sync — put() buffers, flush() uploads
 * - CachedStorage: write-through — put() writes to IndexedDB + buffer
 */
export function getStorage(): Promise<StorageProvider> {
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

      bufferedHttp = createBufferedHttpStorage(httpStorage, {
        getChildKeys,
        onSyncStart: async () => {
          clearSyncLogInternal();
          // Refresh token bytes before each sync cycle
          const at = await client.getAccessToken();
          cachedTokenBytes = at?.tokenBytes ?? null;
          setSyncing(true);
        },
        onSyncEnd: () => {
          setSyncing(false);
        },
        onKeySync: handleKeySync,
      });

      return createCachedStorage(indexedDBStorage, bufferedHttp);
    })();
  }
  return storagePromise;
}

/**
 * Flush all buffered CAS nodes to the remote backend.
 * Ensures all nodes referenced by a new root are uploaded before committing.
 */
export async function flushBufferedStorage(): Promise<void> {
  await getStorage(); // ensure initialized
  await bufferedHttp?.flush();
}

/**
 * @deprecated Use flushBufferedStorage() instead.
 */
export async function flushStorage(): Promise<void> {
  await flushBufferedStorage();
}

/**
 * Reset the storage singleton (e.g., after logout).
 * Layer 2 (depot commits) is handled by AppClient.dispose/logout.
 */
export async function resetStorage(): Promise<void> {
  if (bufferedHttp) {
    bufferedHttp.dispose();
    bufferedHttp = null;
  }
  storagePromise = null;
}
