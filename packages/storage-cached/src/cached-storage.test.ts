/**
 * Unit tests for createCachedStorage
 *
 * Uses two in-memory StorageProviders (cache + remote) to verify:
 * - get: cache hit / cache miss + write-back / remote miss
 * - put: write-through to both cache and remote
 * - cache write-back failures are silently ignored
 */

import { describe, expect, it } from "bun:test";
import type { StorageProvider } from "@casfa/storage-core";
import type { SyncResult } from "./cached-storage.ts";
import { createCachedStorage } from "./cached-storage.ts";

// ============================================================================
// In-memory storage helper (observable)
// ============================================================================

type Call = { method: string; args: unknown[] };

function createSpyStorage(
  initial: Map<string, Uint8Array> = new Map()
): StorageProvider & { calls: Call[]; store: Map<string, Uint8Array> } {
  const store = new Map(initial);
  const calls: Call[] = [];

  return {
    calls,
    store,
    async get(key) {
      calls.push({ method: "get", args: [key] });
      return store.get(key) ?? null;
    },
    async put(key, value) {
      calls.push({ method: "put", args: [key, value] });
      store.set(key, value);
    },
  };
}

const KEY = "ABCDEFGHIJKLMNOPQRSTUVWXY0";
const DATA = new Uint8Array([1, 2, 3, 4]);

// ============================================================================
// Tests — get
// ============================================================================

describe("createCachedStorage", () => {
  describe("get", () => {
    it("should return from cache on hit without touching remote", async () => {
      const cache = createSpyStorage(new Map([[KEY, DATA]]));
      const remote = createSpyStorage();

      const storage = createCachedStorage({ cache, remote });
      const result = await storage.get(KEY);

      expect(result).toEqual(DATA);
      expect(cache.calls).toEqual([{ method: "get", args: [KEY] }]);
      expect(remote.calls).toHaveLength(0);
    });

    it("should fetch from remote on cache miss and write back", async () => {
      const cache = createSpyStorage();
      const remote = createSpyStorage(new Map([[KEY, DATA]]));

      const storage = createCachedStorage({ cache, remote });
      const result = await storage.get(KEY);

      expect(result).toEqual(DATA);

      // cache.get (miss) → remote.get (hit) → cache.put (write-back)
      expect(cache.calls[0]).toEqual({ method: "get", args: [KEY] });
      expect(remote.calls[0]).toEqual({ method: "get", args: [KEY] });

      // Write-back is fire-and-forget, give it a tick
      await new Promise((r) => setTimeout(r, 0));
      expect(cache.store.has(KEY)).toBe(true);
      expect(cache.store.get(KEY)).toEqual(DATA);
    });

    it("should return null when both miss", async () => {
      const cache = createSpyStorage();
      const remote = createSpyStorage();

      const storage = createCachedStorage({ cache, remote });
      const result = await storage.get(KEY);

      expect(result).toBeNull();
    });

    it("should silently ignore cache write-back failures", async () => {
      const cache: StorageProvider = {
        get: async () => null,
        put: async () => {
          throw new Error("quota exceeded");
        },
      };
      const remote = createSpyStorage(new Map([[KEY, DATA]]));

      const storage = createCachedStorage({ cache, remote });

      // Should not throw
      const result = await storage.get(KEY);
      expect(result).toEqual(DATA);

      // Give fire-and-forget a tick to settle
      await new Promise((r) => setTimeout(r, 10));
    });
  });

  // ==========================================================================
  // Tests — put (write-through)
  // ==========================================================================

  describe("put", () => {
    it("should write to both cache and remote", async () => {
      const cache = createSpyStorage();
      const remote = createSpyStorage();

      const storage = createCachedStorage({ cache, remote });
      await storage.put(KEY, DATA);

      expect(cache.store.get(KEY)).toEqual(DATA);
      expect(remote.store.get(KEY)).toEqual(DATA);
    });

    it("should write to cache before remote", async () => {
      const order: string[] = [];
      const cache: StorageProvider = {
        get: async () => null,
        put: async () => {
          order.push("cache");
        },
      };
      const remote: StorageProvider = {
        get: async () => null,
        put: async () => {
          order.push("remote");
        },
      };

      const storage = createCachedStorage({ cache, remote });
      await storage.put(KEY, DATA);

      expect(order).toEqual(["cache", "remote"]);
    });

    it("should propagate remote put errors", async () => {
      const cache = createSpyStorage();
      const remote: StorageProvider = {
        get: async () => null,
        put: async () => {
          throw new Error("upload failed");
        },
      };

      const storage = createCachedStorage({ cache, remote });
      await expect(storage.put(KEY, DATA)).rejects.toThrow("upload failed");

      // Cache should still have the data (written first)
      expect(cache.store.get(KEY)).toEqual(DATA);
    });
  });

  // ==========================================================================
  // Tests — integration (get after put, multiple keys)
  // ==========================================================================

  describe("integration", () => {
    it("should serve put data from cache on subsequent get", async () => {
      const cache = createSpyStorage();
      const remote = createSpyStorage();

      const storage = createCachedStorage({ cache, remote });

      await storage.put(KEY, DATA);

      // Reset call tracking
      cache.calls.length = 0;
      remote.calls.length = 0;

      const result = await storage.get(KEY);
      expect(result).toEqual(DATA);

      // Should hit cache, not touch remote
      expect(cache.calls).toEqual([{ method: "get", args: [KEY] }]);
      expect(remote.calls).toHaveLength(0);
    });

    it("should handle multiple independent keys", async () => {
      const cache = createSpyStorage();
      const remote = createSpyStorage();

      const storage = createCachedStorage({ cache, remote });

      const key2 = "ZYXWVUTSRQPONMLKJIHGFEDCB0";
      const data2 = new Uint8Array([5, 6, 7, 8]);

      await storage.put(KEY, DATA);
      await storage.put(key2, data2);

      expect(await storage.get(KEY)).toEqual(DATA);
      expect(await storage.get(key2)).toEqual(data2);
    });
  });
});

