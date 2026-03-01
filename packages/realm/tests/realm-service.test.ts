/**
 * RealmService tests: getNode, hasNode, putNode, createDepot, commitDepot.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import {
  bytesFromStream,
  createCasService,
  createCasStorageFromBuffer,
  streamFromBytes,
} from "@casfa/cas";
import type { KeyProvider } from "@casfa/core";
import { computeSizeFlagByte, decodeNode, encodeDictNode, hashToKey } from "@casfa/core";
import { createMemoryStorage } from "@casfa/storage-memory";
import { isRealmError } from "../src/errors.ts";
import { createMemoryDelegateStore } from "../src/memory-delegate-store.ts";
import { createRealmFacade } from "../src/realm-facade.ts";
import type { Depot, DepotStore } from "../src/realm-legacy-types.ts";
import type { RealmService } from "../src/realm-service.ts";
import { createRealmService } from "../src/realm-service.ts";

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
    const storage = createCasStorageFromBuffer({
      get: mem.get.bind(mem),
      put: mem.put.bind(mem),
      del: mem.del.bind(mem),
    });
    const keyProvider = createKeyProvider();
    const cas = createCasService({ storage, key: keyProvider });
    const depotStore = createMemoryDepotStore();
    const service = createRealmService({ cas, depotStore, key: keyProvider, storage: mem });
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
      const storage = createCasStorageFromBuffer({
        get: mem.get.bind(mem),
        put: mem.put.bind(mem),
        del: mem.del.bind(mem),
      });
      const keyProvider = createKeyProvider();
      cas = createCasService({ storage, key: keyProvider });
      depotStore = createMemoryDepotStore();
      service = createRealmService({ cas, depotStore, key: keyProvider, storage: mem });

      // Root = d-node with entry "a" pointing to an empty dict
      const emptyEnc = await encodeDictNode({ children: [], childNames: [] }, keyProvider);
      const childKey = hashToKey(emptyEnc.hash);
      await cas.putNode(childKey, streamFromBytes(emptyEnc.bytes));

      const rootEnc = await encodeDictNode(
        { children: [emptyEnc.hash], childNames: ["a"] },
        keyProvider
      );
      const rootKey = hashToKey(rootEnc.hash);
      await cas.putNode(rootKey, streamFromBytes(rootEnc.bytes));

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
      const result = await cas.getNode(nodeKey);
      expect(result).not.toBeNull();
      const node = decodeNode(await bytesFromStream(result!.body));
      expect(node.kind).toBe("dict");
    });

    it("getNode(main, 'a/b') resolves nested path when root has a -> dict with 'b'", async () => {
      const keyProvider = createKeyProvider();
      const leafEnc = await encodeDictNode({ children: [], childNames: [] }, keyProvider);
      const leafKey = hashToKey(leafEnc.hash);
      await cas.putNode(leafKey, streamFromBytes(leafEnc.bytes));

      const innerEnc = await encodeDictNode(
        { children: [leafEnc.hash], childNames: ["b"] },
        keyProvider
      );
      const innerKey = hashToKey(innerEnc.hash);
      await cas.putNode(innerKey, streamFromBytes(innerEnc.bytes));

      const rootEnc = await encodeDictNode(
        { children: [innerEnc.hash], childNames: ["a"] },
        keyProvider
      );
      const rootKey = hashToKey(rootEnc.hash);
      await cas.putNode(rootKey, streamFromBytes(rootEnc.bytes));
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
      const storage = createCasStorageFromBuffer({
        get: mem.get.bind(mem),
        put: mem.put.bind(mem),
        del: mem.del.bind(mem),
      });
      const keyProvider = createKeyProvider();
      cas = createCasService({ storage, key: keyProvider });
      depotStore = createMemoryDepotStore();
      service = createRealmService({ cas, depotStore, key: keyProvider, storage: mem });

      // Parent root = dict with "foo" -> child dict
      const childEnc = await encodeDictNode({ children: [], childNames: [] }, keyProvider);
      const childKey = hashToKey(childEnc.hash);
      await cas.putNode(childKey, streamFromBytes(childEnc.bytes));

      const rootEnc = await encodeDictNode(
        { children: [childEnc.hash], childNames: ["foo"] },
        keyProvider
      );
      const rootKey = hashToKey(rootEnc.hash);
      await cas.putNode(rootKey, streamFromBytes(rootEnc.bytes));

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
      const parentRootResult = await cas.getNode(parentRootKey!);
      expect(parentRootResult).not.toBeNull();
      const parentRoot = decodeNode(await bytesFromStream(parentRootResult!.body));
      const idx = parentRoot.childNames?.indexOf("foo");
      const childKeyFromParent =
        idx !== undefined && idx >= 0 ? hashToKey(parentRoot.children![idx]!) : null;
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
      const storage = createCasStorageFromBuffer({
        get: mem.get.bind(mem),
        put: mem.put.bind(mem),
        del: mem.del.bind(mem),
      });
      const keyProvider = createKeyProvider();
      cas = createCasService({ storage, key: keyProvider });
      depotStore = createMemoryDepotStore();
      service = createRealmService({ cas, depotStore, key: keyProvider, storage: mem });

      const enc = await encodeDictNode({ children: [], childNames: [] }, keyProvider);
      const oldRootKey = hashToKey(enc.hash);
      await cas.putNode(oldRootKey, streamFromBytes(enc.bytes));

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
      await cas.putNode(newRootKey, streamFromBytes(newEnc.bytes));

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
      await cas.putNode(newRootKey, streamFromBytes(newEnc.bytes));

      const wrongOldRoot = "wrong-key-16-bytes!!"; // not current root

      const err = await service.commitDepot(DEPOT_ID, newRootKey, wrongOldRoot).catch((e) => e);
      expect(isRealmError(err)).toBe(true);
      expect(err.code).toBe("CommitConflict");
    });

    it("after parent commit that moves node foo->bar, child depot mountPath is updated via dag-diff", async () => {
      const keyProvider = createKeyProvider();
      const mem = createMemoryStorage();
      const storage = createCasStorageFromBuffer({
        get: mem.get.bind(mem),
        put: mem.put.bind(mem),
        del: mem.del.bind(mem),
      });
      const cas = createCasService({ storage, key: keyProvider });
      const depotStore = createMemoryDepotStore();
      const realm = createRealmService({ cas, depotStore, key: keyProvider, storage: mem });
      const REALM_ID = "r1";
      const PARENT_ID = "parent";

      // Empty dict (child root)
      const childEnc = await encodeDictNode({ children: [], childNames: [] }, keyProvider);
      const childKey = hashToKey(childEnc.hash);
      await cas.putNode(childKey, streamFromBytes(childEnc.bytes));

      // Old parent root: dict with "foo" -> childKey
      const oldRootEnc = await encodeDictNode(
        { children: [childEnc.hash], childNames: ["foo"] },
        keyProvider
      );
      const oldRootKey = hashToKey(oldRootEnc.hash);
      await cas.putNode(oldRootKey, streamFromBytes(oldRootEnc.bytes));

      // New parent root: dict with "bar" -> same childKey (move only)
      const newRootEnc = await encodeDictNode(
        { children: [childEnc.hash], childNames: ["bar"] },
        keyProvider
      );
      const newRootKey = hashToKey(newRootEnc.hash);
      await cas.putNode(newRootKey, streamFromBytes(newRootEnc.bytes));

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
      const storage = createCasStorageFromBuffer({
        get: mem.get.bind(mem),
        put: mem.put.bind(mem),
        del: mem.del.bind(mem),
      });
      keyProvider = createKeyProvider();
      cas = createCasService({ storage, key: keyProvider });
      depotStore = createMemoryDepotStore();
      service = createRealmService({ cas, depotStore, key: keyProvider, storage: mem });

      // Parent root = d-node with "foo" -> child dict (empty)
      const childEnc = await encodeDictNode({ children: [], childNames: [] }, keyProvider);
      const childKey = hashToKey(childEnc.hash);
      await cas.putNode(childKey, streamFromBytes(childEnc.bytes));

      const rootEnc = await encodeDictNode(
        { children: [childEnc.hash], childNames: ["foo"] },
        keyProvider
      );
      const rootKey = hashToKey(rootEnc.hash);
      await cas.putNode(rootKey, streamFromBytes(rootEnc.bytes));

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
      await cas.putNode(leafKey, streamFromBytes(leafEnc.bytes));
      const newChildRootEnc = await encodeDictNode(
        { children: [leafEnc.hash], childNames: ["x"] },
        keyProvider
      );
      const newChildRootKey = hashToKey(newChildRootEnc.hash);
      await cas.putNode(newChildRootKey, streamFromBytes(newChildRootEnc.bytes));
      await depotStore.setRoot(childDepotId, newChildRootKey);

      const parentRootBefore = await depotStore.getRoot(PARENT_ID);
      expect(parentRootBefore).not.toBeNull();

      await service.closeDepot(childDepotId);

      // Parent's root should now be a new dict where "foo" points to child's current root
      const parentRootAfter = await depotStore.getRoot(PARENT_ID);
      expect(parentRootAfter).not.toBeNull();
      expect(parentRootAfter).not.toBe(parentRootBefore);
      const parentRootResult = await cas.getNode(parentRootAfter!);
      expect(parentRootResult).not.toBeNull();
      const parentRootNode = decodeNode(await bytesFromStream(parentRootResult!.body));
      expect(parentRootNode.kind).toBe("dict");
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
      const storage = createCasStorageFromBuffer({
        get: mem.get.bind(mem),
        put: mem.put.bind(mem),
        del: mem.del.bind(mem),
      });
      const keyProvider = createKeyProvider();
      const cas = createCasService({ storage, key: keyProvider });
      const depotStore = createMemoryDepotStore();
      const service = createRealmService({ cas, depotStore, key: keyProvider, storage: mem });
      const REALM_ID = "r1";

      // Root A (depot1 and depot2 share this root - dedupe)
      const encA = await encodeDictNode({ children: [], childNames: [] }, keyProvider);
      const rootKeyA = hashToKey(encA.hash);
      await cas.putNode(rootKeyA, streamFromBytes(encA.bytes));

      // Orphan node (different content so different key; not reachable from any depot)
      const encChild = await encodeDictNode({ children: [], childNames: [] }, keyProvider);
      await cas.putNode(hashToKey(encChild.hash), streamFromBytes(encChild.bytes));
      const encOrphan = await encodeDictNode(
        { children: [encChild.hash], childNames: ["x"] },
        keyProvider
      );
      const orphanKey = hashToKey(encOrphan.hash);
      await cas.putNode(orphanKey, streamFromBytes(encOrphan.bytes));

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
      const storage = createCasStorageFromBuffer({
        get: mem.get.bind(mem),
        put: mem.put.bind(mem),
        del: mem.del.bind(mem),
      });
      const keyProvider = createKeyProvider();
      const cas = createCasService({ storage, key: keyProvider });
      const depotStore = createMemoryDepotStore();
      const service = createRealmService({ cas, depotStore, key: keyProvider, storage: mem });
      const REALM_ID = "r1";

      const enc1 = await encodeDictNode({ children: [], childNames: [] }, keyProvider);
      const root1 = hashToKey(enc1.hash);
      await cas.putNode(root1, streamFromBytes(enc1.bytes));

      const enc2 = await encodeDictNode({ children: [], childNames: [] }, keyProvider);
      const root2 = hashToKey(enc2.hash);
      await cas.putNode(root2, streamFromBytes(enc2.bytes));

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
      const storage = createCasStorageFromBuffer({
        get: mem.get.bind(mem),
        put: mem.put.bind(mem),
        del: mem.del.bind(mem),
      });
      const keyProvider = createKeyProvider();
      const cas = createCasService({ storage, key: keyProvider });
      const depotStore = createMemoryDepotStore();
      const service = createRealmService({ cas, depotStore, key: keyProvider, storage: mem });
      const REALM_ID = "r1";

      const enc = await encodeDictNode({ children: [], childNames: [] }, keyProvider);
      const rootKey = hashToKey(enc.hash);
      await cas.putNode(rootKey, streamFromBytes(enc.bytes));

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

  describe("RealmFacade (design API)", () => {
    it("createRootDelegate returns limited DelegateFacade; getNode, putNode, commit, createChildDelegate, close work", async () => {
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

      const facade = await realm.createRootDelegate("r1", { ttl: 3600_000 });
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
});
