/**
 * @casfa/client-sw — IndexedDB token storage
 *
 * Provides a TokenStorageProvider backed by IndexedDB for use in the
 * Service Worker. Persists TokenState across SW restarts.
 *
 * DB: "casfa-auth", store: "tokens"
 * Connection is pooled for the SW lifetime.
 */

import type { TokenState, TokenStorageProvider } from "@casfa/client";

const DB_NAME = "casfa-auth";
const DB_VERSION = 1;
const STORE_NAME = "tokens";

// ── Connection pool (single IDBDatabase for the SW lifetime) ──

let dbCache: IDBDatabase | null = null;

function getDB(): Promise<IDBDatabase> {
  if (dbCache) return Promise.resolve(dbCache);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => {
      dbCache = request.result;
      // Browser may close idle connections
      dbCache.onclose = () => {
        dbCache = null;
      };
      resolve(dbCache);
    };

    request.onerror = () => reject(request.error);
  });
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Create an IndexedDB-backed TokenStorageProvider.
 *
 * @param key - The IDB key for storing the token state (typically "root").
 */
export function createIndexedDBTokenStorage(
  key: string,
): TokenStorageProvider {
  return {
    async load(): Promise<TokenState | null> {
      const db = await getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
      });
    },

    async save(state: TokenState): Promise<void> {
      const db = await getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const request = store.put(state, key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    },

    async clear(): Promise<void> {
      const db = await getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const request = store.delete(key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    },
  };
}
