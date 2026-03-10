/**
 * Unit tests for cached-ownership.ts
 *
 * Tests the Redis caching wrapper around OwnershipV2Db:
 * - Cache hit → skip DynamoDB
 * - Cache miss → call DynamoDB, warm cache on positive result
 * - Only positive results cached (negative never cached)
 * - addOwnership pre-warms cache for all chain members
 * - hasOwnershipBatch uses MGET then falls through
 * - Graceful degradation: redis=null returns raw db
 */

import { describe, expect, it, mock } from "bun:test";
import { hasOwnershipBatch, withOwnershipCache } from "../../src/db/cached-ownership.ts";
import type { OwnershipV2Db } from "../../src/db/ownership-v2.ts";

// ============================================================================
// Mock helpers
// ============================================================================

type MockRedis = {
  get: ReturnType<typeof mock>;
  set: ReturnType<typeof mock>;
  del: ReturnType<typeof mock>;
  mget: ReturnType<typeof mock>;
};

function createMockRedis(): MockRedis {
  return {
    get: mock(async () => null),
    set: mock(async () => "OK"),
    del: mock(async () => 1),
    mget: mock(async () => []),
  };
}

function createMockOwnershipDb(overrides: Partial<OwnershipV2Db> = {}): OwnershipV2Db {
  return {
    addOwnership: overrides.addOwnership ?? mock(async () => {}),
    hasOwnership: overrides.hasOwnership ?? mock(async () => false),
    hasAnyOwnership: overrides.hasAnyOwnership ?? mock(async () => false),
    getOwnership: overrides.getOwnership ?? mock(async () => null),
    listOwners: overrides.listOwners ?? mock(async () => []),
  };
}

const PREFIX = "test:";

// ============================================================================
// withOwnershipCache
// ============================================================================