// ============================================================================
// Tests — write-back mode
// ============================================================================

describe("createCachedStorage (write-back)", () => {
  // Helper to create spy storage with checkMany/claim support
  type CheckableRemote = StorageProvider & {
    calls: Call[];
    store: Map<string, Uint8Array>;
    checkMany: (keys: string[]) => Promise<{
      missing: string[];
      unowned: string[];
      owned: string[];
    }>;
    claim: (key: string, value: Uint8Array) => Promise<void>;
  };

  function createCheckableRemote(
    initial: Map<string, Uint8Array> = new Map(),
    opts?: {
      /** Keys that exist but are not owned by the caller */
      unownedKeys?: Set<string>;
    }
  ): CheckableRemote {
    const store = new Map(initial);
    const unownedKeys = opts?.unownedKeys ?? new Set<string>();
    const calls: Call[] = [];

    return {
      calls,
      store,
      async get(key) {
        calls.push({ method: "get", args: [key] });
        return store.get(key) ?? null;
      },
      async put(key, value) {
        calls.push({ method: "put", args: [key, value] });
        store.set(key, value);
      },
      async checkMany(keys: string[]) {
        calls.push({ method: "checkMany", args: [keys] });
        const missing: string[] = [];
        const unowned: string[] = [];
        const owned: string[] = [];
        for (const k of keys) {
          if (!store.has(k)) {
            missing.push(k);
          } else if (unownedKeys.has(k)) {
            unowned.push(k);
          } else {
            owned.push(k);
          }
        }
        return { missing, unowned, owned };
      },
      async claim(key, value) {
        calls.push({ method: "claim", args: [key, value] });
        unownedKeys.delete(key);
      },
    };
  }

  // Simple encoder: a "node" is [childCount, ...childKeyBytes]
  // Each child key is 26 bytes (CB32 key length)
  const CB32_LEN = 26;
  function encodeNode(childKeys: string[]): Uint8Array {
    const buf = new Uint8Array(1 + childKeys.length * CB32_LEN);
    buf[0] = childKeys.length;
    for (let i = 0; i < childKeys.length; i++) {
      const bytes = new TextEncoder().encode(childKeys[i]!);
      buf.set(bytes.slice(0, CB32_LEN), 1 + i * CB32_LEN);
    }
    return buf;
  }
  function getChildKeys(value: Uint8Array): string[] {
    const count = value[0]!;
    const keys: string[] = [];
    for (let i = 0; i < count; i++) {
      const start = 1 + i * CB32_LEN;
      const slice = value.slice(start, start + CB32_LEN);
      keys.push(new TextDecoder().decode(slice));
    }
    return keys;
  }

  // Stable CB32-like keys for test nodes
  const ROOT = "AAAAAAAAAAAAAAAAAAAAAAAAA0";
  const CHILD_A = "BBBBBBBBBBBBBBBBBBBBBBBBBB";
  const CHILD_B = "CCCCCCCCCCCCCCCCCCCCCCCCCC";
  const LEAF_1 = "DDDDDDDDDDDDDDDDDDDDDDDDDD";

  describe("put", () => {
    it("should write to cache immediately but not to remote", async () => {
      const cache = createSpyStorage();
      const remote = createSpyStorage();

      const storage = createCachedStorage({
        cache,
        remote,
        writeBack: {},
      });

      await storage.put(KEY, DATA);

      // Data is in cache
      expect(cache.store.get(KEY)).toEqual(DATA);
      // Not yet in remote
      expect(remote.store.has(KEY)).toBe(false);
      expect(remote.calls.filter((c) => c.method === "put")).toHaveLength(0);

      storage.dispose();
    });

    it("should return immediately without waiting for remote", async () => {
      const cache = createSpyStorage();
      const remote: StorageProvider = {
        get: async () => null,
        put: async () => {
          await new Promise((r) => setTimeout(r, 500));
        },
      };

      const storage = createCachedStorage({
        cache,
        remote,
        writeBack: {},
      });

      const start = Date.now();
      await storage.put(KEY, DATA);
      const elapsed = Date.now() - start;

      // Should return nearly instantly (≪ 500ms)
      expect(elapsed).toBeLessThan(50);

      storage.dispose();
    });
  });

  describe("flush", () => {
    it("should be a no-op (use syncTree instead)", async () => {
      const cache = createSpyStorage();
      const remote = createSpyStorage();

      const storage = createCachedStorage({
        cache,
        remote,
        writeBack: {},
      });

      await storage.put(KEY, DATA);
      await storage.flush(); // no-op

      // Remote should NOT have the data (flush is no-op)
      expect(remote.store.has(KEY)).toBe(false);

      storage.dispose();
    });
  });

  describe("syncTree", () => {
    it("should throw if getChildKeys is not configured", async () => {
      const cache = createSpyStorage();
      const remote = createCheckableRemote();

      const storage = createCachedStorage({
        cache,
        remote,
        writeBack: {},
      });

      await expect(storage.syncTree(ROOT)).rejects.toThrow(/getChildKeys/);

      storage.dispose();
    });

    it("should upload a single leaf node (no children)", async () => {
      const leafData = encodeNode([]);
      const cache = createSpyStorage(new Map([[ROOT, leafData]]));
      const remote = createCheckableRemote();

      const storage = createCachedStorage({
        cache,
        remote,
        writeBack: { getChildKeys },
      });

      await storage.syncTree(ROOT);

      expect(remote.store.get(ROOT)).toEqual(leafData);
      const putCalls = remote.calls.filter((c) => c.method === "put");
      expect(putCalls).toHaveLength(1);

      storage.dispose();
    });

    it("should upload parent and children in topological order (children first)", async () => {
      const rootData = encodeNode([CHILD_A, CHILD_B]);
      const childAData = encodeNode([]);
      const childBData = encodeNode([]);

      const cache = createSpyStorage(
        new Map([
          [ROOT, rootData],
          [CHILD_A, childAData],
          [CHILD_B, childBData],
        ])
      );
      const remote = createCheckableRemote();

      const storage = createCachedStorage({
        cache,
        remote,
        writeBack: { getChildKeys },
      });

      await storage.syncTree(ROOT);

      // All three should be uploaded
      expect(remote.store.has(ROOT)).toBe(true);
      expect(remote.store.has(CHILD_A)).toBe(true);
      expect(remote.store.has(CHILD_B)).toBe(true);

      // Children should be put BEFORE parent (topological order)
      const putKeys = remote.calls.filter((c) => c.method === "put").map((c) => c.args[0]);
      const rootIdx = putKeys.indexOf(ROOT);
      const childAIdx = putKeys.indexOf(CHILD_A);
      const childBIdx = putKeys.indexOf(CHILD_B);
      expect(childAIdx).toBeLessThan(rootIdx);
      expect(childBIdx).toBeLessThan(rootIdx);

      storage.dispose();
    });

    it("should prune owned subtrees (skip already-owned nodes and their children)", async () => {
      // Tree: ROOT → [CHILD_A, CHILD_B]
      //   CHILD_A → [LEAF_1]   (CHILD_A already owned on remote → skip subtree)
      //   CHILD_B → []          (missing → upload)
      const childAData = encodeNode([LEAF_1]);
      const childBData = encodeNode([]);
      const leaf1Data = encodeNode([]);
      const rootData = encodeNode([CHILD_A, CHILD_B]);

      const cache = createSpyStorage(
        new Map([
          [ROOT, rootData],
          [CHILD_A, childAData],
          [CHILD_B, childBData],
          [LEAF_1, leaf1Data],
        ])
      );
      // remote already has CHILD_A (owned) — so LEAF_1 should NOT be checked or uploaded
      const remote = createCheckableRemote(new Map([[CHILD_A, childAData]]));

      const storage = createCachedStorage({
        cache,
        remote,
        writeBack: { getChildKeys },
      });

      await storage.syncTree(ROOT);

      // ROOT and CHILD_B should be uploaded
      expect(remote.store.has(ROOT)).toBe(true);
      expect(remote.store.has(CHILD_B)).toBe(true);

      // LEAF_1 should NOT be uploaded (pruned because CHILD_A is owned)
      const putKeys = remote.calls.filter((c) => c.method === "put").map((c) => c.args[0]);
      expect(putKeys).not.toContain(LEAF_1);

      // LEAF_1 should NOT even be checked (not in any checkMany call)
      const allCheckedKeys = remote.calls
        .filter((c) => c.method === "checkMany")
        .flatMap((c) => c.args[0] as string[]);
      expect(allCheckedKeys).not.toContain(LEAF_1);

      storage.dispose();
    });

    it("should be a no-op if root is already owned on remote", async () => {
      const rootData = encodeNode([CHILD_A]);
      const childAData = encodeNode([]);

      const cache = createSpyStorage(
        new Map([
          [ROOT, rootData],
          [CHILD_A, childAData],
        ])
      );
      const remote = createCheckableRemote(
        new Map([
          [ROOT, rootData],
          [CHILD_A, childAData],
        ])
      );

      const storage = createCachedStorage({
        cache,
        remote,
        writeBack: { getChildKeys },
      });

      await storage.syncTree(ROOT);

      // No puts — everything already owned
      const putCalls = remote.calls.filter((c) => c.method === "put");
      expect(putCalls).toHaveLength(0);

      storage.dispose();
    });

    it("should claim unowned nodes instead of uploading", async () => {
      const rootData = encodeNode([]);

      const cache = createSpyStorage(new Map([[ROOT, rootData]]));
      const remote = createCheckableRemote(new Map([[ROOT, rootData]]), {
        unownedKeys: new Set([ROOT]),
      });

      const storage = createCachedStorage({
        cache,
        remote,
        writeBack: { getChildKeys },
      });

      await storage.syncTree(ROOT);

      // Should have called claim, not put
      const claimCalls = remote.calls.filter((c) => c.method === "claim");
      const putCalls = remote.calls.filter((c) => c.method === "put");
      expect(claimCalls).toHaveLength(1);
      expect(putCalls).toHaveLength(0);

      storage.dispose();
    });

    it("should skip nodes not in local cache (assumed already on remote)", async () => {
      // ROOT references CHILD_A, but CHILD_A is not in cache
      const rootData = encodeNode([CHILD_A]);
      const cache = createSpyStorage(new Map([[ROOT, rootData]]));
      const remote = createCheckableRemote();

      const storage = createCachedStorage({
        cache,
        remote,
        writeBack: { getChildKeys },
      });

      await storage.syncTree(ROOT);

      // ROOT should be uploaded
      expect(remote.store.has(ROOT)).toBe(true);
      // No put for CHILD_A (not in cache)
      const putKeys = remote.calls.filter((c) => c.method === "put").map((c) => c.args[0]);
      expect(putKeys).not.toContain(CHILD_A);

      storage.dispose();
    });

    it("should call onSyncStart and onSyncEnd callbacks", async () => {
      const leafData = encodeNode([]);
      const cache = createSpyStorage(new Map([[ROOT, leafData]]));
      const remote = createCheckableRemote();

      const events: string[] = [];
      let capturedResult: SyncResult | null = null;

      const storage = createCachedStorage({
        cache,
        remote,
        writeBack: {
          getChildKeys,
          onSyncStart: () => {
            events.push("start");
          },
          onSyncEnd: (result) => {
            events.push("end");
            capturedResult = result;
          },
        },
      });

      await storage.syncTree(ROOT);

      expect(events).toEqual(["start", "end"]);
      expect(capturedResult!.synced).toEqual([ROOT]);
      expect(capturedResult!.skipped).toHaveLength(0);
      expect(capturedResult!.failed).toHaveLength(0);

      storage.dispose();
    });

    it("should call onKeySync for each uploaded node", async () => {
      const rootData = encodeNode([CHILD_A]);
      const childAData = encodeNode([]);

      const cache = createSpyStorage(
        new Map([
          [ROOT, rootData],
          [CHILD_A, childAData],
        ])
      );
      const remote = createCheckableRemote();

      const keySyncCalls: Array<[string, string]> = [];

      const storage = createCachedStorage({
        cache,
        remote,
        writeBack: {
          getChildKeys,
          onKeySync: (key, status) => {
            keySyncCalls.push([key, status]);
          },
        },
      });

      await storage.syncTree(ROOT);

      // Both keys should get "uploading" then "done"
      const childUpload = keySyncCalls.filter(([k]) => k === CHILD_A);
      expect(childUpload).toEqual([
        [CHILD_A, "uploading"],
        [CHILD_A, "done"],
      ]);
      const rootUpload = keySyncCalls.filter(([k]) => k === ROOT);
      expect(rootUpload).toEqual([
        [ROOT, "uploading"],
        [ROOT, "done"],
      ]);

      storage.dispose();
    });

    it("should throw and report failures in SyncResult", async () => {
      const leafData = encodeNode([]);
      const cache = createSpyStorage(new Map([[ROOT, leafData]]));
      const remote = createCheckableRemote();
      // Override put to fail
      remote.put = async (key) => {
        remote.calls.push({ method: "put", args: [key] });
        throw new Error("upload failed");
      };

      const results: SyncResult[] = [];

      const storage = createCachedStorage({
        cache,
        remote,
        writeBack: {
          getChildKeys,
          onSyncEnd: (result) => {
            results.push(result);
          },
        },
      });

      await expect(storage.syncTree(ROOT)).rejects.toThrow(/syncTree: failed to sync/);

      expect(results).toHaveLength(1);
      expect(results[0]!.failed).toHaveLength(1);
      expect(results[0]!.failed[0]!.key).toBe(ROOT);

      storage.dispose();
    });

    it("should fall back to individual has() when checkMany is not available", async () => {
      const leafData = encodeNode([]);
      const cache = createSpyStorage(new Map([[ROOT, leafData]]));
      // Plain remote without checkMany
      const remote = createSpyStorage();

      const storage = createCachedStorage({
        cache,
        remote,
        writeBack: { getChildKeys },
      });

      await storage.syncTree(ROOT);

      // Should have called has() as fallback, then put()
      expect(remote.calls.filter((c) => c.method === "has")).toHaveLength(1);
      expect(remote.store.get(ROOT)).toEqual(leafData);

      storage.dispose();
    });
  });

  describe("dispose", () => {
    it("should not throw when called", () => {
      const cache = createSpyStorage();
      const remote = createSpyStorage();

      const storage = createCachedStorage({
        cache,
        remote,
        writeBack: {},
      });

      expect(() => storage.dispose()).not.toThrow();
    });
  });

  describe("integration", () => {
    it("should serve put data from cache before syncTree", async () => {
      const cache = createSpyStorage();
      const remote = createSpyStorage();

      const storage = createCachedStorage({
        cache,
        remote,
        writeBack: {},
      });

      await storage.put(KEY, DATA);

      // Get returns cached data even though syncTree hasn't been called
      const result = await storage.get(KEY);
      expect(result).toEqual(DATA);

      storage.dispose();
    });

    it("should serve cached key via get after put", async () => {
      const cache = createSpyStorage();
      const remote = createSpyStorage();

      const storage = createCachedStorage({
        cache,
        remote,
        writeBack: {},
      });

      await storage.put(KEY, DATA);

      expect(await storage.get(KEY)).toEqual(DATA);

      storage.dispose();
    });

    it("should flush in write-through mode as no-op", async () => {
      const cache = createSpyStorage();
      const remote = createSpyStorage();

      const storage = createCachedStorage({ cache, remote });

      await storage.put(KEY, DATA);
      await storage.flush(); // no-op
      storage.dispose(); // no-op

      expect(remote.store.get(KEY)).toEqual(DATA);
    });
  });
});
