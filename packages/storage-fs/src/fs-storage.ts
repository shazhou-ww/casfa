/**
 * File System Storage Provider for CAS
 *
 * Implements StorageProvider with:
 * - LRU cache for key existence checks
 * - Local file system backend storage
 * - Automatic directory creation
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { StorageProvider } from "@casfa/storage-core";
import { createLRUCache, DEFAULT_CACHE_SIZE, toStoragePath } from "./storage-utils.ts";

/**
 * File System Storage configuration
 */
export type FsStorageConfig = {
  /** Base directory for storage */
  basePath: string;
  /** LRU cache size for key existence (default: 10000) */
  cacheSize?: number;
  /** Key prefix in storage (default: "cas/blake3s/") */
  prefix?: string;
};

/**
 * Create a file system-backed storage provider
 */
export const createFsStorage = (config: FsStorageConfig): StorageProvider => {
  const basePath = config.basePath;
  const prefix = config.prefix ?? "cas/blake3s/";
  const existsCache = createLRUCache<string, boolean>(config.cacheSize ?? DEFAULT_CACHE_SIZE);

  // Ensure base directory exists
  if (!existsSync(basePath)) {
    mkdirSync(basePath, { recursive: true });
  }

  const toFilePath = (casKey: string): string => {
    const storagePath = toStoragePath(casKey, prefix);
    return join(basePath, storagePath);
  };

  const has = async (key: string): Promise<boolean> => {
    // Check cache first
    const cached = existsCache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    // Check file system
    const filePath = toFilePath(key);
    const exists = existsSync(filePath);

    if (exists) {
      existsCache.set(key, true);
    }
    // Don't cache non-existence (it might be written later)

    return exists;
  };

  const get = async (key: string): Promise<Uint8Array | null> => {
    const filePath = toFilePath(key);

    try {
      const buffer = readFileSync(filePath);
      // Mark as existing in cache
      existsCache.set(key, true);
      return new Uint8Array(buffer);
    } catch (error: unknown) {
      const err = error as { code?: string };
      if (err.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  };

  const put = async (key: string, value: Uint8Array): Promise<void> => {
    // Check cache first (avoid redundant writes)
    if (existsCache.get(key)) {
      return;
    }

    // Check if already exists
    const exists = await has(key);
    if (exists) {
      return;
    }

    const filePath = toFilePath(key);
    const dir = dirname(filePath);

    // Ensure directory exists
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Write file
    writeFileSync(filePath, value);

    // Mark as existing
    existsCache.set(key, true);
  };

  return { has, get, put };
};

/**
 * Create file system storage with cache control methods (for testing)
 */
export const createFsStorageWithCache = (config: FsStorageConfig) => {
  const existsCache = createLRUCache<string, boolean>(config.cacheSize ?? DEFAULT_CACHE_SIZE);

  const storage = createFsStorage(config);

  return {
    ...storage,
    clearCache: () => existsCache.clear(),
    getCacheStats: () => ({ size: existsCache.size() }),
  };
};
