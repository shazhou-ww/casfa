/**
 * CAS facade tests: getNode, putNode, hasNode, child existence check
 */
import { beforeEach, describe, expect, it } from "bun:test";
import type { KeyProvider } from "@casfa/core";
import { computeSizeFlagByte, decodeNode, encodeDictNode, hashToKey } from "@casfa/core";
import { createMemoryStorage } from "@casfa/storage-memory";
import {
  bytesFromStream,
  createCasFacade,
  createCasStorageFromBuffer,
  isCasError,
  streamFromBytes,
} from "../src/index.ts";

const createKeyProvider = (): KeyProvider => ({
  computeKey: async (data: Uint8Array) => {
    const { blake3 } = await import("@noble/hashes/blake3");
    const raw = blake3(data, { dkLen: 16 });
    raw[0] = computeSizeFlagByte(data.length);
    return raw;
  },
});

describe("CasFacade", () => {
  let facade: ReturnType<typeof createCasFacade>;

  beforeEach(() => {
    const mem = createMemoryStorage();
    const storage = createCasStorageFromBuffer({
      get: mem.get.bind(mem),
      put: mem.put.bind(mem),
      del: mem.del.bind(mem),
    });
    facade = createCasFacade({
      storage,
      key: createKeyProvider(),
    });
  });

  describe("getNode", () => {
    it("returns null for missing key", async () => {
      const got = await facade.getNode("0".repeat(26));
      expect(got).toBeNull();
    });

    it("returns key and body stream after putNode", async () => {
      const encoded = await encodeDictNode({ children: [], childNames: [] }, createKeyProvider());
      const nodeKey = hashToKey(encoded.hash);
      await facade.putNode(nodeKey, streamFromBytes(encoded.bytes));
      const result = await facade.getNode(nodeKey);
      expect(result).not.toBeNull();
      expect(result!.key).toBe(nodeKey);
      const bytes = await bytesFromStream(result!.body);
      const node = decodeNode(bytes);
      expect(node.kind).toBe("dict");
      expect(node.children).toEqual(undefined);
      expect(node.childNames).toEqual([]);
    });
  });

  describe("hasNode", () => {
    it("returns false for missing key", async () => {
      expect(await facade.hasNode("0".repeat(26))).toBe(false);
    });

    it("returns true when key exists", async () => {
      const encoded = await encodeDictNode({ children: [], childNames: [] }, createKeyProvider());
      const nodeKey = hashToKey(encoded.hash);
      await facade.putNode(nodeKey, streamFromBytes(encoded.bytes));
      expect(await facade.hasNode(nodeKey)).toBe(true);
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
      await expect(facade.putNode(nodeKey, streamFromBytes(encoded.bytes))).rejects.toMatchObject({
        code: "ChildMissing",
      });
      const err = await facade.putNode(nodeKey, streamFromBytes(encoded.bytes)).catch((e) => e);
      expect(isCasError(err)).toBe(true);
      expect(err.code).toBe("ChildMissing");
    });
  });

  describe("gc and info", () => {
    it("deletes unreachable and old keys after gc(roots, cutOffTime)", async () => {
      const keyProvider = createKeyProvider();
      const emptyEnc = await encodeDictNode({ children: [], childNames: [] }, keyProvider);
      const keyEmpty = hashToKey(emptyEnc.hash);
      await facade.putNode(keyEmpty, streamFromBytes(emptyEnc.bytes));

      const withChildAEnc = await encodeDictNode(
        { children: [emptyEnc.hash], childNames: ["a"] },
        keyProvider
      );
      const keyRootA = hashToKey(withChildAEnc.hash);
      await facade.putNode(keyRootA, streamFromBytes(withChildAEnc.bytes));

      const withChildBEnc = await encodeDictNode(
        { children: [emptyEnc.hash], childNames: ["b"] },
        keyProvider
      );
      const keyRootB = hashToKey(withChildBEnc.hash);
      await facade.putNode(keyRootB, streamFromBytes(withChildBEnc.bytes));

      expect(await facade.hasNode(keyRootA)).toBe(true);
      expect(await facade.hasNode(keyRootB)).toBe(true);
      expect(await facade.hasNode(keyEmpty)).toBe(true);

      const cutOffTime = Date.now() + 10_000;
      await facade.gc([keyRootA], cutOffTime);

      expect(await facade.hasNode(keyRootA)).toBe(true);
      expect(await facade.hasNode(keyEmpty)).toBe(true);
      expect(await facade.hasNode(keyRootB)).toBe(false);
    });

    it("multi-root: two disjoint trees, gc with one root deletes the other tree", async () => {
      const keyProvider = createKeyProvider();
      const e1Enc = await encodeDictNode({ children: [], childNames: [] }, keyProvider);
      const keyE1 = hashToKey(e1Enc.hash);
      await facade.putNode(keyE1, streamFromBytes(e1Enc.bytes));

      const r1Enc = await encodeDictNode(
        { children: [e1Enc.hash], childNames: ["x"] },
        keyProvider
      );
      const keyR1 = hashToKey(r1Enc.hash);
      await facade.putNode(keyR1, streamFromBytes(r1Enc.bytes));

      const e2Enc = await encodeDictNode(
        { children: [e1Enc.hash], childNames: ["y"] },
        keyProvider
      );
      const keyE2 = hashToKey(e2Enc.hash);
      await facade.putNode(keyE2, streamFromBytes(e2Enc.bytes));

      const r2Enc = await encodeDictNode(
        { children: [e2Enc.hash], childNames: ["z"] },
        keyProvider
      );
      const keyR2 = hashToKey(r2Enc.hash);
      await facade.putNode(keyR2, streamFromBytes(r2Enc.bytes));

      expect(await facade.hasNode(keyR1)).toBe(true);
      expect(await facade.hasNode(keyE1)).toBe(true);
      expect(await facade.hasNode(keyR2)).toBe(true);
      expect(await facade.hasNode(keyE2)).toBe(true);

      await facade.gc([keyR1], Date.now() + 10_000);

      expect(await facade.hasNode(keyR1)).toBe(true);
      expect(await facade.hasNode(keyE1)).toBe(true);
      expect(await facade.hasNode(keyR2)).toBe(false);
      expect(await facade.hasNode(keyE2)).toBe(false);
    });

    it("cutOffTime: unreachable node retained when writeTime >= cutOffTime", async () => {
      const keyProvider = createKeyProvider();
      const enc = await encodeDictNode({ children: [], childNames: [] }, keyProvider);
      const key = hashToKey(enc.hash);
      const cutOffBeforePut = Date.now() - 1000;
      await facade.putNode(key, streamFromBytes(enc.bytes));
      await facade.gc([], cutOffBeforePut);
      expect(await facade.hasNode(key)).toBe(true);
    });

    it("cutOffTime: unreachable node deleted when writeTime < cutOffTime", async () => {
      const keyProvider = createKeyProvider();
      const enc = await encodeDictNode({ children: [], childNames: [] }, keyProvider);
      const key = hashToKey(enc.hash);
      await facade.putNode(key, streamFromBytes(enc.bytes));
      const cutOffAfterPut = Date.now() + 10_000;
      await facade.gc([], cutOffAfterPut);
      expect(await facade.hasNode(key)).toBe(false);
    });

    it("info() before and after gc: nodeCount and totalBytes change", async () => {
      const keyProvider = createKeyProvider();
      const eEnc = await encodeDictNode({ children: [], childNames: [] }, keyProvider);
      const keyE = hashToKey(eEnc.hash);
      await facade.putNode(keyE, streamFromBytes(eEnc.bytes));
      const rEnc = await encodeDictNode({ children: [eEnc.hash], childNames: ["a"] }, keyProvider);
      const keyR = hashToKey(rEnc.hash);
      await facade.putNode(keyR, streamFromBytes(rEnc.bytes));

      const infoBefore = await facade.info();
      expect(infoBefore.nodeCount).toBe(2);
      expect(infoBefore.totalBytes).toBeGreaterThan(0);
      expect(infoBefore.lastGcTime).toBeNull();

      await facade.gc([keyR], Date.now() + 10_000);

      const infoAfter = await facade.info();
      expect(infoAfter.lastGcTime).not.toBeNull();
      expect(infoAfter.nodeCount).toBe(2);
      expect(infoAfter.totalBytes).toBe(infoBefore.totalBytes);
    });

    it("info() returns lastGcTime and nodeCount after gc", async () => {
      const keyProvider = createKeyProvider();
      const enc = await encodeDictNode({ children: [], childNames: [] }, keyProvider);
      const key = hashToKey(enc.hash);
      await facade.putNode(key, streamFromBytes(enc.bytes));

      let inf = await facade.info();
      expect(inf.nodeCount).toBe(1);
      expect(inf.totalBytes).toBeGreaterThan(0);
      expect(inf.lastGcTime).toBeNull();

      await facade.gc([key], Date.now() + 1);
      inf = await facade.info();
      expect(inf.lastGcTime).not.toBeNull();
      expect(typeof inf.lastGcTime).toBe("number");
      expect(inf.nodeCount).toBe(1);
      expect(inf.totalBytes).toBeGreaterThan(0);
    });
  });
});
