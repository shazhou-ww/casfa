/**
 * LRU Cache utilities
 *
 * Uses quick-lru for efficient LRU cache implementation.
 * This module provides a thin wrapper with CAS-specific defaults.
 */

import QuickLRU from "quick-lru";

/**
 * LRU Cache type
 */
export type LRUCache<K, V> = {
  get: (key: K) => V | undefined;
  set: (key: K, value: V) => void;
  has: (key: K) => boolean;
  delete: (key: K) => boolean;
  clear: () => void;
  size: () => number;
};

/**
 * Create an LRU cache
 *
 * @param maxSize Maximum number of items to store
 */
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

/**
 * Default cache size for key existence checks
 */
export const DEFAULT_CACHE_SIZE = 10000;
