import { describe, expect, test } from "bun:test";
import { RealmService } from "../src/realm-service.ts";
import type { BlobStore, DelegateDb } from "../src/storage.ts";
import type { Delegate, RealmStats } from "../src/types.ts";
import { EMPTY_DICT_KEY, getWellKnownNodeData } from "@casfa/core";

function createMemoryBlob(): BlobStore {
  const map = new Map<string, Uint8Array>();
  return {
    get: (k) => Promise.resolve(map.get(k) ?? null),
    put: (k, v) => {
      map.set(k, v);
      return Promise.resolve();
    },
    sweep: (keysToRetain) => {
      const set = new Set(keysToRetain);
      for (const k of map.keys()) {
        if (!set.has(k)) map.delete(k);
      }
      return Promise.resolve();
    },
  };
}

function createMemoryDb(): DelegateDb {
  const roots = new Map<string, string>();
  const delegates = new Map<string, Delegate>();
  const stats = new Map<string, RealmStats>();

  return {
    getRoot: (realmId) => Promise.resolve(roots.get(realmId) ?? null),
    setRoot: (realmId, nodeKey) => {
      roots.set(realmId, nodeKey);
      return Promise.resolve();
    },
    getDelegate: (id) => Promise.resolve(delegates.get(id) ?? null),
    insertDelegate: (d) => {
      delegates.set(d.delegateId, { ...d });
      return Promise.resolve();
    },
    getRealmStats: (realmId) => Promise.resolve(stats.get(realmId) ?? null),
    incrementRealmStats: async (realmId, dc, bc) => {
      const cur = stats.get(realmId) ?? { nodeCount: 0, totalBytes: 0 };
      stats.set(realmId, {
        nodeCount: cur.nodeCount + dc,
        totalBytes: cur.totalBytes + bc,
      });
    },
    setRealmStats: (realmId, s) => {
      stats.set(realmId, s);
      return Promise.resolve();
    },
  };
}

