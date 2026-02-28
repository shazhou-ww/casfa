/**
 * File System Storage Provider for CAS
 *
 * Implements StorageProvider with:
 * - Local file system backend storage
 * - Automatic directory creation
 * - Internal existence check in put() to avoid redundant writes
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { StorageProvider } from "@casfa/storage-core";

/**
 * Create storage path from a CB32 storage key.
 * Uses first 2 chars as subdirectory for better distribution.
 *
 * Example: 240B5PHBGEC2A705WTKKMVRS30 -> cas/v1/24/240B5PHBGEC2A705WTKKMVRS30
 */
const toStoragePath = (key: string, prefix: string): string => {
  const subdir = key.slice(0, 2);
  return `${prefix}${subdir}/${key}`;
};

/**
 * File System Storage configuration
 */
export type FsStorageConfig = {
  /** Base directory for storage */
  basePath: string;
  /** Key prefix in storage (default: "cas/v1/") */
  prefix?: string;
};

/**
 * Create a file system-backed storage provider
 */
export const createFsStorage = (config: FsStorageConfig): StorageProvider => {
  const basePath = config.basePath;
  const prefix = config.prefix ?? "cas/v1/";

  const toFilePath = (casKey: string): string => {
    const storagePath = toStoragePath(casKey, prefix);
    return join(basePath, storagePath);
  };

  const get = async (key: string): Promise<Uint8Array | null> => {
    const filePath = toFilePath(key);

    try {
      const buffer = readFileSync(filePath);
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
    const filePath = toFilePath(key);

    // Internal optimization: stat is cheaper than write for existing files
    try {
      await stat(filePath);
      return; // already exists
    } catch {
      // doesn't exist, proceed to write
    }

    const dir = dirname(filePath);

    // Ensure directory exists
    mkdirSync(dir, { recursive: true });

    // Write file
    writeFileSync(filePath, value);
  };

  const del = async (key: string): Promise<void> => {
    const filePath = toFilePath(key);
    try {
      await unlink(filePath);
    } catch (error: unknown) {
      const err = error as { code?: string };
      if (err.code !== "ENOENT") throw error;
    }
  };

  return { get, put, del };
};
