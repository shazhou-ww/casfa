/**
 * @casfa/fs — Large File Support Tests
 *
 * Tests that `write` and `read` / `readStream` correctly handle files
 * exceeding a single node capacity by splitting into B-Trees and
 * reassembling transparently.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import {
  computeSizeFlagByte,
  encodeDictNode,
  FILEINFO_SIZE,
  HEADER_SIZE,
  hashToKey,
  type KeyProvider,
  type StorageProvider,
} from "@casfa/core";
import { storageKeyToNodeKey } from "@casfa/protocol";
import { blake3 } from "@noble/hashes/blake3";

import { createFsService, type FsContext, isFsError } from "../src/index.ts";

// ============================================================================
// Helpers
// ============================================================================

const createKeyProvider = (): KeyProvider => ({
  computeKey: async (data: Uint8Array) => {
    const raw = blake3(data, { dkLen: 16 });
    raw[0] = computeSizeFlagByte(data.length);
    return raw;
  },
});

type MemoryStorage = StorageProvider & {
  size: () => number;
  clear: () => void;
  keys: () => string[];
};

const createMemoryStorage = (): MemoryStorage => {
  const store = new Map<string, Uint8Array>();
  return {
    put: async (key: string, data: Uint8Array) => {
      store.set(key, new Uint8Array(data));
    },
    get: async (key: string) => store.get(key) ?? null,
    has: async (key: string) => store.has(key),
    size: () => store.size,
    clear: () => store.clear(),
    keys: () => Array.from(store.keys()),
  };
};

/** Create an empty dict node and return its nod_xxx key */
const createEmptyRoot = async (
  storage: MemoryStorage,
  keyProvider: KeyProvider
): Promise<string> => {
  const encoded = await encodeDictNode({ children: [], childNames: [] }, keyProvider);
  const key = hashToKey(encoded.hash);
  await storage.put(key, encoded.bytes);
  return storageKeyToNodeKey(key);
};

/** Build a Uint8Array filled with a deterministic pattern */
const makeTestData = (size: number): Uint8Array => {
  const data = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    data[i] = i % 256;
  }
  return data;
};

/** Collect a ReadableStream into a single Uint8Array */
const streamToBytes = async (stream: ReadableStream<Uint8Array>): Promise<Uint8Array> => {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
};

// ============================================================================
// Tests
// ============================================================================

