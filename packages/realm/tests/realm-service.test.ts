/**
 * RealmService tests: getNode, hasNode, putNode with path resolution.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { createCasService } from "@casfa/cas";
import type { CasStorage } from "@casfa/cas";
import type { KeyProvider } from "@casfa/core";
import { computeSizeFlagByte, encodeDictNode, hashToKey } from "@casfa/core";
import { createMemoryStorage } from "@casfa/storage-memory";
import { RealmService } from "../src/realm-service.ts";
import type { Depot, DepotStore } from "../src/types.ts";

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

function createMemoryDepotStore(): DepotStore {
  const depots = new Map<string, Depot>();
  const roots = new Map<string, string>();
  return {
    getDepot: async (depotId) => depots.get(depotId) ?? null,
    getRoot: async (depotId) => roots.get(depotId) ?? null,
    setRoot: async (depotId, nodeKey) => {
      roots.set(depotId, nodeKey);
    },
    listDepots: async (realmId) =>
      [...depots.values()].filter((d) => d.realmId === realmId),
    insertDepot: async (depot) => {
      depots.set(depot.depotId, depot);
    },
    removeDepot: async (depotId) => {
      depots.delete(depotId);
      roots.delete(depotId);
    },
  };
}

describe("RealmService", () => {
  it("instantiates with in-memory CAS and DepotStore", () => {
    const mem = createMemoryStorage();
    const storage: CasStorage = {
      get: mem.get.bind(mem),
      put: mem.put.bind(mem),
      del: mem.del.bind(mem),
    };
    const cas = createCasService({ storage, key: createKeyProvider() });
    const depotStore = createMemoryDepotStore();
    const service = new RealmService({ cas, depotStore });
    expect(service).toBeDefined();
    expect(service.cas).toBe(cas);
    expect(service.depotStore).toBe(depotStore);
  });

  describe("getNode, hasNode, putNode", () => {
    let service: RealmService;
    let cas: ReturnType<typeof createCasService>;
    let depotStore: DepotStore;
    const MAIN_DEPOT_ID = "main";
    const REALM_ID = "r1";

    beforeEach(async () => {
      const mem = createMemoryStorage();
      const storage: CasStorage = {
        get: mem.get.bind(mem),
        put: mem.put.bind(mem),
        del: mem.del.bind(mem),
      };
      const keyProvider = createKeyProvider();
      cas = createCasService({ storage, key: keyProvider });
      depotStore = createMemoryDepotStore();
      service = new RealmService({ cas, depotStore });

      // Root = d-node with entry "a" pointing to an empty dict
      const emptyEnc = await encodeDictNode(
        { children: [], childNames: [] },
        keyProvider
      );
      const childKey = hashToKey(emptyEnc.hash);
      await cas.putNode(childKey, emptyEnc.bytes);

      const rootEnc = await encodeDictNode(
        { children: [emptyEnc.hash], childNames: ["a"] },
        keyProvider
      );
      const rootKey = hashToKey(rootEnc.hash);
      await cas.putNode(rootKey, rootEnc.bytes);

      await depotStore.insertDepot({
        depotId: MAIN_DEPOT_ID,
        realmId: REALM_ID,
        parentId: null,
        mountPath: [],
      });
      await depotStore.setRoot(MAIN_DEPOT_ID, rootKey);
    });

    it("getNode(main, 'a') resolves path and returns child node", async () => {
      const node = await service.getNode(MAIN_DEPOT_ID, "a");
      expect(node).not.toBeNull();
      expect(node!.kind).toBe("dict");
      expect(node!.childNames).toEqual([]);
      expect(node!.children).toEqual(undefined);
    });

    it("getNode(main, ['a']) with array path returns same child", async () => {
      const node = await service.getNode(MAIN_DEPOT_ID, ["a"]);
      expect(node).not.toBeNull();
      expect(node!.kind).toBe("dict");
    });

    it("hasNode(main, 'b') is false", async () => {
      expect(await service.hasNode(MAIN_DEPOT_ID, "b")).toBe(false);
    });

    it("hasNode(main, 'a') is true", async () => {
      expect(await service.hasNode(MAIN_DEPOT_ID, "a")).toBe(true);
    });

    it("putNode(nodeKey, data) delegates to CAS.putNode", async () => {
      const keyProvider = createKeyProvider();
      const enc = await encodeDictNode(
        { children: [], childNames: [] },
        keyProvider
      );
      const nodeKey = hashToKey(enc.hash);
      await service.putNode(nodeKey, enc.bytes);
      const got = await cas.getNode(nodeKey);
      expect(got).not.toBeNull();
      expect(got!.kind).toBe("dict");
    });

    it("getNode(main, 'a/b') resolves nested path when root has a -> dict with 'b'", async () => {
      const keyProvider = createKeyProvider();
      const leafEnc = await encodeDictNode(
        { children: [], childNames: [] },
        keyProvider
      );
      const leafKey = hashToKey(leafEnc.hash);
      await cas.putNode(leafKey, leafEnc.bytes);

      const innerEnc = await encodeDictNode(
        { children: [leafEnc.hash], childNames: ["b"] },
        keyProvider
      );
      const innerKey = hashToKey(innerEnc.hash);
      await cas.putNode(innerKey, innerEnc.bytes);

      const rootEnc = await encodeDictNode(
        { children: [innerEnc.hash], childNames: ["a"] },
        keyProvider
      );
      const rootKey = hashToKey(rootEnc.hash);
      await cas.putNode(rootKey, rootEnc.bytes);
      await depotStore.setRoot(MAIN_DEPOT_ID, rootKey);

      const node = await service.getNode(MAIN_DEPOT_ID, "a/b");
      expect(node).not.toBeNull();
      expect(node!.kind).toBe("dict");
      expect(node!.childNames).toEqual([]);
    });
  });
});
