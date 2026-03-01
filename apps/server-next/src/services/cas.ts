import {
  createCasFacade as createCasFacadeImpl,
  createCasStorageFromBuffer,
} from "@casfa/cas";
import type { KeyProvider } from "@casfa/core";
import { computeSizeFlagByte } from "@casfa/core";
import { createFsStorage } from "@casfa/storage-fs";
import { createMemoryStorage } from "@casfa/storage-memory";
import type { CasFacade } from "@casfa/cas";
import type { ServerConfig } from "../config.ts";

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

export function createCasFacade(config: ServerConfig): CasFacadeResult {
  const key = createKeyProvider();
  const storageProvider =
    config.storage.type === "fs"
      ? createFsStorage({ basePath: config.storage.fsPath ?? "./data" })
      : createMemoryStorage();
  const storage = createCasStorageFromBuffer({
    get: storageProvider.get.bind(storageProvider),
    put: storageProvider.put.bind(storageProvider),
    del: storageProvider.del.bind(storageProvider),
  });
  const cas = createCasFacadeImpl({ storage, key });
  return { cas, key };
}
