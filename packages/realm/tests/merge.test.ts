import { describe, expect, test } from "bun:test";
import { replaceSubtreeAtPath } from "../src/merge.ts";
import type { MergeContext } from "../src/merge.ts";
import { decodeNode, encodeDictNode, getWellKnownNodeData, makeDict, hashToKey } from "@casfa/core";
import type { CasContext } from "@casfa/core";

describe("replaceSubtreeAtPath", () => {
  const storageMap = new Map<string, Uint8Array>();
  const storage = {
    get: (k: string) => Promise.resolve(storageMap.get(k) ?? null),
    put: (k: string, v: Uint8Array) => {
      storageMap.set(k, v);
      return Promise.resolve();
    },
  };
  const keyProvider = { computeKey: async (data: Uint8Array) => data.subarray(0, 16) };
  const ctx: CasContext = { storage, key: keyProvider };

  async function getNode(key: string) {
    const data = getWellKnownNodeData(key) ?? storageMap.get(key) ?? null;
    if (!data) return null;
    return decodeNode(data);
  }

  const mergeCtx: MergeContext = { getNode, makeDict, ctx };

  test("replaces single segment and returns new root key", async () => {
    const childHash = new Uint8Array(16);
    childHash.set([1, 2, 3], 0);
    const childKey = hashToKey(childHash);
    const enc = await encodeDictNode(
      { children: [childHash], childNames: ["a"] },
      keyProvider
    );
    const rootKey = hashToKey(enc.hash);
    storageMap.set(rootKey, enc.bytes);
    storageMap.set(childKey, enc.bytes);

    const newChildHash = new Uint8Array(16);
    newChildHash.set([4, 5, 6], 0);
    const newChildKey = hashToKey(newChildHash);
    storageMap.set(newChildKey, enc.bytes);

    const newRootKey = await replaceSubtreeAtPath(
      rootKey,
      [{ kind: "name", value: "a" }],
      newChildKey,
      mergeCtx
    );

    const newRoot = await getNode(newRootKey);
    expect(newRoot?.kind).toBe("dict");
    expect(newRoot?.childNames).toEqual(["a"]);
    expect(hashToKey(newRoot!.children![0]!)).toBe(newChildKey);
  });

  test("empty path returns newChildKey as root", async () => {
    const r = await replaceSubtreeAtPath("any", [], "newKey", mergeCtx);
    expect(r).toBe("newKey");
  });
});
