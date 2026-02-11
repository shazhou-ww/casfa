/**
 * @casfa/storage-indexeddb
 *
 * IndexedDB-backed StorageProvider for CAS (browser caching).
 */

export {
  createIndexedDBStorage,
  type IndexedDBStorageConfig,
} from "./indexeddb-storage.ts";

export {
  createCachedStorage,
  type CachedStorageConfig,
} from "./cached-storage.ts";
