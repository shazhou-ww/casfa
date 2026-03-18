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
import {
  applyPathTemplate,
  resolvePathPatternMatches,
  validatePatternMode,
} from "../../services/fs-patterns.ts";

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

async function makeTree(cas: CasFacade, key: KeyProvider): Promise<string> {
  const nestedLeaf = await encodeDictNode({ children: [], childNames: [] }, key);
  const nestedLeafKey = hashToKey(nestedLeaf.hash);
  await cas.putNode(nestedLeafKey, streamFromBytes(nestedLeaf.bytes));

  const imagesDir = await encodeDictNode(
    {
      children: [nestedLeaf.hash, nestedLeaf.hash],
      childNames: ["photo.jpg", "nested"],
    },
    key
  );
  const imagesDirKey = hashToKey(imagesDir.hash);
  await cas.putNode(imagesDirKey, streamFromBytes(imagesDir.bytes));

  const root = await encodeDictNode({ children: [imagesDir.hash], childNames: ["images"] }, key);
  const rootKey = hashToKey(root.hash);
  await cas.putNode(rootKey, streamFromBytes(root.bytes));
  return rootKey;
}

describe("fs-patterns", () => {
  it("rejects recursive glob pattern", () => {
    expect(() => validatePatternMode("glob", "images/**/*.jpg")).toThrow(
      "E_PATTERN_NOT_ALLOWED"
    );
  });

  it("matches only one directory level for glob", async () => {
    const { cas, key } = createTestCas();
    const rootKey = await makeTree(cas, key);
    const matches = await resolvePathPatternMatches(cas, rootKey, "images/*.jpg", "glob");
    expect(matches.map((item) => item.path)).toEqual(["images/photo.jpg"]);
  });

  it("matches regex on basename only", async () => {
    const { cas, key } = createTestCas();
    const rootKey = await makeTree(cas, key);
    const matches = await resolvePathPatternMatches(cas, rootKey, "images/^photo\\.(jpg|png)$", "regex");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.captures).toEqual(["jpg"]);
  });

  it("applies template variables from match info", () => {
    const rendered = applyPathTemplate("images/{basename}-{capture:1}.{ext}", {
      path: "images/photo.jpg",
      parentPath: "images",
      name: "photo.jpg",
      captures: ["jpg"],
    });
    expect(rendered).toBe("images/photo.jpg-jpg.jpg");
  });
});
