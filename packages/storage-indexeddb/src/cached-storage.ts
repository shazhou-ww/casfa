/**
 * Re-export from @casfa/storage-cached.
 *
 * The generic cached storage implementation has been extracted to a
 * standalone package so it can be used with any cache/remote pair
 * (IndexedDB + HTTP, FS + HTTP, Memory + FS, etc.).
 *
 * This re-export preserves backward compatibility for existing
 * consumers of @casfa/storage-indexeddb.
 */

export { type CachedStorageConfig, createCachedStorage } from "@casfa/storage-cached";
