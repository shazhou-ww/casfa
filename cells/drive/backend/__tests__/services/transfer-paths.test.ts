import { describe, expect, it } from "bun:test";
import {
  createCasFacade,
  createCasStorageFromBuffer,
  streamFromBytes,
  type CasFacade,
} from "@casfa/cas";
import {
  computeSizeFlagByte,
  encodeDictNode,
  hashToKey,
  type KeyProvider,
} from "@casfa/core";
import { executeTransfer, validateTransferSpec } from "../../services/transfer-paths.ts";
import { createMemoryBranchStore } from "../../db/branch-store.ts";

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

function createTestCas(): { cas: CasFacade; key: KeyProvider } {
  const key = createKeyProvider();
  const store = new Map<string, Uint8Array>();
  const storage = createCasStorageFromBuffer({
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, bytes: Uint8Array) => {
      store.set(k, bytes);
    },
    del: async (_k: string) => {},
  });
  return { cas: createCasFacade({ storage, key }), key };
}

describe("transfer paths preflight", () => {
  it("rejects parent-child conflicts in target paths", async () => {
    const spec = {
      source: "b-src",
      target: "b-tgt",
      mapping: {
        "a.png": "out",
        "b.png": "out/sub/b.png",
      },
      mode: "replace" as const,
    };
    const { cas, key } = createTestCas();
    const branchStore = createMemoryBranchStore();
    await expect(executeTransfer(spec, { cas, key, branchStore })).rejects.toThrow(
      "target paths must not be ancestor/descendant"
    );
  });

  it("normalizes mapping paths", () => {
    const validated = validateTransferSpec({
      source: "b-src",
      target: "b-tgt",
      mapping: {
        "/inputs/a.png/": "/out/a.png/",
      },
    });
    expect(validated.mapping).toEqual({
      "inputs/a.png": "out/a.png",
    });
  });

  it("creates missing target parent directories during transfer", async () => {
    const { cas, key } = createTestCas();
    const branchStore = createMemoryBranchStore();

    const sourceLeaf = await encodeDictNode({ children: [], childNames: [] }, key);
    const sourceRoot = await encodeDictNode(
      { children: [sourceLeaf.hash], childNames: ["birthday_dog_cake_cartoon.jpg"] },
      key
    );
    const targetRoot = await encodeDictNode({ children: [], childNames: [] }, key);
    const sourceLeafKey = hashToKey(sourceLeaf.hash);
    const sourceRootKey = hashToKey(sourceRoot.hash);
    const targetRootKey = hashToKey(targetRoot.hash);

    await cas.putNode(sourceLeafKey, streamFromBytes(sourceLeaf.bytes));
    await cas.putNode(sourceRootKey, streamFromBytes(sourceRoot.bytes));
    await cas.putNode(targetRootKey, streamFromBytes(targetRoot.bytes));

    await branchStore.insertBranch({
      branchId: "b-src",
      realmId: "r-1",
      parentId: "p-1",
      expiresAt: Date.now() + 60_000,
    });
    await branchStore.setBranchRoot("b-src", sourceRootKey);

    await branchStore.insertBranch({
      branchId: "b-tgt",
      realmId: "r-1",
      parentId: "p-1",
      expiresAt: Date.now() + 60_000,
    });
    await branchStore.setBranchRoot("b-tgt", targetRootKey);

    const result = await executeTransfer(
      {
        source: "b-src",
        target: "b-tgt",
        mapping: {
          "birthday_dog_cake_cartoon.jpg": "inputs/birthday_dog_cake_cartoon.jpg",
        },
        mode: "replace",
      },
      { cas, key, branchStore }
    );

    expect(result.applied).toBe(1);
  });
});
