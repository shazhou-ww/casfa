/**
 * @casfa/storage-indexeddb
 *
 * IndexedDB-backed StorageProvider for CAS (browser caching).
 */

export {
  createIndexedDBStorage,
  createPendingKeyStore,
  type IndexedDBStorageConfig,
} from "./indexeddb-storage.ts";