describe("RealmService", () => {
  test("createRootDelegate returns delegate with dlg_ id and empty boundPath", async () => {
    const svc = new RealmService({
      blob: createMemoryBlob(),
      db: createMemoryDb(),
      key: { computeKey: async (d) => d.subarray(0, 16) },
    });
    const d = await svc.createRootDelegate("rlm_xxx");
    expect(d.delegateId.startsWith("dlg_")).toBe(true);
    expect(d.realmId).toBe("rlm_xxx");
    expect(d.parentId).toBe(null);
    expect(d.boundPath).toEqual([]);
  });

  test("createChildDelegate requires realm root and name-only path", async () => {
    const db = createMemoryDb();
    const blob = createMemoryBlob();
    const emptyDictBytes = getWellKnownNodeData(EMPTY_DICT_KEY)!;
    blob.put(EMPTY_DICT_KEY, emptyDictBytes);
    await db.setRoot("rlm_1", EMPTY_DICT_KEY);

    const svc = new RealmService({ blob, db, key: { computeKey: async (d) => d.subarray(0, 16) } });
    const root = await svc.createRootDelegate("rlm_1");
    const child = await svc.createChildDelegate(root.delegateId, [
      { kind: "name", value: "x" },
    ]);
    expect(child).toMatchObject({ code: "NotFound" });
  });

  test("createChildDelegate succeeds when path exists", async () => {
    const db = createMemoryDb();
    const blob = createMemoryBlob();
    const { encodeDictNode, hashToKey, makeDict } = await import("@casfa/core");
    const keyProvider = { computeKey: async (d: Uint8Array) => d.subarray(0, 16) };
    const ctx = { storage: blob, key: keyProvider };
    const childHash = new Uint8Array(16);
    childHash.set([1], 0);
    const childKey = hashToKey(childHash);
    blob.put(childKey, (await encodeDictNode({ children: [childHash], childNames: ["a"] }, keyProvider)).bytes);
    const rootKey = await makeDict(ctx, [{ name: "x", key: childKey }]);
    await db.setRoot("rlm_1", rootKey);

    const svc = new RealmService({ blob, db, key: keyProvider });
    const root = await svc.createRootDelegate("rlm_1");
    const child = await svc.createChildDelegate(root.delegateId, [{ kind: "name", value: "x" }]);
    if ("code" in child) throw new Error(JSON.stringify(child));
    expect(child.boundPath).toEqual([{ kind: "name", value: "x" }]);
    expect(child.parentId).toBe(root.delegateId);
  });

  test("put dict increments realm stats", async () => {
    const db = createMemoryDb();
    const blob = createMemoryBlob();
    const { makeDict, EMPTY_DICT_KEY, getWellKnownNodeData } = await import("@casfa/core");
    const keyProvider = { computeKey: async (d: Uint8Array) => d.subarray(0, 16) };
    const emptyBytes = getWellKnownNodeData(EMPTY_DICT_KEY)!;
    blob.put(EMPTY_DICT_KEY, emptyBytes);
    await db.setRoot("rlm_1", EMPTY_DICT_KEY);

    const svc = new RealmService({ blob, db, key: keyProvider });
    const root = await svc.createRootDelegate("rlm_1");
    const r = await svc.put(root.delegateId, [], { kind: "dict", entries: [] });
    expect(r.ok).toBe(true);
    const stats = await svc.getRealmStats("rlm_1");
    expect(stats?.nodeCount).toBe(1);
    expect(stats?.totalBytes).toBeGreaterThan(0);
  });

  test("commit updates root when base matches", async () => {
    const db = createMemoryDb();
    const blob = createMemoryBlob();
    const { makeDict, encodeDictNode, hashToKey, getWellKnownNodeData } = await import("@casfa/core");
    const keyProvider = { computeKey: async (d: Uint8Array) => d.subarray(0, 16) };
    const ctx = { storage: blob, key: keyProvider };
    const oldChildHash = new Uint8Array(16);
    oldChildHash.set([1], 0);
    const oldChildKey = hashToKey(oldChildHash);
    blob.put(oldChildKey, (await encodeDictNode({ children: [oldChildHash], childNames: ["a"] }, keyProvider)).bytes);
    const rootKey = await makeDict(ctx, [{ name: "a", key: oldChildKey }]);
    await db.setRoot("rlm_1", rootKey);

    const svc = new RealmService({ blob, db, key: keyProvider });
    const root = await svc.createRootDelegate("rlm_1");
    const delegate = await svc.createChildDelegate(root.delegateId, [{ kind: "name", value: "a" }]);
    if ("code" in delegate) throw new Error(JSON.stringify(delegate));

    const newChildHash = new Uint8Array(16);
    newChildHash.set([2], 0);
    const newChildKey = hashToKey(newChildHash);
    blob.put(newChildKey, (await encodeDictNode({ children: [newChildHash], childNames: ["b"] }, keyProvider)).bytes);

    const commitResult = await svc.commit(delegate.delegateId, oldChildKey, newChildKey);
    expect(commitResult.ok).toBe(true);
    if (!commitResult.ok) return;
    const newRoot = await db.getRoot("rlm_1");
    expect(newRoot).toBe(commitResult.newRootKey);
  });

  test("getRealmStats returns null when no stats", async () => {
    const svc = new RealmService({
      blob: createMemoryBlob(),
      db: createMemoryDb(),
      key: { computeKey: async (d) => d.subarray(0, 16) },
    });
    const s = await svc.getRealmStats("rlm_any");
    expect(s).toBe(null);
  });

  test("listReachableKeys and gcSweep", async () => {
    const db = createMemoryDb();
    const blob = createMemoryBlob();
    const { makeDict, encodeDictNode, hashToKey, getWellKnownNodeData } = await import("@casfa/core");
    const keyProvider = { computeKey: async (d: Uint8Array) => d.subarray(0, 16) };
    const ctx = { storage: blob, key: keyProvider };
    const childHash = new Uint8Array(16);
    childHash.set([1], 0);
    const childKey = hashToKey(childHash);
    const childBytes = (await encodeDictNode({ children: [childHash], childNames: ["x"] }, keyProvider)).bytes;
    blob.put(childKey, childBytes);
    const rootKey = await makeDict(ctx, [{ name: "a", key: childKey }]);
    await db.setRoot("rlm_1", rootKey);

    const reachable = await new RealmService({ blob, db, key: keyProvider }).listReachableKeys("rlm_1");
    expect(reachable.size).toBe(2);
    expect(reachable.has(rootKey)).toBe(true);
    expect(reachable.has(childKey)).toBe(true);

    const orphanKey = hashToKey(new Uint8Array(16).fill(99));
    blob.put(orphanKey, childBytes);

    await new RealmService({ blob, db, key: keyProvider }).gcSweep("rlm_1");
    expect(await blob.get(orphanKey)).toBe(null);
    expect(await blob.get(rootKey)).not.toBe(null);
    const stats = await db.getRealmStats("rlm_1");
    expect(stats?.nodeCount).toBe(2);
  });
});
