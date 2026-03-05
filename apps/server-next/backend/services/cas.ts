/**
 * CAS facade: S3 in Lambda/server (ServerConfig); optional fs/memory for tests.
 * For local dev use S3_ENDPOINT; cell-cli starts MinIO with minioadmin/minioadmin.
 */

import { S3Client } from "@aws-sdk/client-s3";
import type { CasFacade } from "@casfa/cas";
import { createCasFacade as createCasFacadeImpl, createCasStorageFromBuffer } from "@casfa/cas";
import type { KeyProvider } from "@casfa/core";
import { computeSizeFlagByte } from "@casfa/core";
import { createFsStorage } from "@casfa/storage-fs";
import { createMemoryStorage } from "@casfa/storage-memory";
import { createS3Storage } from "@casfa/storage-s3";
import type { ServerConfig } from "../config.ts";

/** Config that may include optional storage (fs/memory) for tests; ServerConfig has only S3. */
export type CasFacadeConfig = ServerConfig & {
  storage?: { type: "fs"; fsPath?: string } | { type?: "memory" };
};

function createKeyProvider(): KeyProvider {
  return {
    computeKey: async (data: Uint8Array) => {
      const { blake3 } = await import("@noble/hashes/blake3");
      const raw = blake3(data, { dkLen: 16 });
      raw[0] = computeSizeFlagByte(data.length);
      return raw;
    },
  };
}

export type CasFacadeResult = {
  cas: CasFacade;
  key: KeyProvider;
};

function createStorageFromConfig(
  config: CasFacadeConfig
): ReturnType<typeof createCasStorageFromBuffer> {
  if (config.storage?.type === "fs") {
    const storageProvider = createFsStorage({ basePath: config.storage?.fsPath ?? "./data" });
    return createCasStorageFromBuffer({
      get: storageProvider.get.bind(storageProvider),
      put: storageProvider.put.bind(storageProvider),
      del: storageProvider.del.bind(storageProvider),
    });
  }
  if (config.storage?.type === "memory") {
    const storageProvider = createMemoryStorage();
    return createCasStorageFromBuffer({
      get: storageProvider.get.bind(storageProvider),
      put: storageProvider.put.bind(storageProvider),
      del: storageProvider.del.bind(storageProvider),
    });
  }
  const client =
    config.s3Endpoint != null
      ? new S3Client({
          region: "us-east-1",
          endpoint: config.s3Endpoint,
          forcePathStyle: true,
          credentials: {
            accessKeyId: "minioadmin",
            secretAccessKey: "minioadmin",
          },
        })
      : undefined;
  const storageProvider = createS3Storage({
    bucket: config.s3Bucket,
    region: config.s3Endpoint ? undefined : "us-east-1",
    client,
  });
  return createCasStorageFromBuffer({
    get: storageProvider.get.bind(storageProvider),
    put: storageProvider.put.bind(storageProvider),
    del: storageProvider.del.bind(storageProvider),
  });
}

export function createCasFacade(config: CasFacadeConfig): CasFacadeResult {
  const key = createKeyProvider();
  const storage = createStorageFromConfig(config);
  const cas = createCasFacadeImpl({ storage, key });
  return { cas, key };
}
