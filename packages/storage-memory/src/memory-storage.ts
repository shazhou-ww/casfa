/**
 * In-Memory Storage Provider for CAS
 *
 * Useful for testing and local development.
 */

import type { StorageProvider } from "@casfa/storage-core";

/**
 * Memory Storage configuration
 */
export type MemoryStorageConfig = {
  /** Optional initial data */
  initialData?: Map<string, Uint8Array>;
};

/**
 * Create an in-memory storage provider
 */
export const createMemoryStorage = (config: MemoryStorageConfig = {}): StorageProvider => {
  const data = config.initialData ?? new Map<string, Uint8Array>();

  return {
    get: async (key) => data.get(key) ?? null,
    put: async (key, value) => {
      data.set(key, value);
    },
  };
};

/**
 * Create memory storage with inspection methods (for testing)
 */
export const createMemoryStorageWithInspection = (config: MemoryStorageConfig = {}) => {
  const data = config.initialData ?? new Map<string, Uint8Array>();

  const storage: StorageProvider = {
    get: async (key) => data.get(key) ?? null,
    put: async (key, value) => {
      data.set(key, value);
    },
  };

  return {
    ...storage,
    /** Clear all stored data */
    clear: () => data.clear(),
    /** Get number of stored items */
    size: () => data.size,
    /** Get all stored keys */
    keys: () => Array.from(data.keys()),
    /** Delete a specific key */
    delete: (key: string) => data.delete(key),
    /** Get raw data map (for inspection) */
    getData: () => data,
  };
};
