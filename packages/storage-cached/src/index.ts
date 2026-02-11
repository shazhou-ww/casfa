/**
 * @casfa/storage-cached
 *
 * Cached StorageProvider — layers a local cache over a remote CAS backend.
 * CAS blocks are immutable, so cache entries never need invalidation.
 */

export {
  type CachedStorageConfig,
  type CachedStorageProvider,
  type CheckManyResult,
  createCachedStorage,
  type SyncResult,
  type WriteBackConfig,
} from "./cached-storage.ts";
