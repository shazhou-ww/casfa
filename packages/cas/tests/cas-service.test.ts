/**
 * CAS service tests: getNode, putNode, hasNode, child existence check
 */
import { beforeEach, describe, expect, it } from "bun:test";
import {
  decodeNode,
  encodeDictNode,
  hashToKey,
  computeSizeFlagByte,
} from "@casfa/core";
import type { KeyProvider } from "@casfa/core";
import { createMemoryStorage } from "@casfa/storage-memory";
import { createCasService, CasError } from "../src/cas-service.ts";
import type { CasStorage } from "../src/types.ts";

const createKeyProvider = (): KeyProvider => ({
  computeKey: async (data: Uint8Array) => {
    const { blake3 } = await import("@noble/hashes/blake3");
    const raw = blake3(data, { dkLen: 16 });
    raw[0] = computeSizeFlagByte(data.length);
    return raw;
  },
});

describe("CasService", () => {
  let storage: CasStorage;
  let service: ReturnType<typeof createCasService>;

  beforeEach(() => {
    const mem = createMemoryStorage();
    storage = {
      get: mem.get.bind(mem),
      put: mem.put.bind(mem),
      del: mem.del.bind(mem),
    };
    service = createCasService({
      storage,
      key: createKeyProvider(),
    });
  });

  describe("getNode", () => {
    it("returns null for missing key", async () => {
      const got = await service.getNode("0".repeat(26));
      expect(got).toBeNull();
    });

    it("returns decoded node after putNode", async () => {
      const encoded = await encodeDictNode(
        { children: [], childNames: [] },
        createKeyProvider()
      );
      const nodeKey = hashToKey(encoded.hash);
      await service.putNode(nodeKey, encoded.bytes);
      const node = await service.getNode(nodeKey);
      expect(node).not.toBeNull();
      expect(node!.kind).toBe("dict");
      expect(node!.children).toEqual(undefined);
      expect(node!.childNames).toEqual([]);
    });
  });

  describe("hasNode", () => {
    it("returns false for missing key", async () => {
      expect(await service.hasNode("0".repeat(26))).toBe(false);
    });

    it("returns true when key exists", async () => {
      const encoded = await encodeDictNode(
        { children: [], childNames: [] },
        createKeyProvider()
      );
      const nodeKey = hashToKey(encoded.hash);
      await service.putNode(nodeKey, encoded.bytes);
      expect(await service.hasNode(nodeKey)).toBe(true);
    });
  });

  describe("putNode", () => {
    it("fails with ChildMissing when data references a child that does not exist", async () => {
      const keyProvider = createKeyProvider();
      const fakeChildHash = new Uint8Array(16);
      fakeChildHash.fill(0xab);
      const encoded = await encodeDictNode(
        { children: [fakeChildHash], childNames: ["x"] },
        keyProvider
      );
      const nodeKey = hashToKey(encoded.hash);
      await expect(service.putNode(nodeKey, encoded.bytes)).rejects.toMatchObject({
        code: "ChildMissing",
      });
      const err = await service.putNode(nodeKey, encoded.bytes).catch((e) => e);
      expect(err).toBeInstanceOf(CasError);
      expect((err as CasError).code).toBe("ChildMissing");
    });
  });
});
