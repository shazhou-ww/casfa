/**
 * Adapter from buffer-based storage (Uint8Array) to stream-based CasStorage.
 * Use for in-memory or existing storage implementations that return buffers.
 */
import { bytesFromStream, streamFromBytes } from "./stream-util.ts";
import type { CasStorage } from "./types.ts";

export type BufferCasStorage = {
  get: (key: string) => Promise<Uint8Array | null>;
  put: (key: string, value: Uint8Array) => Promise<void>;
  del: (key: string) => Promise<void>;
};

export function createCasStorageFromBuffer(buffer: BufferCasStorage): CasStorage {
  return {
    async get(key: string) {
      const bytes = await buffer.get(key);
      if (bytes === null) return null;
      return streamFromBytes(bytes);
    },
    async put(key: string, value: ReadableStream<Uint8Array>) {
      const bytes = await bytesFromStream(value);
      await buffer.put(key, bytes);
    },
    del: (key: string) => buffer.del(key),
  };
}
