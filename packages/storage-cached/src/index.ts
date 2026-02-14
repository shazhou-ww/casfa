/**
 * @casfa/storage-cached
 *
 * Cached StorageProvider — layers a local cache over a remote CAS backend.
 * CAS blocks are immutable, so cache entries never need invalidation.
 */

export { createCachedStorage } from "./cached-storage.ts";
