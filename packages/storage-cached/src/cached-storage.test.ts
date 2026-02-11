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
import { createCachedStorage } from "./cached-storage.ts";

// ============================================================================
// In-memory storage helper (observable)
// ============================================================================

type Call = { method: string; args: unknown[] };

function createSpyStorage(
  initial: Map<string, Uint8Array> = new Map(),
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
