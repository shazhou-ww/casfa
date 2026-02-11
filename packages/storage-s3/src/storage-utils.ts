/**
 * Storage utilities — LRU cache and path helpers.
 *
 * These are internal to the S3 storage provider.
 */

import QuickLRU from "quick-lru";

// ============================================================================
// LRU Cache
// ============================================================================

export type LRUCache<K, V> = {
  get: (key: K) => V | undefined;
  set: (key: K, value: V) => void;
  has: (key: K) => boolean;
  delete: (key: K) => boolean;
  clear: () => void;
  size: () => number;
};

export const DEFAULT_CACHE_SIZE = 10000;

export const createLRUCache = <K, V>(maxSize: number): LRUCache<K, V> => {
  const cache = new QuickLRU<K, V>({ maxSize });
  return {
    get: (key) => cache.get(key),
    set: (key, value) => {
      cache.set(key, value);
    },
    has: (key) => cache.has(key),
    delete: (key) => cache.delete(key),
    clear: () => cache.clear(),
    size: () => cache.size,
  };
};

// ============================================================================
// Path helpers
// ============================================================================

/**
 * Create storage path from a CB32 storage key.
 * Uses first 2 chars as subdirectory for better distribution.
 *
 * Example: 240B5PHBGEC2A705WTKKMVRS30 -> cas/v1/24/240B5PHBGEC2A705WTKKMVRS30
 */
export const toStoragePath = (key: string, prefix = "cas/v1/"): string => {
  const subdir = key.slice(0, 2);
  return `${prefix}${subdir}/${key}`;
};
