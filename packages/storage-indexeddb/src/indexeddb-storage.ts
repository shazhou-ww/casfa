/**
 * IndexedDB-backed StorageProvider for CAS
 *
 * Stores raw CAS node bytes keyed by CB32 storage key.
 * CAS content is immutable — cache never needs invalidation.
 * LRU eviction is based on `lastAccessed` timestamp to respect
 * browser storage quotas.
 *
 * Uses the raw IndexedDB API (no external dependencies).
 */

import type { StorageProvider } from "@casfa/storage-core";
import type { PendingKeyStore } from "@casfa/storage-cached";

// ============================================================================
// Types
// ============================================================================

export type IndexedDBStorageConfig = {
  /** IndexedDB database name (default: "casfa-cas-cache") */
  dbName?: string;
  /** Object store name (default: "blocks") */
  storeName?: string;
  /**
   * Maximum number of entries before LRU eviction runs.
   * Default: 50_000 (~200MB assuming 4KB avg node size).
   */
  maxEntries?: number;
  /**
   * Number of oldest entries to evict when maxEntries is exceeded.
   * Default: 1000
   */
  evictionBatchSize?: number;
  /**
   * Eviction filter: return true to allow eviction, false to skip.
   * Used to protect pending-sync keys from being evicted.
   */
  evictionFilter?: (key: string) => boolean;
};

/** Internal record stored in IndexedDB */
type CacheRecord = {
  /** CB32 storage key */
  key: string;
  /** Raw CAS node bytes */
  data: Uint8Array;
  /** Timestamp for LRU eviction */
  lastAccessed: number;
};

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_DB_NAME = "casfa-cas-cache";
const DEFAULT_STORE_NAME = "blocks";
const DEFAULT_PENDING_STORE_NAME = "pending-sync";
const DEFAULT_MAX_ENTRIES = 50_000;
const DEFAULT_EVICTION_BATCH = 1000;
const DB_VERSION = 2; // v2: added pending-sync store

// ============================================================================
// Factory
// ============================================================================

/**
 * Create an IndexedDB-backed StorageProvider.
 *
 * The provider lazily opens the database on first access.
 * CAS blocks are immutable — once stored, they never change.
 */
