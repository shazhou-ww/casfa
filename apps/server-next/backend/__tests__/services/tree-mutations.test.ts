/**
 * Tree-mutations tests: tryRemoveEntryAtPath (no-op when path missing).
 */
import { describe, expect, it } from "bun:test";
import type { CasFacade } from "@casfa/cas";
import { createCasFacade } from "@casfa/cas";
import { createCasStorageFromBuffer } from "@casfa/cas";
import { encodeDictNode, hashToKey } from "@casfa/core";
import type { KeyProvider } from "@casfa/core";
import { computeSizeFlagByte } from "@casfa/core";
import { tryRemoveEntryAtPath, removeEntryAtPath } from "../../services/tree-mutations.ts";

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

async function createMockCasWithTree(): Promise<{
  cas: CasFacade;
  key: KeyProvider;
  rootKey: string;
}> {
  const key = createKeyProvider();
  const emptyDict = await encodeDictNode({ children: [], childNames: [] }, key);
  const dictB = await encodeDictNode({ children: [emptyDict.hash], childNames: ["b"] }, key);
  const dictA = await encodeDictNode({ children: [dictB.hash], childNames: ["a"] }, key);
  const rootKey = hashToKey(dictA.hash);

  const store = new Map<string, Uint8Array>();
  store.set(rootKey, dictA.bytes);
  store.set(hashToKey(dictB.hash), dictB.bytes);
  store.set(hashToKey(emptyDict.hash), emptyDict.bytes);

  const bufferStorage = {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, bytes: Uint8Array) => {
      store.set(k, bytes);
    },
    del: async (_k: string) => {},
  };
  const storage = createCasStorageFromBuffer(bufferStorage);
  const cas = createCasFacade({ storage, key });
  return { cas, key, rootKey };
}

describe("tryRemoveEntryAtPath", () => {
  it("returns rootKey unchanged when path does not exist", async () => {
    const { cas, key, rootKey } = await createMockCasWithTree();
    const out = await tryRemoveEntryAtPath(cas, key, rootKey, "x");
    expect(out).toBe(rootKey);
    const out2 = await tryRemoveEntryAtPath(cas, key, rootKey, "a/c");
    expect(out2).toBe(rootKey);
  });

  it("removes entry when path exists (same result as removeEntryAtPath)", async () => {
    const { cas, key, rootKey } = await createMockCasWithTree();
    const out = await tryRemoveEntryAtPath(cas, key, rootKey, "a/b");
    expect(out).not.toBe(rootKey);
    const expected = await removeEntryAtPath(cas, key, rootKey, "a/b");
    expect(out).toBe(expected);
  });
});
