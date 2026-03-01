/**
 * Root-resolver tests: normalizePath, resolvePath (empty path, a/b), getCurrentRoot (user/worker).
 */
import { describe, expect, it } from "bun:test";
import type { CasFacade } from "@casfa/cas";
import { encodeDictNode, hashToKey } from "@casfa/core";
import type { KeyProvider } from "@casfa/core";
import { createMemoryDelegateStore } from "@casfa/realm";
import { createRealmFacade } from "@casfa/realm";
import { createCasFacade } from "@casfa/cas";
import { createCasStorageFromBuffer } from "@casfa/cas";
import { createMemoryStorage } from "@casfa/storage-memory";
import { computeSizeFlagByte } from "@casfa/core";
import {
  normalizePath,
  resolvePath,
  getCurrentRoot,
  type RootResolverDeps,
} from "../../src/services/root-resolver.ts";
import type { UserAuth, WorkerAuth } from "../../src/types.ts";

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

describe("normalizePath", () => {
  it("returns empty array for empty or slash-only path", () => {
    expect(normalizePath("")).toEqual([]);
    expect(normalizePath("/")).toEqual([]);
    expect(normalizePath("///")).toEqual([]);
  });
  it("splits by slash and drops empty segments", () => {
    expect(normalizePath("a/b")).toEqual(["a", "b"]);
    expect(normalizePath("/a/b")).toEqual(["a", "b"]);
    expect(normalizePath("a/b/")).toEqual(["a", "b"]);
  });
  it("throws on .. or .", () => {
    expect(() => normalizePath("a/..")).toThrow("must not contain");
    expect(() => normalizePath(".")).toThrow("must not contain");
  });
});

describe("resolvePath", () => {
  async function createMockCasWithTree(): Promise<{
    cas: CasFacade;
    rootKey: string;
    keyA: string;
    keyB: string;
  }> {
    const key = createKeyProvider();
    const emptyDict = await encodeDictNode({ children: [], childNames: [] }, key);
    const keyB = hashToKey(emptyDict.hash);
    const dictB = await encodeDictNode({ children: [emptyDict.hash], childNames: ["b"] }, key);
    const keyA = hashToKey(dictB.hash);
    const dictA = await encodeDictNode({ children: [dictB.hash], childNames: ["a"] }, key);
    const rootKey = hashToKey(dictA.hash);

    const store = new Map<string, Uint8Array>();
    store.set(rootKey, dictA.bytes);
    store.set(keyA, dictB.bytes);
    store.set(keyB, emptyDict.bytes);

    const bufferStorage = {
      get: async (k: string) => store.get(k) ?? null,
      put: async (k: string, bytes: Uint8Array) => {
        store.set(k, bytes);
      },
      del: async (k: string) => store.delete(k),
    };
    const storage = createCasStorageFromBuffer(bufferStorage);
    const cas = createCasFacade({ storage, key });
    return { cas, rootKey, keyA, keyB };
  }

  it("returns rootKey for empty path", async () => {
    const { cas, rootKey } = await createMockCasWithTree();
    const out = await resolvePath(cas, rootKey, "");
    expect(out).toBe(rootKey);
    const out2 = await resolvePath(cas, rootKey, "/");
    expect(out2).toBe(rootKey);
  });

  it("resolves a/b to child node key", async () => {
    const { cas, rootKey, keyA, keyB } = await createMockCasWithTree();
    const single = await resolvePath(cas, rootKey, "a");
    expect(single).toBe(keyA);
    const double = await resolvePath(cas, rootKey, "a/b");
    expect(double).toBe(keyB);
  });

  it("returns null for missing segment", async () => {
    const { cas, rootKey } = await createMockCasWithTree();
    const out = await resolvePath(cas, rootKey, "x");
    expect(out).toBeNull();
    const out2 = await resolvePath(cas, rootKey, "a/c");
    expect(out2).toBeNull();
  });
});

describe("getCurrentRoot", () => {
  it("returns realm root for user auth (creates root delegate)", async () => {
    const key = createKeyProvider();
    const storage = createMemoryStorage();
    const casStorage = createCasStorageFromBuffer({
      get: storage.get.bind(storage),
      put: storage.put.bind(storage),
      del: storage.del.bind(storage),
    });
    const cas = createCasFacade({ storage: casStorage, key });
    const delegateStore = createMemoryDelegateStore();
    const realm = createRealmFacade({
      cas,
      delegateStore,
      key,
      maxLimitedTtlMs: 3600_000,
    });
    const deps: RootResolverDeps = { realm, delegateStore, cas, key };
    const auth: UserAuth = { type: "user", userId: "u1" };
    const rootKey = await getCurrentRoot(auth, deps);
    expect(rootKey).not.toBeNull();
  });

  it("returns branch root for worker when set", async () => {
    const delegateStore = createMemoryDelegateStore();
    const key = createKeyProvider();
    const storage = createMemoryStorage();
    const casStorage = createCasStorageFromBuffer({
      get: storage.get.bind(storage),
      put: storage.put.bind(storage),
      del: storage.del.bind(storage),
    });
    const cas = createCasFacade({ storage: casStorage, key });
    const realm = createRealmFacade({
      cas,
      delegateStore,
      key,
      maxLimitedTtlMs: 3600_000,
    });
    await realm.getRootDelegate("r1", {});
    const rootDelegate = await delegateStore.getRootDelegate("r1");
    expect(rootDelegate).not.toBeNull();
    const branchId = rootDelegate!.delegateId;
    const emptyDict = await encodeDictNode({ children: [], childNames: [] }, key);
    const rootKey = hashToKey(emptyDict.hash);
    await delegateStore.setRoot(branchId, rootKey);

    const deps: RootResolverDeps = { realm, delegateStore, cas, key };
    const auth: WorkerAuth = { type: "worker", realmId: "r1", branchId, access: "readwrite" };
    const got = await getCurrentRoot(auth, deps);
    expect(got).toBe(rootKey);
  });

  it("returns null for worker when branch has no root", async () => {
    const delegateStore = createMemoryDelegateStore();
    const key = createKeyProvider();
    const storage = createMemoryStorage();
    const casStorage = createCasStorageFromBuffer({
      get: storage.get.bind(storage),
      put: storage.put.bind(storage),
      del: storage.del.bind(storage),
    });
    const cas = createCasFacade({ storage: casStorage, key });
    const realm = createRealmFacade({
      cas,
      delegateStore,
      key,
      maxLimitedTtlMs: 3600_000,
    });
    const deps: RootResolverDeps = { realm, delegateStore, cas, key };
    const auth: WorkerAuth = {
      type: "worker",
      realmId: "r1",
      branchId: "nonexistent-branch",
      access: "readwrite",
    };
    const got = await getCurrentRoot(auth, deps);
    expect(got).toBeNull();
  });
});
