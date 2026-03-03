/**
 * Tree-mutations tests: tryRemoveEntryAtPath (no-op when path missing).
 */
import { describe, expect, it } from "bun:test";
import type { CasFacade } from "@casfa/cas";
import { createCasFacade } from "@casfa/cas";
import { createCasStorageFromBuffer, streamFromBytes } from "@casfa/cas";
import { encodeDictNode, hashToKey } from "@casfa/core";
import type { KeyProvider } from "@casfa/core";
import { computeSizeFlagByte } from "@casfa/core";
import { tryRemoveEntryAtPath, removeEntryAtPath, ensurePathThenAddOrReplace, addOrReplaceAtPath } from "../../services/tree-mutations.ts";
import { resolvePath } from "../../services/root-resolver.ts";

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

describe("ensurePathThenAddOrReplace", () => {
  it("when path exists same as addOrReplaceAtPath", async () => {
    const { cas, key, rootKey } = await createMockCasWithTree();
    const emptyDict = await encodeDictNode({ children: [], childNames: [] }, key);
    const emptyKey = hashToKey(emptyDict.hash);
    await cas.putNode(emptyKey, streamFromBytes(emptyDict.bytes));
    const out = await ensurePathThenAddOrReplace(cas, key, rootKey, "a/c", emptyKey);
    expect(out).not.toBe(rootKey);
    const expected = await addOrReplaceAtPath(cas, key, rootKey, "a/c", emptyKey);
    expect(out).toBe(expected);
  });

  it("when path has missing segments creates dirs then add", async () => {
    const { cas, key, rootKey } = await createMockCasWithTree();
    const emptyDict = await encodeDictNode({ children: [], childNames: [] }, key);
    const leafKey = hashToKey(emptyDict.hash);
    await cas.putNode(leafKey, streamFromBytes(emptyDict.bytes));
    const out = await ensurePathThenAddOrReplace(cas, key, rootKey, "a/x/y", leafKey);
    expect(out).not.toBe(rootKey);
    const resolved = await resolvePath(cas, out, "a/x/y");
    expect(resolved).toBe(leafKey);
  });
});