describe("Large File Support", () => {
  let storage: MemoryStorage;
  let keyProvider: KeyProvider;

  beforeEach(() => {
    storage = createMemoryStorage();
    keyProvider = createKeyProvider();
  });

  // Use a small nodeLimit so we can test B-Tree splitting with small data
  const SMALL_NODE_LIMIT = 256;
  // Single-node capacity = nodeLimit - HEADER_SIZE - FILEINFO_SIZE
  const SINGLE_NODE_CAPACITY = SMALL_NODE_LIMIT - HEADER_SIZE - FILEINFO_SIZE;

  describe("write — single-block files (fast path)", () => {
    it("should write a small file as a single node", async () => {
      const ctx: FsContext = { storage, key: keyProvider, nodeLimit: SMALL_NODE_LIMIT };
      const fs = createFsService({ ctx });

      const rootKey = await createEmptyRoot(storage, keyProvider);
      const data = new Uint8Array([1, 2, 3, 4, 5]);

      const result = await fs.write(rootKey, "hello.txt", undefined, data, "text/plain");
      expect(isFsError(result)).toBe(false);
      if (isFsError(result)) return;

      expect(result.file.size).toBe(5);
      expect(result.file.contentType).toBe("text/plain");

      // Only the root dict + the file node + new root dict = a few nodes
      // The file should fit in a single node
      expect(storage.size()).toBeGreaterThanOrEqual(2);
    });
  });

  describe("write — large files (B-Tree splitting)", () => {
    it("should write a file exceeding single-node capacity", async () => {
      const ctx: FsContext = { storage, key: keyProvider, nodeLimit: SMALL_NODE_LIMIT };
      const fs = createFsService({ ctx });

      const rootKey = await createEmptyRoot(storage, keyProvider);
      // Create data larger than single-node capacity
      const dataSize = SINGLE_NODE_CAPACITY + 100;
      const data = makeTestData(dataSize);

      const result = await fs.write(
        rootKey,
        "large.bin",
        undefined,
        data,
        "application/octet-stream"
      );
      expect(isFsError(result)).toBe(false);
      if (isFsError(result)) return;

      expect(result.file.size).toBe(dataSize);
      // Should have created multiple storage entries (file nodes + dict nodes)
      expect(storage.size()).toBeGreaterThan(2);
    });

    it("should write and read back a large file correctly", async () => {
      const ctx: FsContext = { storage, key: keyProvider, nodeLimit: SMALL_NODE_LIMIT };
      const fs = createFsService({ ctx });

      const rootKey = await createEmptyRoot(storage, keyProvider);
      const dataSize = SINGLE_NODE_CAPACITY * 3; // Will require multi-level B-Tree
      const originalData = makeTestData(dataSize);

      const writeResult = await fs.write(
        rootKey,
        "big-file.dat",
        undefined,
        originalData,
        "application/octet-stream"
      );
      expect(isFsError(writeResult)).toBe(false);
      if (isFsError(writeResult)) return;

      // Read it back
      const readResult = await fs.read(writeResult.newRoot, "big-file.dat");
      expect(isFsError(readResult)).toBe(false);
      if (isFsError(readResult)) return;

      expect(readResult.size).toBe(dataSize);
      expect(readResult.contentType).toBe("application/octet-stream");
      expect(readResult.data).toEqual(originalData);
    });

    it("should correctly stat a multi-block file", async () => {
      const ctx: FsContext = { storage, key: keyProvider, nodeLimit: SMALL_NODE_LIMIT };
      const fs = createFsService({ ctx });

      const rootKey = await createEmptyRoot(storage, keyProvider);
      const dataSize = SINGLE_NODE_CAPACITY + 200;
      const data = makeTestData(dataSize);

      const writeResult = await fs.write(rootKey, "multi.bin", undefined, data, "image/png");
      expect(isFsError(writeResult)).toBe(false);
      if (isFsError(writeResult)) return;

      const statResult = await fs.stat(writeResult.newRoot, "multi.bin");
      expect(isFsError(statResult)).toBe(false);
      if (isFsError(statResult)) return;

      expect(statResult.type).toBe("file");
      if (statResult.type !== "file") return;
      expect(statResult.size).toBe(dataSize);
      expect(statResult.contentType).toBe("image/png");
    });
  });

  describe("write — maxFileSize enforcement", () => {
    it("should reject files exceeding maxFileSize", async () => {
      const ctx: FsContext = {
        storage,
        key: keyProvider,
        nodeLimit: SMALL_NODE_LIMIT,
        maxFileSize: 100,
      };
      const fs = createFsService({ ctx });

      const rootKey = await createEmptyRoot(storage, keyProvider);
      const data = makeTestData(200);

      const result = await fs.write(
        rootKey,
        "too-big.bin",
        undefined,
        data,
        "application/octet-stream"
      );
      expect(isFsError(result)).toBe(true);
      if (!isFsError(result)) return;

      expect(result.code).toBe("FILE_TOO_LARGE");
      expect(result.status).toBe(413);
    });

    it("should allow files within maxFileSize", async () => {
      const ctx: FsContext = {
        storage,
        key: keyProvider,
        nodeLimit: SMALL_NODE_LIMIT,
        maxFileSize: 500,
      };
      const fs = createFsService({ ctx });

      const rootKey = await createEmptyRoot(storage, keyProvider);
      const data = makeTestData(50);

      const result = await fs.write(rootKey, "ok.bin", undefined, data, "text/plain");
      expect(isFsError(result)).toBe(false);
    });

    it("should allow large files when maxFileSize is not set", async () => {
      const ctx: FsContext = { storage, key: keyProvider, nodeLimit: SMALL_NODE_LIMIT };
      const fs = createFsService({ ctx });

      const rootKey = await createEmptyRoot(storage, keyProvider);
      const dataSize = SINGLE_NODE_CAPACITY * 5;
      const data = makeTestData(dataSize);

      const result = await fs.write(
        rootKey,
        "huge.bin",
        undefined,
        data,
        "application/octet-stream"
      );
      expect(isFsError(result)).toBe(false);
    });
  });

  describe("read — multi-block files", () => {
    it("should read a single-block file normally", async () => {
      const ctx: FsContext = { storage, key: keyProvider, nodeLimit: SMALL_NODE_LIMIT };
      const fs = createFsService({ ctx });

      const rootKey = await createEmptyRoot(storage, keyProvider);
      const data = new Uint8Array([10, 20, 30, 40, 50]);

      const writeResult = await fs.write(rootKey, "small.txt", undefined, data, "text/plain");
      expect(isFsError(writeResult)).toBe(false);
      if (isFsError(writeResult)) return;

      const readResult = await fs.read(writeResult.newRoot, "small.txt");
      expect(isFsError(readResult)).toBe(false);
      if (isFsError(readResult)) return;

      expect(readResult.data).toEqual(data);
      expect(readResult.size).toBe(5);
      expect(readResult.contentType).toBe("text/plain");
    });

    it("should read a multi-block file transparently", async () => {
      const ctx: FsContext = { storage, key: keyProvider, nodeLimit: SMALL_NODE_LIMIT };
      const fs = createFsService({ ctx });

      const rootKey = await createEmptyRoot(storage, keyProvider);
      const dataSize = SINGLE_NODE_CAPACITY * 2;
      const originalData = makeTestData(dataSize);

      const writeResult = await fs.write(
        rootKey,
        "multi.dat",
        undefined,
        originalData,
        "application/octet-stream"
      );
      expect(isFsError(writeResult)).toBe(false);
      if (isFsError(writeResult)) return;

      const readResult = await fs.read(writeResult.newRoot, "multi.dat");
      expect(isFsError(readResult)).toBe(false);
      if (isFsError(readResult)) return;

      expect(readResult.data).toEqual(originalData);
      expect(readResult.size).toBe(dataSize);
    });
  });

  describe("readStream", () => {
    it("should stream a single-block file", async () => {
      const ctx: FsContext = { storage, key: keyProvider, nodeLimit: SMALL_NODE_LIMIT };
      const fs = createFsService({ ctx });

      const rootKey = await createEmptyRoot(storage, keyProvider);
      const data = new Uint8Array([1, 2, 3, 4, 5]);

      const writeResult = await fs.write(rootKey, "tiny.txt", undefined, data, "text/plain");
      expect(isFsError(writeResult)).toBe(false);
      if (isFsError(writeResult)) return;

      const streamResult = await fs.readStream(writeResult.newRoot, "tiny.txt");
      expect(isFsError(streamResult)).toBe(false);
      if (isFsError(streamResult)) return;

      expect(streamResult.contentType).toBe("text/plain");
      expect(streamResult.size).toBe(5);

      const bytes = await streamToBytes(streamResult.stream);
      expect(bytes).toEqual(data);
    });

    it("should stream a multi-block file", async () => {
      const ctx: FsContext = { storage, key: keyProvider, nodeLimit: SMALL_NODE_LIMIT };
      const fs = createFsService({ ctx });

      const rootKey = await createEmptyRoot(storage, keyProvider);
      const dataSize = SINGLE_NODE_CAPACITY * 4;
      const originalData = makeTestData(dataSize);

      const writeResult = await fs.write(
        rootKey,
        "stream-me.bin",
        undefined,
        originalData,
        "application/octet-stream"
      );
      expect(isFsError(writeResult)).toBe(false);
      if (isFsError(writeResult)) return;

      const streamResult = await fs.readStream(writeResult.newRoot, "stream-me.bin");
      expect(isFsError(streamResult)).toBe(false);
      if (isFsError(streamResult)) return;

      expect(streamResult.size).toBe(dataSize);
      const bytes = await streamToBytes(streamResult.stream);
      expect(bytes).toEqual(originalData);
    });

    it("should return error for directory", async () => {
      const ctx: FsContext = { storage, key: keyProvider, nodeLimit: SMALL_NODE_LIMIT };
      const fs = createFsService({ ctx });

      const rootKey = await createEmptyRoot(storage, keyProvider);
      const mkdirResult = await fs.mkdir(rootKey, "mydir");
      expect(isFsError(mkdirResult)).toBe(false);
      if (isFsError(mkdirResult)) return;

      const streamResult = await fs.readStream(mkdirResult.newRoot, "mydir");
      expect(isFsError(streamResult)).toBe(true);
      if (!isFsError(streamResult)) return;
      expect(streamResult.code).toBe("NOT_A_FILE");
    });
  });

  describe("onNodeStored hook", () => {
    it("should call onNodeStored for every node in a multi-block write", async () => {
      const storedNodes: Array<{ kind: string; storageKey: string }> = [];

      const ctx: FsContext = {
        storage,
        key: keyProvider,
        nodeLimit: SMALL_NODE_LIMIT,
        onNodeStored: async (info) => {
          storedNodes.push({ kind: info.kind, storageKey: info.storageKey });
        },
      };
      const fs = createFsService({ ctx });

      const rootKey = await createEmptyRoot(storage, keyProvider);
      const dataSize = SINGLE_NODE_CAPACITY * 3;
      const data = makeTestData(dataSize);

      const result = await fs.write(
        rootKey,
        "tracked.bin",
        undefined,
        data,
        "application/octet-stream"
      );
      expect(isFsError(result)).toBe(false);
      if (isFsError(result)) return;

      // Should have stored multiple nodes: s-nodes + f-node (root) + dict nodes
      // At minimum: 1 f-node + at least 1 s-node + dict nodes
      const fileNodes = storedNodes.filter((n) => n.kind === "file");
      const successorNodes = storedNodes.filter((n) => n.kind === "successor");
      const dictNodes = storedNodes.filter((n) => n.kind === "dict");

      expect(fileNodes.length).toBeGreaterThanOrEqual(1);
      expect(successorNodes.length).toBeGreaterThanOrEqual(1);
      expect(dictNodes.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("overwrite — large file replacing existing", () => {
    it("should overwrite an existing file with a large file", async () => {
      const ctx: FsContext = { storage, key: keyProvider, nodeLimit: SMALL_NODE_LIMIT };
      const fs = createFsService({ ctx });

      const rootKey = await createEmptyRoot(storage, keyProvider);

      // Write a small file first
      const smallData = new Uint8Array([1, 2, 3]);
      const writeResult1 = await fs.write(rootKey, "file.dat", undefined, smallData, "text/plain");
      expect(isFsError(writeResult1)).toBe(false);
      if (isFsError(writeResult1)) return;

      // Overwrite with a large file
      const largeSize = SINGLE_NODE_CAPACITY * 2;
      const largeData = makeTestData(largeSize);
      const writeResult2 = await fs.write(
        writeResult1.newRoot,
        "file.dat",
        undefined,
        largeData,
        "application/octet-stream"
      );
      expect(isFsError(writeResult2)).toBe(false);
      if (isFsError(writeResult2)) return;

      expect(writeResult2.created).toBe(false);
      expect(writeResult2.file.size).toBe(largeSize);

      // Read back and verify
      const readResult = await fs.read(writeResult2.newRoot, "file.dat");
      expect(isFsError(readResult)).toBe(false);
      if (isFsError(readResult)) return;

      expect(readResult.data).toEqual(largeData);
    });
  });

  describe("write large file in nested directory", () => {
    it("should write a large file at a nested path", async () => {
      const ctx: FsContext = { storage, key: keyProvider, nodeLimit: SMALL_NODE_LIMIT };
      const fs = createFsService({ ctx });

      const rootKey = await createEmptyRoot(storage, keyProvider);
      const dataSize = SINGLE_NODE_CAPACITY + 50;
      const data = makeTestData(dataSize);

      const result = await fs.write(
        rootKey,
        "a/b/large.bin",
        undefined,
        data,
        "application/octet-stream"
      );
      expect(isFsError(result)).toBe(false);
      if (isFsError(result)) return;

      expect(result.file.size).toBe(dataSize);
      expect(result.created).toBe(true);

      // Read back
      const readResult = await fs.read(result.newRoot, "a/b/large.bin");
      expect(isFsError(readResult)).toBe(false);
      if (isFsError(readResult)) return;

      expect(readResult.data).toEqual(data);
    });
  });
});
