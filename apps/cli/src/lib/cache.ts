import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfig, resolvePath } from "./config";

export function getCachePath(): string {
  const config = loadConfig();
  return resolvePath(config.cache.path);
}

export function ensureCacheDir(): void {
  const cachePath = getCachePath();
  if (!fs.existsSync(cachePath)) {
    fs.mkdirSync(cachePath, { recursive: true });
  }
}

export function getCachedNodePath(key: string): string {
  // key format: "nod_XXXX..." -> store as XXXX...
  const nodeId = key.startsWith("nod_") ? key.slice(4) : key;
  const cachePath = getCachePath();
  // Use first 2 chars as subdirectory for better filesystem performance
  const subdir = nodeId.slice(0, 2);
  return path.join(cachePath, subdir, nodeId);
}

export function hasCachedNode(key: string): boolean {
  const config = loadConfig();
  if (!config.cache.enabled) {
    return false;
  }
  const nodePath = getCachedNodePath(key);
  return fs.existsSync(nodePath);
}

export function getCachedNode(key: string): Buffer | null {
  const config = loadConfig();
  if (!config.cache.enabled) {
    return null;
  }
  const nodePath = getCachedNodePath(key);
  if (!fs.existsSync(nodePath)) {
    return null;
  }
  try {
    return fs.readFileSync(nodePath);
  } catch {
    return null;
  }
}

export function setCachedNode(key: string, data: Buffer): void {
  const config = loadConfig();
  if (!config.cache.enabled) {
    return;
  }
  const nodePath = getCachedNodePath(key);
  const dir = path.dirname(nodePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(nodePath, data);
}

export interface CacheStats {
  totalFiles: number;
  totalSize: number;
  path: string;
}

export function getCacheStats(): CacheStats {
  const cachePath = getCachePath();
  let totalFiles = 0;
  let totalSize = 0;

  if (!fs.existsSync(cachePath)) {
    return { totalFiles: 0, totalSize: 0, path: cachePath };
  }

  function walkDir(dir: string): void {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkDir(fullPath);
        } else if (entry.isFile()) {
          totalFiles++;
          try {
            const stat = fs.statSync(fullPath);
            totalSize += stat.size;
          } catch {
            // Ignore stat errors
          }
        }
      }
    } catch {
      // Ignore read errors
    }
  }

  walkDir(cachePath);
  return { totalFiles, totalSize, path: cachePath };
}

export function clearCache(): number {
  const cachePath = getCachePath();
  let deletedCount = 0;

  if (!fs.existsSync(cachePath)) {
    return 0;
  }

  function deleteDir(dir: string): void {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          deleteDir(fullPath);
          try {
            fs.rmdirSync(fullPath);
          } catch {
            // Ignore
          }
        } else if (entry.isFile()) {
          try {
            fs.unlinkSync(fullPath);
            deletedCount++;
          } catch {
            // Ignore
          }
        }
      }
    } catch {
      // Ignore
    }
  }

  deleteDir(cachePath);
  return deletedCount;
}

export function parseSize(sizeStr: string): number {
  const match = sizeStr.match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB)?$/i);
  if (!match || !match[1]) {
    throw new Error(`Invalid size format: ${sizeStr}`);
  }
  const value = parseFloat(match[1]);
  const unit = (match[2] || "B").toUpperCase();

  const multipliers: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024,
    TB: 1024 * 1024 * 1024 * 1024,
  };

  return Math.floor(value * (multipliers[unit] || 1));
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
