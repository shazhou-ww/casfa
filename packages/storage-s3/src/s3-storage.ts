/**
 * S3 Storage Provider for CAS
 *
 * Implements StorageProvider with:
 * - LRU cache for key existence checks
 * - S3 backend storage
 */

import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  createLRUCache,
  DEFAULT_CACHE_SIZE,
  type StorageProvider,
  toStoragePath,
} from "@casfa/storage-core";

/**
 * S3 Storage configuration
 */
export type S3StorageConfig = {
  /** S3 bucket name */
  bucket: string;
  /** AWS region for the S3 bucket (e.g. "us-west-2") */
  region?: string;
  /** Optional S3 client (for testing or custom config) */
  client?: S3Client;
  /** LRU cache size for key existence (default: 10000) */
  cacheSize?: number;
  /** Key prefix in S3 (default: "cas/sha256/") */
  prefix?: string;
};

/**
 * Create an S3-backed storage provider
 */
export const createS3Storage = (config: S3StorageConfig): StorageProvider => {
  const client = config.client ?? new S3Client(config.region ? { region: config.region } : {});
  const bucket = config.bucket;
  const prefix = config.prefix ?? "cas/sha256/";
  const existsCache = createLRUCache<string, boolean>(config.cacheSize ?? DEFAULT_CACHE_SIZE);

  const toS3Key = (casKey: string): string => toStoragePath(casKey, prefix);

  const has = async (key: string): Promise<boolean> => {
    // Check cache first
    const cached = existsCache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    // Check S3
    try {
      await client.send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: toS3Key(key),
        })
      );
      existsCache.set(key, true);
      return true;
    } catch (error: unknown) {
      const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
        // Don't cache non-existence (it might be uploaded later)
        return false;
      }
      throw error;
    }
  };

  const get = async (key: string): Promise<Uint8Array | null> => {
    try {
      const result = await client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: toS3Key(key),
        })
      );

      const bytes = await result.Body!.transformToByteArray();

      // Mark as existing in cache
      existsCache.set(key, true);

      return new Uint8Array(bytes);
    } catch (error: unknown) {
      const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
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

    // Check if already exists in S3
    const exists = await has(key);
    if (exists) {
      return;
    }

    // Upload to S3
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: toS3Key(key),
        Body: value,
        ContentType: "application/octet-stream",
      })
    );

    // Mark as existing
    existsCache.set(key, true);
  };

  return { has, get, put };
};

/**
 * Create S3 storage with cache control methods (for testing)
 */
export const createS3StorageWithCache = (config: S3StorageConfig) => {
  const client = config.client ?? new S3Client(config.region ? { region: config.region } : {});
  const _bucket = config.bucket;
  const prefix = config.prefix ?? "cas/sha256/";
  const existsCache = createLRUCache<string, boolean>(config.cacheSize ?? DEFAULT_CACHE_SIZE);

  const _toS3Key = (casKey: string): string => toStoragePath(casKey, prefix);

  const storage = createS3Storage({ ...config, client });

  return {
    ...storage,
    clearCache: () => existsCache.clear(),
    getCacheStats: () => ({ size: existsCache.size() }),
  };
};
