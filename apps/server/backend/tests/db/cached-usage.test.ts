/**
 * Unit tests for cached-usage.ts
 *
 * Tests the Redis caching wrapper around UsageDb:
 * - getUsage: cache hit/miss, always caches (even default zero record)
 * - getUserQuota: cache hit/miss
 * - No explicit invalidation — TTL-only strategy
 * - Other methods pass through untouched
 * - redis=null returns raw db
 */

import { describe, expect, it, mock } from "bun:test";
import { withUsageCache } from "../../src/db/cached-usage.ts";
import type { UsageDb } from "../../src/db/usage.ts";
import type { UserQuotaRecord } from "../../src/types/delegate-token.ts";
import type { RealmUsage } from "../../src/types.ts";

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

const SAMPLE_USAGE: RealmUsage = {
  realm: "usr_OWNER",
  physicalBytes: 1024,
  logicalBytes: 2048,
  nodeCount: 10,
  quotaLimit: 1_000_000,
  updatedAt: 1700000000000,
};

const SAMPLE_QUOTA: UserQuotaRecord = {
  pk: "QUOTA#usr_OWNER",
  sk: "USER",
  realm: "usr_OWNER",
  quotaLimit: 1_000_000,
  bytesUsed: 512,
  tokenCount: 2,
  depotCount: 1,
  createdAt: 1700000000000,
  lastUpdated: 1700000000000,
};

function createMockUsageDb(overrides: Partial<UsageDb> = {}): UsageDb {
  return {
    getUsage: overrides.getUsage ?? mock(async () => SAMPLE_USAGE),
    updateUsage: overrides.updateUsage ?? mock(async () => {}),
    checkQuota: overrides.checkQuota ?? mock(async () => ({ allowed: true, usage: SAMPLE_USAGE })),
    setQuotaLimit: overrides.setQuotaLimit ?? mock(async () => {}),
    getUserQuota: overrides.getUserQuota ?? mock(async () => SAMPLE_QUOTA),
    updateUserQuota: overrides.updateUserQuota ?? mock(async () => {}),
    incrementResourceCount: overrides.incrementResourceCount ?? mock(async () => {}),
    decrementResourceCount: overrides.decrementResourceCount ?? mock(async () => {}),
    checkResourceLimit:
      overrides.checkResourceLimit ?? mock(async () => ({ allowed: true, currentCount: 0 })),
  };
}

const PREFIX = "test:";
const TTL = 5;

// ============================================================================
// Tests
// ============================================================================

