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
const DEFAULT_MAX_ENTRIES = 50_000;
const DEFAULT_EVICTION_BATCH = 1000;

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

  let dbPromise: Promise<IDBDatabase> | null = null;
  let entryCount = -1; // lazy-loaded

  const openDB = (): Promise<IDBDatabase> => {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(storeName)) {
          const store = db.createObjectStore(storeName, { keyPath: "key" });
          store.createIndex("lastAccessed", "lastAccessed", { unique: false });
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
