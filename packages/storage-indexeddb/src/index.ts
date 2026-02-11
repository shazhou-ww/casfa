/**
 * @casfa/storage-indexeddb
 *
 * IndexedDB-backed StorageProvider for CAS (browser caching).
 */

export {
  type CachedStorageConfig,
  type CachedStorageProvider,
  createCachedStorage,
  type SyncResult,
  type WriteBackConfig,
} from "./cached-storage.ts";
export {
  createIndexedDBStorage,
  type IndexedDBStorageConfig,
} from "./indexeddb-storage.ts";