describe("withOwnershipCache", () => {
  it("returns raw db when redis is null (no-op)", () => {
    const db = createMockOwnershipDb();
    const cached = withOwnershipCache(db, null, PREFIX);
    expect(cached).toBe(db);
  });

  // --------------------------------------------------------------------------
  // hasOwnership
  // --------------------------------------------------------------------------

  describe("hasOwnership", () => {
    it("returns true from cache hit without calling DynamoDB", async () => {
      const redis = createMockRedis();
      redis.get = mock(async () => "1");
      const db = createMockOwnershipDb();
      const cached = withOwnershipCache(db, redis as any, PREFIX);

      const result = await cached.hasOwnership("HASH1", "dlt_AAA");

      expect(result).toBe(true);
      expect(redis.get).toHaveBeenCalledWith("test:own:HASH1:dlt_AAA");
      expect(db.hasOwnership).not.toHaveBeenCalled();
    });

    it("falls through to DynamoDB on cache miss and warms cache on positive", async () => {
      const redis = createMockRedis();
      const db = createMockOwnershipDb({
        hasOwnership: mock(async () => true),
      });
      const cached = withOwnershipCache(db, redis as any, PREFIX);

      const result = await cached.hasOwnership("HASH1", "dlt_AAA");

      expect(result).toBe(true);
      expect(db.hasOwnership).toHaveBeenCalledWith("HASH1", "dlt_AAA");
      // Wait for fire-and-forget set
      await new Promise((r) => setTimeout(r, 10));
      expect(redis.set).toHaveBeenCalledWith("test:own:HASH1:dlt_AAA", "1");
    });

    it("does NOT cache negative results", async () => {
      const redis = createMockRedis();
      const db = createMockOwnershipDb({
        hasOwnership: mock(async () => false),
      });
      const cached = withOwnershipCache(db, redis as any, PREFIX);

      const result = await cached.hasOwnership("HASH1", "dlt_AAA");

      expect(result).toBe(false);
      await new Promise((r) => setTimeout(r, 10));
      expect(redis.set).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // hasAnyOwnership
  // --------------------------------------------------------------------------

  describe("hasAnyOwnership", () => {
    it("returns true from cache hit", async () => {
      const redis = createMockRedis();
      redis.get = mock(async () => "1");
      const db = createMockOwnershipDb();
      const cached = withOwnershipCache(db, redis as any, PREFIX);

      expect(await cached.hasAnyOwnership("HASH1")).toBe(true);
      expect(redis.get).toHaveBeenCalledWith("test:own:any:HASH1");
      expect(db.hasAnyOwnership).not.toHaveBeenCalled();
    });

    it("falls through and warms cache on positive DB result", async () => {
      const redis = createMockRedis();
      const db = createMockOwnershipDb({
        hasAnyOwnership: mock(async () => true),
      });
      const cached = withOwnershipCache(db, redis as any, PREFIX);

      expect(await cached.hasAnyOwnership("HASH1")).toBe(true);
      await new Promise((r) => setTimeout(r, 10));
      expect(redis.set).toHaveBeenCalledWith("test:own:any:HASH1", "1");
    });

    it("does NOT cache negative results", async () => {
      const redis = createMockRedis();
      const db = createMockOwnershipDb({ hasAnyOwnership: mock(async () => false) });
      const cached = withOwnershipCache(db, redis as any, PREFIX);

      expect(await cached.hasAnyOwnership("HASH1")).toBe(false);
      await new Promise((r) => setTimeout(r, 10));
      expect(redis.set).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // addOwnership
  // --------------------------------------------------------------------------

  describe("addOwnership", () => {
    it("delegates to DB and pre-warms cache for all chain members", async () => {
      const redis = createMockRedis();
      const db = createMockOwnershipDb();
      const cached = withOwnershipCache(db, redis as any, PREFIX);

      await cached.addOwnership("HASH1", ["dlt_R", "dlt_C1"], "dlt_C1", "application/json", 100);

      expect(db.addOwnership).toHaveBeenCalledWith(
        "HASH1",
        ["dlt_R", "dlt_C1"],
        "dlt_C1",
        "application/json",
        100,
        undefined
      );

      // Wait for fire-and-forget sets
      await new Promise((r) => setTimeout(r, 10));

      // Should have set cache for each chain member + any key
      const setCalls = (redis.set as any).mock.calls;
      const keys = setCalls.map((c: any) => c[0]) as string[];
      expect(keys).toContain("test:own:HASH1:dlt_R");
      expect(keys).toContain("test:own:HASH1:dlt_C1");
      expect(keys).toContain("test:own:any:HASH1");
    });
  });

  // --------------------------------------------------------------------------
  // passthrough methods
  // --------------------------------------------------------------------------

  describe("passthrough", () => {
    it("listOwners is passed through without caching", async () => {
      const redis = createMockRedis();
      const db = createMockOwnershipDb({
        listOwners: mock(async () => ["dlt_AAA"]),
      });
      const cached = withOwnershipCache(db, redis as any, PREFIX);

      const result = await cached.listOwners("HASH1");
      expect(result).toEqual(["dlt_AAA"]);
      expect(db.listOwners).toHaveBeenCalledWith("HASH1");
    });
  });
});

// ============================================================================
// hasOwnershipBatch
// ============================================================================

describe("hasOwnershipBatch", () => {
  it("returns null for empty delegateIds", async () => {
    const db = createMockOwnershipDb();
    expect(await hasOwnershipBatch(db, null, PREFIX, "HASH1", [])).toBeNull();
  });

  it("returns first matching delegateId from MGET cache hit", async () => {
    const redis = createMockRedis();
    redis.mget = mock(async () => [null, "1", "1"]);
    const db = createMockOwnershipDb();

    const result = await hasOwnershipBatch(db, redis as any, PREFIX, "HASH1", [
      "dlt_A",
      "dlt_B",
      "dlt_C",
    ]);

    expect(result).toBe("dlt_B");
    expect(db.hasOwnership).not.toHaveBeenCalled();
  });

  it("falls through to DynamoDB when MGET misses", async () => {
    const redis = createMockRedis();
    redis.mget = mock(async () => [null, null]);
    const db = createMockOwnershipDb({
      hasOwnership: mock(async (_hash: string, id: string) => id === "dlt_B"),
    });

    const result = await hasOwnershipBatch(db, redis as any, PREFIX, "HASH1", ["dlt_A", "dlt_B"]);

    expect(result).toBe("dlt_B");
  });

  it("works without Redis (redis=null), falls through to DB", async () => {
    const db = createMockOwnershipDb({
      hasOwnership: mock(async (_hash: string, id: string) => id === "dlt_C"),
    });

    const result = await hasOwnershipBatch(db, null, PREFIX, "HASH1", ["dlt_A", "dlt_B", "dlt_C"]);

    expect(result).toBe("dlt_C");
  });

  it("returns null when none match", async () => {
    const redis = createMockRedis();
    redis.mget = mock(async () => [null, null]);
    const db = createMockOwnershipDb({
      hasOwnership: mock(async () => false),
    });

    const result = await hasOwnershipBatch(db, redis as any, PREFIX, "HASH1", ["dlt_A", "dlt_B"]);

    expect(result).toBeNull();
  });
});