export const createIndexedDBStorage = (
  config: IndexedDBStorageConfig = {}
): StorageProvider & { clear: () => Promise<void> } => {
  const dbName = config.dbName ?? DEFAULT_DB_NAME;
  const storeName = config.storeName ?? DEFAULT_STORE_NAME;
  const maxEntries = config.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const evictionBatchSize = config.evictionBatchSize ?? DEFAULT_EVICTION_BATCH;
  const evictionFilter = config.evictionFilter;

  let dbPromise: Promise<IDBDatabase> | null = null;
  let entryCount = -1; // lazy-loaded

  const openDB = (): Promise<IDBDatabase> => {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(dbName, DB_VERSION);
      request.onupgradeneeded = (event) => {
        const db = request.result;
        // v1: blocks store
        if (!db.objectStoreNames.contains(storeName)) {
          const store = db.createObjectStore(storeName, { keyPath: "key" });
          store.createIndex("lastAccessed", "lastAccessed", { unique: false });
        }
        // v2: pending-sync store
        if (!db.objectStoreNames.contains(DEFAULT_PENDING_STORE_NAME)) {
          db.createObjectStore(DEFAULT_PENDING_STORE_NAME, { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return dbPromise;
  };

  const getStore = async (mode: IDBTransactionMode): Promise<IDBObjectStore> => {
    const db = await openDB();
    const tx = db.transaction(storeName, mode);
    return tx.objectStore(storeName);
  };

  /** Wrap an IDBRequest in a Promise */
  const wrap = <T>(request: IDBRequest<T>): Promise<T> => {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  };

  /** Evict oldest entries when over limit */
  const maybeEvict = async (): Promise<void> => {
    if (entryCount < maxEntries) return;

    const db = await openDB();
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const index = store.index("lastAccessed");

    // Open cursor sorted by lastAccessed (ascending = oldest first)
    let evicted = 0;
    const request = index.openCursor();

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || evicted >= evictionBatchSize) {
          entryCount -= evicted;
          resolve();
          return;
        }
        const key = (cursor.value as CacheRecord).key;
        if (evictionFilter && !evictionFilter(key)) {
          // Skip protected keys (e.g., pending-sync)
          cursor.continue();
          return;
        }
        cursor.delete();
        evicted++;
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
  };

  return {
    async get(key: string): Promise<Uint8Array | null> {
      const store = await getStore("readwrite");
      const record = (await wrap(store.get(key))) as CacheRecord | undefined;
      if (!record) return null;

      // Update lastAccessed (fire-and-forget — don't block on it)
      record.lastAccessed = Date.now();
      store.put(record);

      return record.data;
    },

    async has(key: string): Promise<boolean> {
      const store = await getStore("readonly");
      const count = await wrap(store.count(key));
      return count > 0;
    },

    async put(key: string, value: Uint8Array): Promise<void> {
      const store = await getStore("readwrite");

      // Check if already cached (CAS immutable — skip if exists)
      const existing = await wrap(store.count(key));
      if (existing > 0) return;

      const record: CacheRecord = {
        key,
        data: value,
        lastAccessed: Date.now(),
      };
      await wrap(store.put(record));

      if (entryCount >= 0) {
        entryCount++;
      } else {
        // Lazy-load entry count
        const countStore = await getStore("readonly");
        entryCount = await wrap(countStore.count());
      }

      await maybeEvict();
    },

    /** Clear all cached blocks */
    async clear(): Promise<void> {
      const store = await getStore("readwrite");
      await wrap(store.clear());
      entryCount = 0;
    },
  };
};

// ============================================================================
// PendingKeyStore — IndexedDB-backed persistence for pending sync keys
// ============================================================================

/**
 * Create a PendingKeyStore backed by the `pending-sync` object store.
 *
 * Shares the same IndexedDB database as the CAS block cache.
 * Used by CachedStorage (Layer 1) to persist pending keys across page reloads.
 */
export const createPendingKeyStore = (
  config: { dbName?: string } = {}
): PendingKeyStore => {
  const dbName = config.dbName ?? DEFAULT_DB_NAME;
  const pendingStoreName = DEFAULT_PENDING_STORE_NAME;

  let dbPromise: Promise<IDBDatabase> | null = null;

  const openDB = (): Promise<IDBDatabase> => {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(dbName, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(DEFAULT_STORE_NAME)) {
          const store = db.createObjectStore(DEFAULT_STORE_NAME, { keyPath: "key" });
          store.createIndex("lastAccessed", "lastAccessed", { unique: false });
        }
        if (!db.objectStoreNames.contains(pendingStoreName)) {
          db.createObjectStore(pendingStoreName, { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return dbPromise;
  };

  const wrap = <T>(request: IDBRequest<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

  const txComplete = (tx: IDBTransaction): Promise<void> =>
    new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

  return {
    async load(): Promise<string[]> {
      const db = await openDB();
      const tx = db.transaction(pendingStoreName, "readonly");
      const store = tx.objectStore(pendingStoreName);
      const records = await wrap(store.getAll());
      return (records as Array<{ key: string }>).map((r) => r.key);
    },

    async add(keys: string[]): Promise<void> {
      if (keys.length === 0) return;
      const db = await openDB();
      const tx = db.transaction(pendingStoreName, "readwrite");
      const store = tx.objectStore(pendingStoreName);
      for (const key of keys) {
        store.put({ key });
      }
      await txComplete(tx);
    },

    async remove(keys: string[]): Promise<void> {
      if (keys.length === 0) return;
      const db = await openDB();
      const tx = db.transaction(pendingStoreName, "readwrite");
      const store = tx.objectStore(pendingStoreName);
      for (const key of keys) {
        store.delete(key);
      }
      await txComplete(tx);
    },
  };
};
