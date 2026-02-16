/**
 * applyMergeOps — test suite
 *
 * Verifies that MergeOp[] from dag-diff are correctly mapped to
 * `rewrite()` calls, producing the expected new root.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import {
  computeSizeFlagByte,
  encodeDictNode,
  encodeFileNode,
  hashToKey,
  type KeyProvider,
  type StorageProvider,
} from "@casfa/core";
import { storageKeyToNodeKey } from "@casfa/protocol";
import { blake3 } from "@noble/hashes/blake3";

import { createFsService, type FsContext, applyMergeOps, type MergeOp as FsMergeOp } from "../src/index.ts";

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
  data: Map<string, Uint8Array>;
};

const createMemoryStorage = (): MemoryStorage => {
  const store = new Map<string, Uint8Array>();
  return {
    put: async (key: string, data: Uint8Array) => {
      store.set(key, new Uint8Array(data));
    },
    get: async (key: string) => store.get(key) ?? null,
    size: () => store.size,
    data: store,
  };
};

const keyProvider = createKeyProvider();

/** Encode & store a dict node, return its node key (nod_xxx) and hash */
async function storeDict(
  storage: MemoryStorage,
  childNames: string[],
  children: Uint8Array[],
): Promise<{ nodeKey: string; hash: Uint8Array }> {
  const encoded = await encodeDictNode({ children, childNames }, keyProvider);
  const key = hashToKey(encoded.hash);
  await storage.put(key, encoded.bytes);
  return { nodeKey: storageKeyToNodeKey(key), hash: encoded.hash };
}

/** Encode & store a file node, return its node key (nod_xxx) and hash */
async function storeFile(
  storage: MemoryStorage,
  content: string,
  contentType = "text/plain",
): Promise<{ nodeKey: string; hash: Uint8Array }> {
  const data = new TextEncoder().encode(content);
  const encoded = await encodeFileNode(
    { data, contentType, fileSize: data.length },
    keyProvider,
  );
  const key = hashToKey(encoded.hash);
  await storage.put(key, encoded.bytes);
  return { nodeKey: storageKeyToNodeKey(key), hash: encoded.hash };
}

// ============================================================================
// Tests
// ============================================================================

describe("applyMergeOps", () => {
  let storage: MemoryStorage;
  let ctx: FsContext;

  beforeEach(() => {
    storage = createMemoryStorage();
    ctx = { storage, key: keyProvider };
  });

  test("empty operations → same root, zero counts", async () => {
    const file = await storeFile(storage, "hello");
    const root = await storeDict(storage, ["a.txt"], [file.hash]);

    const fs = createFsService({ ctx });
    const result = await applyMergeOps(root.nodeKey, [], fs);

    expect(result.newRoot).toBe(root.nodeKey);
    expect(result.entriesApplied).toBe(0);
    expect(result.deleted).toBe(0);
  });

  test("add a new file", async () => {
    // Initial: /a.txt
    const fileA = await storeFile(storage, "content-A");
    const root = await storeDict(storage, ["a.txt"], [fileA.hash]);

    // New file to add
    const fileB = await storeFile(storage, "content-B");

    const fs = createFsService({ ctx });
    const ops: FsMergeOp[] = [
      { type: "add", path: "b.txt", nodeKey: fileB.nodeKey },
    ];

    const result = await applyMergeOps(root.nodeKey, ops, fs);

    expect(result.entriesApplied).toBe(1);
    expect(result.deleted).toBe(0);
    expect(result.newRoot).not.toBe(root.nodeKey); // root changed

    // Verify new root has both files
    const listing = await fs.ls(result.newRoot);
    expect(listing).toHaveProperty("children");
    const names = (listing as { children: Array<{ name: string }> }).children.map((e) => e.name).sort();
    expect(names).toEqual(["a.txt", "b.txt"]);
  });

  test("remove a file", async () => {
    // Initial: /a.txt, /b.txt
    const fileA = await storeFile(storage, "content-A");
    const fileB = await storeFile(storage, "content-B");
    const root = await storeDict(storage, ["a.txt", "b.txt"], [fileA.hash, fileB.hash]);

    const fs = createFsService({ ctx });
    const ops: FsMergeOp[] = [
      { type: "remove", path: "b.txt" },
    ];

    const result = await applyMergeOps(root.nodeKey, ops, fs);

    expect(result.entriesApplied).toBe(0);
    expect(result.deleted).toBe(1);
    expect(result.newRoot).not.toBe(root.nodeKey);

    // Verify new root has only a.txt
    const listing = await fs.ls(result.newRoot);
    expect(listing).toHaveProperty("children");
    const names = (listing as { children: Array<{ name: string }> }).children.map((e) => e.name);
    expect(names).toEqual(["a.txt"]);
  });

  test("update (replace) a file", async () => {
    const fileA = await storeFile(storage, "old-content");
    const root = await storeDict(storage, ["a.txt"], [fileA.hash]);

    const fileANew = await storeFile(storage, "new-content");

    const fs = createFsService({ ctx });
    const ops: FsMergeOp[] = [
      { type: "update", path: "a.txt", nodeKey: fileANew.nodeKey },
    ];

    const result = await applyMergeOps(root.nodeKey, ops, fs);

    expect(result.entriesApplied).toBe(1);
    expect(result.deleted).toBe(0);
    expect(result.newRoot).not.toBe(root.nodeKey);
  });

  test("mixed operations: add + update + remove", async () => {
    const fileA = await storeFile(storage, "content-A");
    const fileB = await storeFile(storage, "content-B");
    const fileC = await storeFile(storage, "content-C");
    const root = await storeDict(
      storage,
      ["a.txt", "b.txt", "c.txt"],
      [fileA.hash, fileB.hash, fileC.hash],
    );

    const fileD = await storeFile(storage, "content-D");       // new file
    const fileBNew = await storeFile(storage, "content-B-new"); // updated

    const fs = createFsService({ ctx });
    const ops: FsMergeOp[] = [
      { type: "add", path: "d.txt", nodeKey: fileD.nodeKey },
      { type: "update", path: "b.txt", nodeKey: fileBNew.nodeKey },
      { type: "remove", path: "c.txt" },
    ];

    const result = await applyMergeOps(root.nodeKey, ops, fs);

    expect(result.entriesApplied).toBe(2); // add + update
    expect(result.deleted).toBe(1);        // remove

    // Verify final state: a.txt, b.txt (updated), d.txt
    const listing = await fs.ls(result.newRoot);
    expect(listing).toHaveProperty("children");
    const names = (listing as { children: Array<{ name: string }> }).children.map((e) => e.name).sort();
    expect(names).toEqual(["a.txt", "b.txt", "d.txt"]);
  });

  test("add file in nested path (mkdir -p)", async () => {
    // Initial: empty root
    const root = await storeDict(storage, [], []);

    const file = await storeFile(storage, "deep-content");

    const fs = createFsService({ ctx });
    const ops: FsMergeOp[] = [
      { type: "add", path: "src/utils/helper.ts", nodeKey: file.nodeKey },
    ];

    const result = await applyMergeOps(root.nodeKey, ops, fs);

    expect(result.entriesApplied).toBe(1);
    expect(result.newRoot).not.toBe(root.nodeKey);
  });
});