describe("withUsageCache", () => {
  it("returns raw db when redis is null", () => {
    const db = createMockUsageDb();
    expect(withUsageCache(db, null, PREFIX)).toBe(db);
  });

  // --------------------------------------------------------------------------
  // getUsage
  // --------------------------------------------------------------------------

  describe("getUsage", () => {
    it("returns parsed usage from cache hit (skips DB)", async () => {
      const redis = createMockRedis();
      redis.get = mock(async () => JSON.stringify(SAMPLE_USAGE));
      const db = createMockUsageDb();
      const cached = withUsageCache(db, redis as any, PREFIX, TTL);

      const result = await cached.getUsage("usr_OWNER");

      expect(result).toEqual(SAMPLE_USAGE);
      expect(redis.get).toHaveBeenCalledWith("test:usg:usr_OWNER");
      expect(db.getUsage).not.toHaveBeenCalled();
    });

    it("falls through on cache miss and caches result with TTL", async () => {
      const redis = createMockRedis();
      const db = createMockUsageDb();
      const cached = withUsageCache(db, redis as any, PREFIX, TTL);

      const result = await cached.getUsage("usr_OWNER");

      expect(result).toEqual(SAMPLE_USAGE);
      expect(db.getUsage).toHaveBeenCalledWith("usr_OWNER");
      await new Promise((r) => setTimeout(r, 10));
      expect(redis.set).toHaveBeenCalledWith(
        "test:usg:usr_OWNER",
        JSON.stringify(SAMPLE_USAGE),
        "EX",
        TTL
      );
    });

    it("always caches result (even zero/default usage)", async () => {
      const zeroUsage: RealmUsage = {
        ...SAMPLE_USAGE,
        physicalBytes: 0,
        logicalBytes: 0,
        nodeCount: 0,
      };
      const redis = createMockRedis();
      const db = createMockUsageDb({ getUsage: mock(async () => zeroUsage) });
      const cached = withUsageCache(db, redis as any, PREFIX, TTL);

      await cached.getUsage("usr_NEW");

      await new Promise((r) => setTimeout(r, 10));
      expect(redis.set).toHaveBeenCalled();
    });

    it("falls through on corrupted cache entry", async () => {
      const redis = createMockRedis();
      redis.get = mock(async () => "{{invalid json");
      const db = createMockUsageDb();
      const cached = withUsageCache(db, redis as any, PREFIX, TTL);

      const result = await cached.getUsage("usr_OWNER");

      expect(result).toEqual(SAMPLE_USAGE);
      expect(db.getUsage).toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // getUserQuota
  // --------------------------------------------------------------------------

  describe("getUserQuota", () => {
    it("returns parsed quota from cache hit", async () => {
      const redis = createMockRedis();
      redis.get = mock(async () => JSON.stringify(SAMPLE_QUOTA));
      const db = createMockUsageDb();
      const cached = withUsageCache(db, redis as any, PREFIX, TTL);

      const result = await cached.getUserQuota("usr_OWNER");

      expect(result).toEqual(SAMPLE_QUOTA);
      expect(redis.get).toHaveBeenCalledWith("test:usg:q:usr_OWNER");
      expect(db.getUserQuota).not.toHaveBeenCalled();
    });

    it("falls through on cache miss and caches with TTL", async () => {
      const redis = createMockRedis();
      const db = createMockUsageDb();
      const cached = withUsageCache(db, redis as any, PREFIX, TTL);

      const result = await cached.getUserQuota("usr_OWNER");

      expect(result).toEqual(SAMPLE_QUOTA);
      expect(db.getUserQuota).toHaveBeenCalledWith("usr_OWNER");
      await new Promise((r) => setTimeout(r, 10));
      expect(redis.set).toHaveBeenCalledWith(
        "test:usg:q:usr_OWNER",
        JSON.stringify(SAMPLE_QUOTA),
        "EX",
        TTL
      );
    });
  });

  // --------------------------------------------------------------------------
  // passthrough (no caching / no invalidation)
  // --------------------------------------------------------------------------

  describe("passthrough", () => {
    it("updateUsage passes through without cache interaction", async () => {
      const redis = createMockRedis();
      const db = createMockUsageDb();
      const cached = withUsageCache(db, redis as any, PREFIX, TTL);

      await cached.updateUsage("usr_OWNER", { physicalBytes: 100 });

      expect(db.updateUsage).toHaveBeenCalledWith("usr_OWNER", { physicalBytes: 100 });
      expect(redis.del).not.toHaveBeenCalled();
    });

    it("checkQuota passes through", async () => {
      const redis = createMockRedis();
      const db = createMockUsageDb();
      const cached = withUsageCache(db, redis as any, PREFIX, TTL);

      const result = await cached.checkQuota("usr_OWNER", 500);

      expect(result.allowed).toBe(true);
      expect(db.checkQuota).toHaveBeenCalledWith("usr_OWNER", 500);
    });

    it("incrementResourceCount passes through", async () => {
      const redis = createMockRedis();
      const db = createMockUsageDb();
      const cached = withUsageCache(db, redis as any, PREFIX, TTL);

      await cached.incrementResourceCount("usr_OWNER", "token", 1);

      expect(db.incrementResourceCount).toHaveBeenCalledWith("usr_OWNER", "token", 1);
    });
  });
});
