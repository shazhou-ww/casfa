/**
 * CAS Storage Core
 *
 * Core types and utilities for CAS storage providers.
 */

// Key utilities
export {
  bytesToHex,
  extractHash,
  hexToBytes,
  isValidKey,
  toKey,
  toStoragePath,
} from "./key.ts";
// LRU Cache
export { createLRUCache, DEFAULT_CACHE_SIZE, type LRUCache } from "./lru-cache.ts";
// Types
export type { HashProvider, StorageConfig, StorageProvider } from "./types.ts";
