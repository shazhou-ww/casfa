/**
 * @casfa/storage-indexeddb
 *
 * IndexedDB-backed StorageProvider for CAS (browser caching).
 */

export {
  createIndexedDBStorage,
  createPendingKeyStore,
  type IndexedDBStorageConfig,
  type PendingKeyStore,
} from "./indexeddb-storage.ts";
