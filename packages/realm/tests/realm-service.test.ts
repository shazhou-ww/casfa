/**
 * RealmFacade tests: getRootDelegate, getNode, putNode, commit, createChildDelegate, close, info.
 */
import { describe, expect, it } from "bun:test";
import {
  bytesFromStream,
  createCasService,
  createCasStorageFromBuffer,
  streamFromBytes,
} from "@casfa/cas";
import type { KeyProvider } from "@casfa/core";
import { computeSizeFlagByte, decodeNode, encodeDictNode, hashToKey } from "@casfa/core";
import { createMemoryStorage } from "@casfa/storage-memory";
import { createMemoryDelegateStore } from "../src/memory-delegate-store.ts";
import { createRealmFacade } from "../src/realm-facade.ts";

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

describe("RealmFacade", () => {
  it("getRootDelegate returns limited DelegateFacade; getNode, putNode, commit, createChildDelegate, close work", async () => {
    const mem = createMemoryStorage();
    const storage = createCasStorageFromBuffer({
      get: mem.get.bind(mem),
      put: mem.put.bind(mem),
      del: mem.del.bind(mem),
    });
    const keyProvider = createKeyProvider();
    const cas = createCasService({ storage, key: keyProvider });
    const delegateStore = createMemoryDelegateStore();
    const realm = createRealmFacade({ cas, delegateStore, key: keyProvider });

    const facade = await realm.getRootDelegate("r1", { ttl: 3600_000 });
    expect(facade.delegateId).toBeDefined();
    expect(facade.lifetime).toBe("limited");
    expect((facade as { expiresAt: number }).expiresAt).toBeGreaterThan(Date.now());

    const result = await facade.getNode("");
    expect(result).not.toBeNull();
    const rootBytes = await bytesFromStream(result!.body);
    const rootNode = decodeNode(rootBytes);
    expect(rootNode.kind).toBe("dict");

    const emptyEnc = await encodeDictNode({ children: [], childNames: [] }, keyProvider);
    const childKey = hashToKey(emptyEnc.hash);
    await facade.putNode(childKey, streamFromBytes(emptyEnc.bytes));
    const rootEnc = await encodeDictNode(
      { children: [emptyEnc.hash], childNames: ["a"] },
      keyProvider
    );
    const newRootKey = hashToKey(rootEnc.hash);
    await facade.putNode(newRootKey, streamFromBytes(rootEnc.bytes));
    await facade.commit(newRootKey, result!.key);

    const atA = await facade.getNode("a");
    expect(atA).not.toBeNull();
    const childFacade = await facade.createChildDelegate("a", { ttl: 1000 });
    expect(childFacade.delegateId).not.toBe(facade.delegateId);
    expect(childFacade.lifetime).toBe("limited");
    await childFacade.close();

    const info = await realm.info("r1");
    expect(info.delegateCount).toBeGreaterThanOrEqual(1);
    expect(info.nodeCount).toBeGreaterThanOrEqual(1);
  });
});
