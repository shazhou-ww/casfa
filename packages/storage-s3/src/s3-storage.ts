/**
 * S3 Storage Provider for CAS
 *
 * Implements StorageProvider with:
 * - S3 backend storage
 * - Internal HeadObject check in put() to avoid redundant uploads
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
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
 * S3 Storage configuration
 */
export type S3StorageConfig = {
  /** S3 bucket name */
  bucket: string;
  /** AWS region for the S3 bucket (e.g. "us-west-2") */
  region?: string;
  /** Optional S3 client (for testing or custom config) */
  client?: S3Client;
  /** Key prefix in S3 (default: "cas/v1/") */
  prefix?: string;
};

/**
 * Create an S3-backed storage provider
 */
export const createS3Storage = (config: S3StorageConfig): StorageProvider => {
  const client = config.client ?? new S3Client(config.region ? { region: config.region } : {});
  const bucket = config.bucket;
  const prefix = config.prefix ?? "cas/v1/";

  const toS3Key = (casKey: string): string => toStoragePath(casKey, prefix);

  const get = async (key: string): Promise<Uint8Array | null> => {
    try {
      const result = await client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: toS3Key(key),
        })
      );

      const bytes = await result.Body!.transformToByteArray();
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
    const s3Key = toS3Key(key);

    // Internal optimization: HeadObject is cheaper than PutObject
    try {
      await client.send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: s3Key,
        })
      );
      return; // already exists
    } catch (error: unknown) {
      const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (err.name !== "NotFound" && err.$metadata?.httpStatusCode !== 404) {
        throw error; // unexpected error
      }
      // not found — proceed to upload
    }

    // Upload to S3
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: s3Key,
        Body: value,
        ContentType: "application/octet-stream",
      })
    );
  };

  const del = async (key: string): Promise<void> => {
    try {
      await client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: toS3Key(key),
        })
      );
    } catch (error: unknown) {
      const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (err.name !== "NoSuchKey" && err.$metadata?.httpStatusCode !== 404) {
        throw error;
      }
    }
  };

  return { get, put, del };
};
