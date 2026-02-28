import { describe, expect, test } from "bun:test";
import type { RealmError } from "../src/errors.ts";
import { resolvePath, validateNameOnlyPath } from "../src/path.ts";
import type { CasNode } from "@casfa/core";
import { decodeNode, encodeDictNode, getWellKnownNodeData } from "@casfa/core";
import { hashToKey } from "@casfa/core";

describe("validateNameOnlyPath", () => {
  test("returns null for name-only segments", () => {
    expect(validateNameOnlyPath([{ kind: "name", value: "a" }])).toBe(null);
    expect(validateNameOnlyPath([])).toBe(null);
  });

  test("returns InvalidPath when index segment present", () => {
    const err = validateNameOnlyPath([{ kind: "index", value: 0 }]) as RealmError;
    expect(err?.code).toBe("InvalidPath");
  });
});

describe("resolvePath", () => {
  const keyProvider = { computeKey: async (data: Uint8Array) => data.subarray(0, 16) };
  const storage = new Map<string, Uint8Array>();

  async function getNode(key: string): Promise<CasNode | null> {
    const wellKnown = getWellKnownNodeData(key);
    if (wellKnown) return decodeNode(wellKnown);
    const data = storage.get(key);
    if (!data) return null;
    return decodeNode(data);
  }

  test("empty segments returns root key", async () => {
    const rootKey = "240B5PHBGEC2A705WTKKMVRS30";
    const r = await resolvePath(rootKey, [], getNode);
    expect(r).toEqual({ key: rootKey });
  });

  test("resolves name segment under dict", async () => {
    const childHash = new Uint8Array(16);
    childHash.set([1, 2, 3], 0);
    const childKey = hashToKey(childHash);
    const enc = await encodeDictNode(
      { children: [childHash], childNames: ["x"] },
      keyProvider
    );
    const rootKey = hashToKey(enc.hash);
    storage.set(rootKey, enc.bytes);
    storage.set(childKey, enc.bytes);

    const r = await resolvePath(rootKey, [{ kind: "name", value: "x" }], getNode);
    if ("code" in r) throw new Error(JSON.stringify(r));
    expect(r.key).toBe(childKey);
  });

  test("returns NotFound for missing node", async () => {
    const r = await resolvePath("nonexistentkey1234567890123456", [], getNode);
    expect(r).toMatchObject({ code: "NotFound" });
  });
});
