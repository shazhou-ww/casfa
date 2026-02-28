/**
 * RealmService tests: getNode, hasNode, putNode, createDepot, commitDepot.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { createCasService } from "@casfa/cas";
import type { CasStorage } from "@casfa/cas";
import type { KeyProvider } from "@casfa/core";
import { computeSizeFlagByte, encodeDictNode, hashToKey } from "@casfa/core";
import { createMemoryStorage } from "@casfa/storage-memory";
import { RealmError } from "../src/errors.ts";
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
    updateDepotPath: async (depotId, newPath) => {
      const d = depots.get(depotId);
      if (d) depots.set(depotId, { ...d, mountPath: newPath });
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

  describe("createDepot", () => {
    let service: RealmService;
    let cas: ReturnType<typeof createCasService>;
    let depotStore: DepotStore;
    const PARENT_ID = "parent";
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

      // Parent root = dict with "foo" -> child dict
      const childEnc = await encodeDictNode(
        { children: [], childNames: [] },
        keyProvider
      );
      const childKey = hashToKey(childEnc.hash);
      await cas.putNode(childKey, childEnc.bytes);

      const rootEnc = await encodeDictNode(
        { children: [childEnc.hash], childNames: ["foo"] },
        keyProvider
      );
      const rootKey = hashToKey(rootEnc.hash);
      await cas.putNode(rootKey, rootEnc.bytes);

      await depotStore.insertDepot({
        depotId: PARENT_ID,
        realmId: REALM_ID,
        parentId: null,
        mountPath: [],
      });
      await depotStore.setRoot(PARENT_ID, rootKey);
    });

    it("createDepot(parent, path) resolves path from parent root; new depot getRoot returns child key; parentId and mountPath set", async () => {
      const newDepot = await service.createDepot(PARENT_ID, "foo");
      expect(newDepot).toBeDefined();
      expect(newDepot.parentId).toBe(PARENT_ID);
      expect(newDepot.realmId).toBe(REALM_ID);
      expect(newDepot.mountPath).toBe("foo");

      const newRootKey = await depotStore.getRoot(newDepot.depotId);
      expect(newRootKey).not.toBeNull();
      const parentRootKey = await depotStore.getRoot(PARENT_ID);
      expect(parentRootKey).not.toBeNull();
      const parentRoot = await cas.getNode(parentRootKey!);
      expect(parentRoot).not.toBeNull();
      const childKeyFromParent = parentRoot!.childNames?.indexOf("foo") >= 0
        ? hashToKey(parentRoot!.children![parentRoot!.childNames!.indexOf("foo")!]!)
        : null;
      expect(childKeyFromParent).not.toBeNull();
      expect(newRootKey).toBe(childKeyFromParent);
    });
  });

  describe("commitDepot", () => {
    let service: RealmService;
    let depotStore: DepotStore;
    let cas: ReturnType<typeof createCasService>;
    const DEPOT_ID = "d1";
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

      const enc = await encodeDictNode(
        { children: [], childNames: [] },
        keyProvider
      );
      const oldRootKey = hashToKey(enc.hash);
      await cas.putNode(oldRootKey, enc.bytes);

      await depotStore.insertDepot({
        depotId: DEPOT_ID,
        realmId: REALM_ID,
        parentId: null,
        mountPath: [],
      });
      await depotStore.setRoot(DEPOT_ID, oldRootKey);
    });

    it("commitDepot(depot, newRoot, oldRoot) when current root === oldRoot sets root to newRoot", async () => {
      const keyProvider = createKeyProvider();
      const newEnc = await encodeDictNode(
        { children: [], childNames: [] },
        keyProvider
      );
      const newRootKey = hashToKey(newEnc.hash);
      await cas.putNode(newRootKey, newEnc.bytes);

      const oldRootKey = await depotStore.getRoot(DEPOT_ID);
      expect(oldRootKey).not.toBeNull();

      await service.commitDepot(DEPOT_ID, newRootKey!, oldRootKey!);

      const current = await depotStore.getRoot(DEPOT_ID);
      expect(current).toBe(newRootKey);
    });

    it("commitDepot(depot, newRoot, oldRoot) when current root !== oldRoot throws RealmError CommitConflict", async () => {
      const keyProvider = createKeyProvider();
      const newEnc = await encodeDictNode(
        { children: [], childNames: [] },
        keyProvider
      );
      const newRootKey = hashToKey(newEnc.hash);
      await cas.putNode(newRootKey, newEnc.bytes);

      const wrongOldRoot = "wrong-key-16-bytes!!"; // not current root

      const err = await service.commitDepot(DEPOT_ID, newRootKey, wrongOldRoot).catch((e) => e);
      expect(err).toBeInstanceOf(RealmError);
      expect((err as RealmError).code).toBe("CommitConflict");
    });
  });
});
