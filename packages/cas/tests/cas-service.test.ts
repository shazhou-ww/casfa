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

  describe("gc and info", () => {
    it("deletes unreachable and old keys after gc(roots, cutOffTime)", async () => {
      const keyProvider = createKeyProvider();
      const emptyEnc = await encodeDictNode(
        { children: [], childNames: [] },
        keyProvider
      );
      const keyEmpty = hashToKey(emptyEnc.hash);
      await service.putNode(keyEmpty, emptyEnc.bytes);

      const withChildAEnc = await encodeDictNode(
        { children: [emptyEnc.hash], childNames: ["a"] },
        keyProvider
      );
      const keyRootA = hashToKey(withChildAEnc.hash);
      await service.putNode(keyRootA, withChildAEnc.bytes);

      const withChildBEnc = await encodeDictNode(
        { children: [emptyEnc.hash], childNames: ["b"] },
        keyProvider
      );
      const keyRootB = hashToKey(withChildBEnc.hash);
      await service.putNode(keyRootB, withChildBEnc.bytes);

      expect(await service.hasNode(keyRootA)).toBe(true);
      expect(await service.hasNode(keyRootB)).toBe(true);
      expect(await service.hasNode(keyEmpty)).toBe(true);

      const cutOffTime = Date.now() + 10_000;
      await service.gc([keyRootA], cutOffTime);

      expect(await service.hasNode(keyRootA)).toBe(true);
      expect(await service.hasNode(keyEmpty)).toBe(true);
      expect(await service.hasNode(keyRootB)).toBe(false);
    });

    it("info() returns lastGcTime and nodeCount after gc", async () => {
      const keyProvider = createKeyProvider();
      const enc = await encodeDictNode(
        { children: [], childNames: [] },
        keyProvider
      );
      const key = hashToKey(enc.hash);
      await service.putNode(key, enc.bytes);

      let inf = await service.info();
      expect(inf.nodeCount).toBe(1);
      expect(inf.totalBytes).toBeGreaterThan(0);
      expect(inf.lastGcTime).toBeUndefined();

      await service.gc([key], Date.now() + 1);
      inf = await service.info();
      expect(inf.lastGcTime).toBeDefined();
      expect(typeof inf.lastGcTime).toBe("number");
      expect(inf.nodeCount).toBe(1);
      expect(inf.totalBytes).toBeGreaterThan(0);
    });
  });
});
