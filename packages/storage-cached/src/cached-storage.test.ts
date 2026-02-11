/**
 * Unit tests for createCachedStorage
 *
 * Uses two in-memory StorageProviders (cache + remote) to verify:
 * - get: cache hit / cache miss + write-back / remote miss
 * - has: cache hit / fallback to remote
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
    async has(key) {
      calls.push({ method: "has", args: [key] });
      return store.has(key);
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
        has: async () => false,
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
  // Tests — has
  // ==========================================================================

  describe("has", () => {
    it("should return true immediately on cache hit", async () => {
      const cache = createSpyStorage(new Map([[KEY, DATA]]));
      const remote = createSpyStorage();

      const storage = createCachedStorage({ cache, remote });
      expect(await storage.has(KEY)).toBe(true);
      expect(remote.calls).toHaveLength(0);
    });

    it("should fall back to remote on cache miss", async () => {
      const cache = createSpyStorage();
      const remote = createSpyStorage(new Map([[KEY, DATA]]));

      const storage = createCachedStorage({ cache, remote });
      expect(await storage.has(KEY)).toBe(true);

      // cache.has (miss) → remote.has (hit)
      expect(cache.calls[0]).toEqual({ method: "has", args: [KEY] });
      expect(remote.calls[0]).toEqual({ method: "has", args: [KEY] });
    });

    it("should return false when both miss", async () => {
      const cache = createSpyStorage();
      const remote = createSpyStorage();

      const storage = createCachedStorage({ cache, remote });
      expect(await storage.has(KEY)).toBe(false);
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
        has: async () => false,
        put: async () => {
          order.push("cache");
        },
      };
      const remote: StorageProvider = {
        get: async () => null,
        has: async () => false,
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
        has: async () => false,
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
  const DEBOUNCE = 20;

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  describe("put", () => {
    it("should write to cache immediately but not to remote", async () => {
      const cache = createSpyStorage();
      const remote = createSpyStorage();

      const storage = createCachedStorage({
        cache,
        remote,
        writeBack: { debounceMs: DEBOUNCE },
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
      // Remote put that takes a long time
      const remote: StorageProvider = {
        get: async () => null,
        has: async () => false,
        put: async () => {
          await wait(500);
        },
      };

      const storage = createCachedStorage({
        cache,
        remote,
        writeBack: { debounceMs: DEBOUNCE },
      });

      const start = Date.now();
      await storage.put(KEY, DATA);
      const elapsed = Date.now() - start;

      // Should return nearly instantly (≪ 500ms)
      expect(elapsed).toBeLessThan(50);

      storage.dispose();
    });
  });

  describe("debounced sync", () => {
    it("should sync to remote after debounce interval", async () => {
      const cache = createSpyStorage();
      const remote = createSpyStorage();

      const storage = createCachedStorage({
        cache,
        remote,
        writeBack: { debounceMs: DEBOUNCE },
      });

      await storage.put(KEY, DATA);

      // Not synced yet
      expect(remote.store.has(KEY)).toBe(false);

      // Wait for debounce + some buffer
      await wait(DEBOUNCE + 50);

      // Now it should be synced
      expect(remote.store.get(KEY)).toEqual(DATA);

      storage.dispose();
    });

    it("should batch multiple puts into one sync cycle", async () => {
      const cache = createSpyStorage();
      const remote = createSpyStorage();
      const syncEvents: string[] = [];

      const storage = createCachedStorage({
        cache,
        remote,
        writeBack: {
          debounceMs: DEBOUNCE,
          onSyncStart: () => syncEvents.push("start"),
          onSyncEnd: () => syncEvents.push("end"),
        },
      });

      const key2 = "ZYXWVUTSRQPONMLKJIHGFEDCB0";
      const data2 = new Uint8Array([5, 6, 7, 8]);

      await storage.put(KEY, DATA);
      await storage.put(key2, data2);

      await wait(DEBOUNCE + 50);

      // Both should be synced
      expect(remote.store.get(KEY)).toEqual(DATA);
      expect(remote.store.get(key2)).toEqual(data2);

      // Only one sync cycle
      expect(syncEvents).toEqual(["start", "end"]);

      storage.dispose();
    });

    it("should sync keys already on remote (remote.put handles dedup)", async () => {
      const cache = createSpyStorage();
      const remote = createSpyStorage(new Map([[KEY, DATA]]));
      let lastResult: SyncResult | null = null;

      const storage = createCachedStorage({
        cache,
        remote,
        writeBack: {
          debounceMs: DEBOUNCE,
          onSyncEnd: (result) => {
            lastResult = result;
          },
        },
      });

      // Put a key that remote already has — remote.put() is still called
      // (the remote itself handles dedup via its internal check)
      await storage.put(KEY, DATA);
      await wait(DEBOUNCE + 50);

      expect(lastResult).not.toBeNull();
      expect(lastResult!.synced).toEqual([KEY]);
      expect(lastResult!.failed).toHaveLength(0);

      // remote.put IS called (no separate has-check in runSync)
      expect(remote.calls.filter((c) => c.method === "put")).toHaveLength(1);

      storage.dispose();
    });
  });

  describe("sync callbacks", () => {
    it("should call onSyncStart and onSyncEnd", async () => {
      const cache = createSpyStorage();
      const remote = createSpyStorage();
      const events: string[] = [];
      let capturedResult: SyncResult | null = null;

      const storage = createCachedStorage({
        cache,
        remote,
        writeBack: {
          debounceMs: DEBOUNCE,
          onSyncStart: () => events.push("start"),
          onSyncEnd: (result) => {
            events.push("end");
            capturedResult = result;
          },
        },
      });

      await storage.put(KEY, DATA);
      await wait(DEBOUNCE + 50);

      expect(events).toEqual(["start", "end"]);
      expect(capturedResult!.synced).toEqual([KEY]);
      expect(capturedResult!.skipped).toHaveLength(0);
      expect(capturedResult!.failed).toHaveLength(0);

      storage.dispose();
    });

    it("should report failed uploads in SyncResult", async () => {
      const cache = createSpyStorage();
      const failKey = "FAILFAILFAILFAILFAILFAILFA";
      const remote: StorageProvider & { calls: Call[] } = {
        calls: [],
        get: async () => null,
        has: async (key) => {
          remote.calls.push({ method: "has", args: [key] });
          return false;
        },
        put: async (key) => {
          remote.calls.push({ method: "put", args: [key] });
          if (key === failKey) throw new Error("upload failed");
        },
      };
      const results: SyncResult[] = [];

      const storage = createCachedStorage({
        cache,
        remote,
        writeBack: {
          debounceMs: DEBOUNCE,
          onSyncEnd: (result) => {
            results.push(result);
          },
        },
      });

      await storage.put(KEY, DATA);
      await storage.put(failKey, new Uint8Array([9, 9]));
      // flush retries then throws because failKey keeps failing
      await expect(storage.flush()).rejects.toThrow(/Failed to sync 1 keys/);

      // First sync result: KEY succeeded, failKey failed
      expect(results.length).toBeGreaterThanOrEqual(1);
      const firstResult = results[0]!;
      expect(firstResult.synced).toEqual([KEY]);
      expect(firstResult.failed).toHaveLength(1);
      expect(firstResult.failed[0]!.key).toBe(failKey);

      storage.dispose();
    });
  });

  describe("flush", () => {
    it("should force immediate sync without waiting for debounce", async () => {
      const cache = createSpyStorage();
      const remote = createSpyStorage();

      const storage = createCachedStorage({
        cache,
        remote,
        writeBack: { debounceMs: 5000 }, // very long debounce
      });

      await storage.put(KEY, DATA);

      // Not synced yet (debounce is 5s)
      expect(remote.store.has(KEY)).toBe(false);

      // Flush forces immediate sync
      await storage.flush();

      expect(remote.store.get(KEY)).toEqual(DATA);

      storage.dispose();
    });

    it("should be a no-op when nothing is pending", async () => {
      const cache = createSpyStorage();
      const remote = createSpyStorage();

      const storage = createCachedStorage({
        cache,
        remote,
        writeBack: { debounceMs: DEBOUNCE },
      });

      // Flush with nothing pending should not throw
      await storage.flush();

      expect(remote.calls).toHaveLength(0);

      storage.dispose();
    });

    it("should wait for in-progress sync to complete", async () => {
      const cache = createSpyStorage();
      const syncOrder: string[] = [];
      const gate: { resolve: (() => void) | null } = { resolve: null };
      let firstPutBlocked = false;

      const remote: StorageProvider = {
        get: async () => null,
        has: async () => false,
        put: async (key, _value) => {
          if (!firstPutBlocked) {
            // Block the first put
            firstPutBlocked = true;
            syncOrder.push(`put:${key}:start`);
            await new Promise<void>((resolve) => {
              gate.resolve = resolve;
            });
            syncOrder.push(`put:${key}:end`);
          } else {
            syncOrder.push(`put:${key}`);
          }
        },
      };

      const storage = createCachedStorage({
        cache,
        remote,
        writeBack: { debounceMs: 5 },
      });

      await storage.put(KEY, DATA);

      // Wait for debounce to trigger sync (put will block)
      await wait(15);

      // Sync is in progress (blocked on first put)
      expect(syncOrder).toEqual([`put:${KEY}:start`]);

      // Unblock the first put
      gate.resolve?.();
      await wait(5);

      expect(syncOrder).toContain(`put:${KEY}:end`);

      storage.dispose();
    });
  });

  describe("dispose", () => {
    it("should cancel pending debounced sync", async () => {
      const cache = createSpyStorage();
      const remote = createSpyStorage();

      const storage = createCachedStorage({
        cache,
        remote,
        writeBack: { debounceMs: DEBOUNCE },
      });

      await storage.put(KEY, DATA);
      storage.dispose();

      // Wait past the debounce
      await wait(DEBOUNCE + 50);

      // Remote should NOT have the data (timer was cancelled)
      expect(remote.store.has(KEY)).toBe(false);
    });
  });

  describe("integration", () => {
    it("should serve put data from cache before sync completes", async () => {
      const cache = createSpyStorage();
      const remote = createSpyStorage();

      const storage = createCachedStorage({
        cache,
        remote,
        writeBack: { debounceMs: 5000 },
      });

      await storage.put(KEY, DATA);

      // Get returns cached data even though remote sync hasn't happened
      const result = await storage.get(KEY);
      expect(result).toEqual(DATA);

      storage.dispose();
    });

    it("should report has=true for pending keys via cache", async () => {
      const cache = createSpyStorage();
      const remote = createSpyStorage();

      const storage = createCachedStorage({
        cache,
        remote,
        writeBack: { debounceMs: 5000 },
      });

      await storage.put(KEY, DATA);

      // has returns true from cache even before remote sync
      expect(await storage.has(KEY)).toBe(true);

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
