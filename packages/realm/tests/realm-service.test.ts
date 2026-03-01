/**
 * RealmService tests: getNode, hasNode, putNode, createDepot, commitDepot.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import type { CasStorage } from "@casfa/cas";
import { createCasService } from "@casfa/cas";
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
    listDepots: async (realmId) => [...depots.values()].filter((d) => d.realmId === realmId),
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
    const keyProvider = createKeyProvider();
    const cas = createCasService({ storage, key: keyProvider });
    const depotStore = createMemoryDepotStore();
    const service = new RealmService({ cas, depotStore, key: keyProvider, storage: mem });
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
      service = new RealmService({ cas, depotStore, key: keyProvider, storage: mem });

      // Root = d-node with entry "a" pointing to an empty dict
      const emptyEnc = await encodeDictNode({ children: [], childNames: [] }, keyProvider);
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
      const enc = await encodeDictNode({ children: [], childNames: [] }, keyProvider);
      const nodeKey = hashToKey(enc.hash);
      await service.putNode(nodeKey, enc.bytes);
      const got = await cas.getNode(nodeKey);
      expect(got).not.toBeNull();
      expect(got!.kind).toBe("dict");
    });

    it("getNode(main, 'a/b') resolves nested path when root has a -> dict with 'b'", async () => {
      const keyProvider = createKeyProvider();
      const leafEnc = await encodeDictNode({ children: [], childNames: [] }, keyProvider);
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
      service = new RealmService({ cas, depotStore, key: keyProvider, storage: mem });

      // Parent root = dict with "foo" -> child dict
      const childEnc = await encodeDictNode({ children: [], childNames: [] }, keyProvider);
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
      const idx = parentRoot!.childNames?.indexOf("foo");
      const childKeyFromParent =
        idx !== undefined && idx >= 0 ? hashToKey(parentRoot!.children![idx]!) : null;
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
      service = new RealmService({ cas, depotStore, key: keyProvider, storage: mem });

      const enc = await encodeDictNode({ children: [], childNames: [] }, keyProvider);
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
      const newEnc = await encodeDictNode({ children: [], childNames: [] }, keyProvider);
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
      const newEnc = await encodeDictNode({ children: [], childNames: [] }, keyProvider);
      const newRootKey = hashToKey(newEnc.hash);
      await cas.putNode(newRootKey, newEnc.bytes);

      const wrongOldRoot = "wrong-key-16-bytes!!"; // not current root

      const err = await service.commitDepot(DEPOT_ID, newRootKey, wrongOldRoot).catch((e) => e);
      expect(err).toBeInstanceOf(RealmError);
      expect((err as RealmError).code).toBe("CommitConflict");
    });

    it("after parent commit that moves node foo->bar, child depot mountPath is updated via dag-diff", async () => {
      const keyProvider = createKeyProvider();
      const mem = createMemoryStorage();
      const storage: CasStorage = {
        get: mem.get.bind(mem),
        put: mem.put.bind(mem),
        del: mem.del.bind(mem),
      };
      const cas = createCasService({ storage, key: keyProvider });
      const depotStore = createMemoryDepotStore();
      const realm = new RealmService({ cas, depotStore, key: keyProvider, storage: mem });
      const REALM_ID = "r1";
      const PARENT_ID = "parent";

      // Empty dict (child root)
      const childEnc = await encodeDictNode({ children: [], childNames: [] }, keyProvider);
      const childKey = hashToKey(childEnc.hash);
      await cas.putNode(childKey, childEnc.bytes);

      // Old parent root: dict with "foo" -> childKey
      const oldRootEnc = await encodeDictNode(
        { children: [childEnc.hash], childNames: ["foo"] },
        keyProvider
      );
      const oldRootKey = hashToKey(oldRootEnc.hash);
      await cas.putNode(oldRootKey, oldRootEnc.bytes);

      // New parent root: dict with "bar" -> same childKey (move only)
      const newRootEnc = await encodeDictNode(
        { children: [childEnc.hash], childNames: ["bar"] },
        keyProvider
      );
      const newRootKey = hashToKey(newRootEnc.hash);
      await cas.putNode(newRootKey, newRootEnc.bytes);

      await depotStore.insertDepot({
        depotId: PARENT_ID,
        realmId: REALM_ID,
        parentId: null,
        mountPath: [],
      });
      await depotStore.setRoot(PARENT_ID, oldRootKey);

      const childDepot = await realm.createDepot(PARENT_ID, "foo");
      expect(childDepot.mountPath).toBe("foo");

      await realm.commitDepot(PARENT_ID, newRootKey, oldRootKey);

      const updated = await depotStore.getDepot(childDepot.depotId);
      expect(updated).not.toBeNull();
      expect(updated!.mountPath).toBe("bar");
    });
  });

  describe("closeDepot", () => {
    let service: RealmService;
    let cas: ReturnType<typeof createCasService>;
    let depotStore: DepotStore;
    let keyProvider: ReturnType<typeof createKeyProvider>;
    const PARENT_ID = "parent";
    const REALM_ID = "r1";

    beforeEach(async () => {
      const mem = createMemoryStorage();
      const storage: CasStorage = {
        get: mem.get.bind(mem),
        put: mem.put.bind(mem),
        del: mem.del.bind(mem),
      };
      keyProvider = createKeyProvider();
      cas = createCasService({ storage, key: keyProvider });
      depotStore = createMemoryDepotStore();
      service = new RealmService({ cas, depotStore, key: keyProvider, storage: mem });

      // Parent root = d-node with "foo" -> child dict (empty)
      const childEnc = await encodeDictNode({ children: [], childNames: [] }, keyProvider);
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

    it("closeDepot(child) writes child root back to parent at mountPath then removes child", async () => {
      const childDepot = await service.createDepot(PARENT_ID, "foo");
      const childDepotId = childDepot.depotId;

      // Change child's root: put a different node (dict with "x" entry) and setRoot
      const leafEnc = await encodeDictNode({ children: [], childNames: [] }, keyProvider);
      const leafKey = hashToKey(leafEnc.hash);
      await cas.putNode(leafKey, leafEnc.bytes);
      const newChildRootEnc = await encodeDictNode(
        { children: [leafEnc.hash], childNames: ["x"] },
        keyProvider
      );
      const newChildRootKey = hashToKey(newChildRootEnc.hash);
      await cas.putNode(newChildRootKey, newChildRootEnc.bytes);
      await depotStore.setRoot(childDepotId, newChildRootKey);

      const parentRootBefore = await depotStore.getRoot(PARENT_ID);
      expect(parentRootBefore).not.toBeNull();

      await service.closeDepot(childDepotId);

      // Parent's root should now be a new dict where "foo" points to child's current root
      const parentRootAfter = await depotStore.getRoot(PARENT_ID);
      expect(parentRootAfter).not.toBeNull();
      expect(parentRootAfter).not.toBe(parentRootBefore);
      const parentRootNode = await cas.getNode(parentRootAfter!);
      expect(parentRootNode).not.toBeNull();
      expect(parentRootNode!.kind).toBe("dict");
      const fooIdx = parentRootNode!.childNames!.indexOf("foo");
      expect(fooIdx).toBeGreaterThanOrEqual(0);
      const fooKey = hashToKey(parentRootNode!.children![fooIdx]!);
      expect(fooKey).toBe(newChildRootKey);

      // Child depot should be removed or closed
      const depot = await depotStore.getDepot(childDepotId);
      expect(depot).toBeNull();
    });
  });

  describe("gc", () => {
    it("collects all depot roots from listDepots, dedupes, and calls CAS.gc(roots, cutOffTime)", async () => {
      const mem = createMemoryStorage();
      const storage: CasStorage = {
        get: mem.get.bind(mem),
        put: mem.put.bind(mem),
        del: mem.del.bind(mem),
      };
      const keyProvider = createKeyProvider();
      const cas = createCasService({ storage, key: keyProvider });
      const depotStore = createMemoryDepotStore();
      const service = new RealmService({ cas, depotStore, key: keyProvider, storage: mem });
      const REALM_ID = "r1";

      // Root A (depot1 and depot2 share this root - dedupe)
      const encA = await encodeDictNode({ children: [], childNames: [] }, keyProvider);
      const rootKeyA = hashToKey(encA.hash);
      await cas.putNode(rootKeyA, encA.bytes);

      // Orphan node (different content so different key; not reachable from any depot)
      const encChild = await encodeDictNode({ children: [], childNames: [] }, keyProvider);
      await cas.putNode(hashToKey(encChild.hash), encChild.bytes);
      const encOrphan = await encodeDictNode(
        { children: [encChild.hash], childNames: ["x"] },
        keyProvider
      );
      const orphanKey = hashToKey(encOrphan.hash);
      await cas.putNode(orphanKey, encOrphan.bytes);

      await depotStore.insertDepot({
        depotId: "d1",
        realmId: REALM_ID,
        parentId: null,
        mountPath: [],
      });
      await depotStore.setRoot("d1", rootKeyA);
      await depotStore.insertDepot({
        depotId: "d2",
        realmId: REALM_ID,
        parentId: null,
        mountPath: [],
      });
      await depotStore.setRoot("d2", rootKeyA); // same root -> dedupe

      expect(await cas.hasNode(orphanKey)).toBe(true);

      const cutOffTime = Date.now() + 60_000; // future so all nodes have time < cutOffTime
      await service.gc(REALM_ID, cutOffTime);

      // Orphan should be collected
      expect(await cas.hasNode(orphanKey)).toBe(false);
      // Depot roots and reachable nodes still present
      expect(await cas.hasNode(rootKeyA)).toBe(true);
    });

    it("gc with multiple depots with different roots keeps all reachable nodes", async () => {
      const mem = createMemoryStorage();
      const storage: CasStorage = {
        get: mem.get.bind(mem),
        put: mem.put.bind(mem),
        del: mem.del.bind(mem),
      };
      const keyProvider = createKeyProvider();
      const cas = createCasService({ storage, key: keyProvider });
      const depotStore = createMemoryDepotStore();
      const service = new RealmService({ cas, depotStore, key: keyProvider, storage: mem });
      const REALM_ID = "r1";

      const enc1 = await encodeDictNode({ children: [], childNames: [] }, keyProvider);
      const root1 = hashToKey(enc1.hash);
      await cas.putNode(root1, enc1.bytes);

      const enc2 = await encodeDictNode({ children: [], childNames: [] }, keyProvider);
      const root2 = hashToKey(enc2.hash);
      await cas.putNode(root2, enc2.bytes);

      await depotStore.insertDepot({
        depotId: "d1",
        realmId: REALM_ID,
        parentId: null,
        mountPath: [],
      });
      await depotStore.setRoot("d1", root1);
      await depotStore.insertDepot({
        depotId: "d2",
        realmId: REALM_ID,
        parentId: null,
        mountPath: [],
      });
      await depotStore.setRoot("d2", root2);

      await service.gc(REALM_ID, Date.now() + 60_000);

      expect(await cas.hasNode(root1)).toBe(true);
      expect(await cas.hasNode(root2)).toBe(true);
    });
  });

  describe("info", () => {
    it("returns CAS.info() and optionally depotCount when realmId provided", async () => {
      const mem = createMemoryStorage();
      const storage: CasStorage = {
        get: mem.get.bind(mem),
        put: mem.put.bind(mem),
        del: mem.del.bind(mem),
      };
      const keyProvider = createKeyProvider();
      const cas = createCasService({ storage, key: keyProvider });
      const depotStore = createMemoryDepotStore();
      const service = new RealmService({ cas, depotStore, key: keyProvider, storage: mem });
      const REALM_ID = "r1";

      const enc = await encodeDictNode({ children: [], childNames: [] }, keyProvider);
      const rootKey = hashToKey(enc.hash);
      await cas.putNode(rootKey, enc.bytes);

      await depotStore.insertDepot({
        depotId: "d1",
        realmId: REALM_ID,
        parentId: null,
        mountPath: [],
      });
      await depotStore.setRoot("d1", rootKey);
      await depotStore.insertDepot({
        depotId: "d2",
        realmId: REALM_ID,
        parentId: null,
        mountPath: [],
      });
      await depotStore.setRoot("d2", rootKey);

      const infoWithoutRealm = await service.info();
      expect(infoWithoutRealm).toHaveProperty("nodeCount");
      expect(infoWithoutRealm).toHaveProperty("totalBytes");
      expect((infoWithoutRealm as { nodeCount: number }).nodeCount).toBeGreaterThanOrEqual(1);
      expect((infoWithoutRealm as { depotCount?: number }).depotCount).toBeUndefined();

      const infoWithRealm = await service.info(REALM_ID);
      expect(infoWithRealm).toHaveProperty("nodeCount");
      expect(infoWithRealm).toHaveProperty("totalBytes");
      expect((infoWithRealm as { depotCount?: number }).depotCount).toBe(2);
    });
  });
});
