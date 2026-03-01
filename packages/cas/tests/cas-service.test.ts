/**
 * CAS service tests: getNode, putNode, hasNode, child existence check
 */
import { beforeEach, describe, expect, it } from "bun:test";
import type { KeyProvider } from "@casfa/core";
import { computeSizeFlagByte, encodeDictNode, hashToKey } from "@casfa/core";
import { createMemoryStorage } from "@casfa/storage-memory";
import { CasError, createCasService } from "../src/cas-service.ts";
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
      const encoded = await encodeDictNode({ children: [], childNames: [] }, createKeyProvider());
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
      const encoded = await encodeDictNode({ children: [], childNames: [] }, createKeyProvider());
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
      const emptyEnc = await encodeDictNode({ children: [], childNames: [] }, keyProvider);
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

    it("multi-root: two disjoint trees, gc with one root deletes the other tree", async () => {
      const keyProvider = createKeyProvider();
      const e1Enc = await encodeDictNode({ children: [], childNames: [] }, keyProvider);
      const keyE1 = hashToKey(e1Enc.hash);
      await service.putNode(keyE1, e1Enc.bytes);

      const r1Enc = await encodeDictNode(
        { children: [e1Enc.hash], childNames: ["x"] },
        keyProvider
      );
      const keyR1 = hashToKey(r1Enc.hash);
      await service.putNode(keyR1, r1Enc.bytes);

      const e2Enc = await encodeDictNode(
        { children: [e1Enc.hash], childNames: ["y"] },
        keyProvider
      );
      const keyE2 = hashToKey(e2Enc.hash);
      await service.putNode(keyE2, e2Enc.bytes);

      const r2Enc = await encodeDictNode(
        { children: [e2Enc.hash], childNames: ["z"] },
        keyProvider
      );
      const keyR2 = hashToKey(r2Enc.hash);
      await service.putNode(keyR2, r2Enc.bytes);

      expect(await service.hasNode(keyR1)).toBe(true);
      expect(await service.hasNode(keyE1)).toBe(true);
      expect(await service.hasNode(keyR2)).toBe(true);
      expect(await service.hasNode(keyE2)).toBe(true);

      await service.gc([keyR1], Date.now() + 10_000);

      expect(await service.hasNode(keyR1)).toBe(true);
      expect(await service.hasNode(keyE1)).toBe(true);
      expect(await service.hasNode(keyR2)).toBe(false);
      expect(await service.hasNode(keyE2)).toBe(false);
    });

    it("cutOffTime: unreachable node retained when writeTime >= cutOffTime", async () => {
      const keyProvider = createKeyProvider();
      const enc = await encodeDictNode({ children: [], childNames: [] }, keyProvider);
      const key = hashToKey(enc.hash);
      const cutOffBeforePut = Date.now() - 1000;
      await service.putNode(key, enc.bytes);
      await service.gc([], cutOffBeforePut);
      expect(await service.hasNode(key)).toBe(true);
    });

    it("cutOffTime: unreachable node deleted when writeTime < cutOffTime", async () => {
      const keyProvider = createKeyProvider();
      const enc = await encodeDictNode({ children: [], childNames: [] }, keyProvider);
      const key = hashToKey(enc.hash);
      await service.putNode(key, enc.bytes);
      const cutOffAfterPut = Date.now() + 10_000;
      await service.gc([], cutOffAfterPut);
      expect(await service.hasNode(key)).toBe(false);
    });

    it("info() before and after gc: nodeCount and totalBytes change", async () => {
      const keyProvider = createKeyProvider();
      const eEnc = await encodeDictNode({ children: [], childNames: [] }, keyProvider);
      const keyE = hashToKey(eEnc.hash);
      await service.putNode(keyE, eEnc.bytes);
      const rEnc = await encodeDictNode({ children: [eEnc.hash], childNames: ["a"] }, keyProvider);
      const keyR = hashToKey(rEnc.hash);
      await service.putNode(keyR, rEnc.bytes);

      const infoBefore = await service.info();
      expect(infoBefore.nodeCount).toBe(2);
      expect(infoBefore.totalBytes).toBeGreaterThan(0);
      expect(infoBefore.lastGcTime).toBeUndefined();

      await service.gc([keyR], Date.now() + 10_000);

      const infoAfter = await service.info();
      expect(infoAfter.lastGcTime).toBeDefined();
      expect(infoAfter.nodeCount).toBe(2);
      expect(infoAfter.totalBytes).toBe(infoBefore.totalBytes);
    });

    it("info() returns lastGcTime and nodeCount after gc", async () => {
      const keyProvider = createKeyProvider();
      const enc = await encodeDictNode({ children: [], childNames: [] }, keyProvider);
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
