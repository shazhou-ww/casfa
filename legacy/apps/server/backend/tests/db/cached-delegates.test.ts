/**
 * Unit tests for cached-delegates.ts
 *
 * Tests the Redis caching wrapper around DelegatesDb:
 * - get: cache hit returns parsed JSON without calling DB
 * - get: cache miss calls DB, caches positive result with TTL
 * - get: corrupted cache entry falls through to DB
 * - revoke: delegates to DB and invalidates cache
 * - rotateTokens: delegates to DB and invalidates cache
 * - Other methods pass through untouched
 * - redis=null returns raw db
 */

import { describe, expect, it, mock } from "bun:test";
import type { Delegate } from "@casfa/delegate";
import { withDelegateCache } from "../../src/db/cached-delegates.ts";
import type { DelegatesDb } from "../../src/db/delegates.ts";

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

const SAMPLE_DELEGATE: Delegate = {
  delegateId: "dlt_TEST1",
  realm: "usr_OWNER",
  depth: 1,
  parentId: "dlt_ROOT",
  chain: ["dlt_ROOT", "dlt_TEST1"],
  canUpload: true,
  canManageDepot: false,
  isRevoked: false,
  createdAt: 1700000000000,
  currentAtHash: "athash",
  currentRtHash: "rthash",
  atExpiresAt: 1700003600000,
};

function createMockDelegatesDb(overrides: Partial<DelegatesDb> = {}): DelegatesDb {
  return {
    create: overrides.create ?? mock(async () => {}),
    get: overrides.get ?? mock(async () => null),
    revoke: overrides.revoke ?? mock(async () => true),
    listChildren: overrides.listChildren ?? mock(async () => ({ delegates: [] })),
    rotateTokens: overrides.rotateTokens ?? mock(async () => true),
    getOrCreateRoot:
      overrides.getOrCreateRoot ?? mock(async () => ({ delegate: SAMPLE_DELEGATE, created: true })),
    getRootByRealm: overrides.getRootByRealm ?? mock(async () => null),
  };
}

const PREFIX = "test:";
const TTL = 30;

// ============================================================================
// Tests
// ============================================================================

describe("withDelegateCache", () => {
  it("returns raw db when redis is null", () => {
    const db = createMockDelegatesDb();
    expect(withDelegateCache(db, null, PREFIX)).toBe(db);
  });

  // --------------------------------------------------------------------------
  // get
  // --------------------------------------------------------------------------

  describe("get", () => {
    it("returns parsed delegate from cache hit (skips DB)", async () => {
      const redis = createMockRedis();
      redis.get = mock(async () => JSON.stringify(SAMPLE_DELEGATE));
      const db = createMockDelegatesDb();
      const cached = withDelegateCache(db, redis as any, PREFIX, TTL);

      const result = await cached.get("dlt_TEST1");

      expect(result).toEqual(SAMPLE_DELEGATE);
      expect(redis.get).toHaveBeenCalledWith("test:dlg:dlt_TEST1");
      expect(db.get).not.toHaveBeenCalled();
    });

    it("falls through to DB on cache miss and caches result", async () => {
      const redis = createMockRedis();
      const db = createMockDelegatesDb({
        get: mock(async () => SAMPLE_DELEGATE),
      });
      const cached = withDelegateCache(db, redis as any, PREFIX, TTL);

      const result = await cached.get("dlt_TEST1");

      expect(result).toEqual(SAMPLE_DELEGATE);
      expect(db.get).toHaveBeenCalledWith("dlt_TEST1");
      await new Promise((r) => setTimeout(r, 10));
      expect(redis.set).toHaveBeenCalledWith(
        "test:dlg:dlt_TEST1",
        JSON.stringify(SAMPLE_DELEGATE),
        "EX",
        TTL
      );
    });

    it("does NOT cache null (delegate not found)", async () => {
      const redis = createMockRedis();
      const db = createMockDelegatesDb({ get: mock(async () => null) });
      const cached = withDelegateCache(db, redis as any, PREFIX, TTL);

      const result = await cached.get("dlt_MISSING");

      expect(result).toBeNull();
      await new Promise((r) => setTimeout(r, 10));
      expect(redis.set).not.toHaveBeenCalled();
    });

    it("falls through to DB on corrupted cache entry", async () => {
      const redis = createMockRedis();
      redis.get = mock(async () => "not-valid-json{{{");
      const db = createMockDelegatesDb({
        get: mock(async () => SAMPLE_DELEGATE),
      });
      const cached = withDelegateCache(db, redis as any, PREFIX, TTL);

      const result = await cached.get("dlt_TEST1");

      expect(result).toEqual(SAMPLE_DELEGATE);
      expect(db.get).toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // revoke
  // --------------------------------------------------------------------------

  describe("revoke", () => {
    it("delegates to DB and invalidates cache", async () => {
      const redis = createMockRedis();
      const db = createMockDelegatesDb({ revoke: mock(async () => true) });
      const cached = withDelegateCache(db, redis as any, PREFIX, TTL);

      const result = await cached.revoke("dlt_TEST1", "usr_ADMIN");

      expect(result).toBe(true);
      expect(db.revoke).toHaveBeenCalledWith("dlt_TEST1", "usr_ADMIN");
      await new Promise((r) => setTimeout(r, 10));
      expect(redis.del).toHaveBeenCalledWith("test:dlg:dlt_TEST1");
    });
  });

  // --------------------------------------------------------------------------
  // rotateTokens
  // --------------------------------------------------------------------------

  describe("rotateTokens", () => {
    it("delegates to DB and invalidates cache", async () => {
      const redis = createMockRedis();
      const db = createMockDelegatesDb({ rotateTokens: mock(async () => true) });
      const cached = withDelegateCache(db, redis as any, PREFIX, TTL);

      const params = {
        delegateId: "dlt_TEST1",
        expectedRtHash: "old",
        newRtHash: "new_rt",
        newAtHash: "new_at",
        newAtExpiresAt: Date.now() + 3600000,
      };

      const result = await cached.rotateTokens(params);

      expect(result).toBe(true);
      expect(db.rotateTokens).toHaveBeenCalledWith(params);
      await new Promise((r) => setTimeout(r, 10));
      expect(redis.del).toHaveBeenCalledWith("test:dlg:dlt_TEST1");
    });
  });

  // --------------------------------------------------------------------------
  // passthrough methods
  // --------------------------------------------------------------------------

  describe("passthrough", () => {
    it("create is passed through without caching", async () => {
      const redis = createMockRedis();
      const db = createMockDelegatesDb();
      const cached = withDelegateCache(db, redis as any, PREFIX, TTL);

      await cached.create(SAMPLE_DELEGATE);
      expect(db.create).toHaveBeenCalledWith(SAMPLE_DELEGATE);
    });

    it("listChildren is passed through", async () => {
      const redis = createMockRedis();
      const db = createMockDelegatesDb({
        listChildren: mock(async () => ({ delegates: [SAMPLE_DELEGATE] })),
      });
      const cached = withDelegateCache(db, redis as any, PREFIX, TTL);

      const result = await cached.listChildren("dlt_ROOT");
      expect(result.delegates).toHaveLength(1);
    });

    it("getRootByRealm is passed through", async () => {
      const redis = createMockRedis();
      const db = createMockDelegatesDb({
        getRootByRealm: mock(async () => SAMPLE_DELEGATE),
      });
      const cached = withDelegateCache(db, redis as any, PREFIX, TTL);

      const result = await cached.getRootByRealm("usr_OWNER");
      expect(result).toEqual(SAMPLE_DELEGATE);
    });
  });
});
