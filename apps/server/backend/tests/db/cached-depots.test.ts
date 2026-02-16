/**
 * Unit tests for cached-depots.ts
 *
 * Tests the Redis caching wrapper around DepotsDb:
 * - get: cache hit/miss, TTL, no caching of null
 * - getByName: cache hit/miss, TTL
 * - commit: delegates to DB and invalidates both ID and name keys
 * - update: invalidates old and new name keys
 * - delete: invalidates on successful delete
 * - redis=null returns raw db
 */

import { describe, expect, it, mock } from "bun:test";
import { withDepotCache } from "../../src/db/cached-depots.ts";
import type { DepotsDb, ExtendedDepot } from "../../src/db/depots.ts";

// ============================================================================
// Mock helpers
// ============================================================================

type MockRedis = {
  get: ReturnType<typeof mock>;
  set: ReturnType<typeof mock>;
  del: ReturnType<typeof mock>;
};

function createMockRedis(): MockRedis {
  return {
    get: mock(async () => null),
    set: mock(async () => "OK"),
    del: mock(async () => 1),
  };
}

const SAMPLE_DEPOT: ExtendedDepot = {
  realm: "usr_OWNER",
  depotId: "dpt_ABC",
  title: "my-depot",
  name: "my-depot",
  root: "ROOTHASH",
  maxHistory: 20,
  history: [],
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
};

function createMockDepotsDb(overrides: Partial<DepotsDb> = {}): DepotsDb {
  return {
    create: overrides.create ?? mock(async () => SAMPLE_DEPOT),
    get: overrides.get ?? mock(async () => null),
    getByName: overrides.getByName ?? mock(async () => null),
    getByTitle: overrides.getByTitle ?? mock(async () => null),
    update: overrides.update ?? mock(async () => null),
    commit: overrides.commit ?? mock(async () => null),
    delete: overrides.delete ?? mock(async () => false),
    list: overrides.list ?? mock(async () => ({ depots: [], hasMore: false })),
    listByCreator: overrides.listByCreator ?? mock(async () => ({ items: [], hasMore: false })),
    listVisibleToToken:
      overrides.listVisibleToToken ?? mock(async () => ({ items: [], hasMore: false })),
    checkAccess: overrides.checkAccess ?? mock(async () => false),
  };
}

const PREFIX = "test:";
const TTL = 10;

// ============================================================================
// Tests
// ============================================================================

describe("withDepotCache", () => {
  it("returns raw db when redis is null", () => {
    const db = createMockDepotsDb();
    expect(withDepotCache(db, null, PREFIX)).toBe(db);
  });

  // --------------------------------------------------------------------------
  // get
  // --------------------------------------------------------------------------

  describe("get", () => {
    it("returns parsed depot from cache hit", async () => {
      const redis = createMockRedis();
      redis.get = mock(async () => JSON.stringify(SAMPLE_DEPOT));
      const db = createMockDepotsDb();
      const cached = withDepotCache(db, redis as any, PREFIX, TTL);

      const result = await cached.get("usr_OWNER", "dpt_ABC");

      expect(result).toEqual(SAMPLE_DEPOT);
      expect(redis.get).toHaveBeenCalledWith("test:dpt:usr_OWNER:dpt_ABC");
      expect(db.get).not.toHaveBeenCalled();
    });

    it("falls through on cache miss, caches result with TTL", async () => {
      const redis = createMockRedis();
      const db = createMockDepotsDb({ get: mock(async () => SAMPLE_DEPOT) });
      const cached = withDepotCache(db, redis as any, PREFIX, TTL);

      const result = await cached.get("usr_OWNER", "dpt_ABC");

      expect(result).toEqual(SAMPLE_DEPOT);
      expect(db.get).toHaveBeenCalledWith("usr_OWNER", "dpt_ABC");
      await new Promise((r) => setTimeout(r, 10));
      expect(redis.set).toHaveBeenCalledWith(
        "test:dpt:usr_OWNER:dpt_ABC",
        JSON.stringify(SAMPLE_DEPOT),
        "EX",
        TTL
      );
    });

    it("does NOT cache null (depot not found)", async () => {
      const redis = createMockRedis();
      const db = createMockDepotsDb({ get: mock(async () => null) });
      const cached = withDepotCache(db, redis as any, PREFIX, TTL);

      expect(await cached.get("usr_OWNER", "dpt_MISS")).toBeNull();
      await new Promise((r) => setTimeout(r, 10));
      expect(redis.set).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // getByName
  // --------------------------------------------------------------------------

  describe("getByName", () => {
    it("returns parsed depot from cache hit", async () => {
      const redis = createMockRedis();
      redis.get = mock(async () => JSON.stringify(SAMPLE_DEPOT));
      const db = createMockDepotsDb();
      const cached = withDepotCache(db, redis as any, PREFIX, TTL);

      const result = await cached.getByName("usr_OWNER", "my-depot");

      expect(result).toEqual(SAMPLE_DEPOT);
      expect(redis.get).toHaveBeenCalledWith("test:dpt:n:usr_OWNER:my-depot");
      expect(db.getByName).not.toHaveBeenCalled();
    });

    it("falls through on miss, caches with TTL", async () => {
      const redis = createMockRedis();
      const db = createMockDepotsDb({ getByName: mock(async () => SAMPLE_DEPOT) });
      const cached = withDepotCache(db, redis as any, PREFIX, TTL);

      const result = await cached.getByName("usr_OWNER", "my-depot");

      expect(result).toEqual(SAMPLE_DEPOT);
      await new Promise((r) => setTimeout(r, 10));
      expect(redis.set).toHaveBeenCalledWith(
        "test:dpt:n:usr_OWNER:my-depot",
        JSON.stringify(SAMPLE_DEPOT),
        "EX",
        TTL
      );
    });
  });

  // --------------------------------------------------------------------------
  // commit
  // --------------------------------------------------------------------------

  describe("commit", () => {
    it("delegates to DB and invalidates ID and name keys", async () => {
      const redis = createMockRedis();
      const updated = { ...SAMPLE_DEPOT, root: "NEWROOT" };
      const db = createMockDepotsDb({ commit: mock(async () => updated) });
      const cached = withDepotCache(db, redis as any, PREFIX, TTL);

      const result = await cached.commit("usr_OWNER", "dpt_ABC", "NEWROOT");

      expect(result).toEqual(updated);
      expect(db.commit).toHaveBeenCalledWith("usr_OWNER", "dpt_ABC", "NEWROOT", undefined, undefined);
      await new Promise((r) => setTimeout(r, 10));
      const delCalls = (redis.del as any).mock.calls;
      const keys = delCalls.map((c: any) => c[0]) as string[];
      expect(keys).toContain("test:dpt:usr_OWNER:dpt_ABC");
      expect(keys).toContain("test:dpt:n:usr_OWNER:my-depot");
    });
  });

  // --------------------------------------------------------------------------
  // delete
  // --------------------------------------------------------------------------

  describe("delete", () => {
    it("invalidates cache after successful delete", async () => {
      const redis = createMockRedis();
      const db = createMockDepotsDb({
        get: mock(async () => SAMPLE_DEPOT),
        delete: mock(async () => true),
      });
      const cached = withDepotCache(db, redis as any, PREFIX, TTL);

      const result = await cached.delete("usr_OWNER", "dpt_ABC");

      expect(result).toBe(true);
      await new Promise((r) => setTimeout(r, 10));
      const delCalls = (redis.del as any).mock.calls;
      const keys = delCalls.map((c: any) => c[0]) as string[];
      expect(keys).toContain("test:dpt:usr_OWNER:dpt_ABC");
    });

    it("does NOT invalidate cache if delete returns false", async () => {
      const redis = createMockRedis();
      const db = createMockDepotsDb({
        get: mock(async () => null),
        delete: mock(async () => false),
      });
      const cached = withDepotCache(db, redis as any, PREFIX, TTL);

      const result = await cached.delete("usr_OWNER", "dpt_MISS");

      expect(result).toBe(false);
      await new Promise((r) => setTimeout(r, 10));
      expect(redis.del).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // update
  // --------------------------------------------------------------------------

  describe("update", () => {
    it("invalidates old name when renaming", async () => {
      const redis = createMockRedis();
      const updated = { ...SAMPLE_DEPOT, name: "new-name" };
      const db = createMockDepotsDb({
        get: mock(async () => SAMPLE_DEPOT),
        update: mock(async () => updated),
      });
      const cached = withDepotCache(db, redis as any, PREFIX, TTL);

      await cached.update("usr_OWNER", "dpt_ABC", { name: "new-name" });

      await new Promise((r) => setTimeout(r, 10));
      const delCalls = (redis.del as any).mock.calls;
      const keys = delCalls.map((c: any) => c[0]) as string[];
      // Should invalidate old name and id key
      expect(keys).toContain("test:dpt:usr_OWNER:dpt_ABC");
      expect(keys).toContain("test:dpt:n:usr_OWNER:my-depot");
      // Should also invalidate new name
      expect(keys).toContain("test:dpt:n:usr_OWNER:new-name");
    });
  });

  // --------------------------------------------------------------------------
  // passthrough
  // --------------------------------------------------------------------------

  describe("passthrough", () => {
    it("list is passed through without caching", async () => {
      const redis = createMockRedis();
      const db = createMockDepotsDb({
        list: mock(async () => ({ depots: [SAMPLE_DEPOT], hasMore: false })),
      });
      const cached = withDepotCache(db, redis as any, PREFIX, TTL);

      const result = await cached.list("usr_OWNER");
      expect(result.depots).toHaveLength(1);
    });
  });
});
