/**
 * Unit tests for cache.ts — thin Redis wrappers that never throw.
 */

import { describe, expect, it, mock } from "bun:test";
import { cacheDel, cacheGet, cacheMGet, cacheSet } from "../../src/db/cache.ts";

// ============================================================================
// Mock Redis
// ============================================================================

type MockRedis = {
  get: ReturnType<typeof mock>;
  set: ReturnType<typeof mock>;
  del: ReturnType<typeof mock>;
  mget: ReturnType<typeof mock>;
};

function createMockRedis(overrides: Partial<MockRedis> = {}): MockRedis {
  return {
    get: overrides.get ?? mock(async () => null),
    set: overrides.set ?? mock(async () => "OK"),
    del: overrides.del ?? mock(async () => 1),
    mget: overrides.mget ?? mock(async () => []),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("cacheGet", () => {
  it("returns null when redis is null", async () => {
    expect(await cacheGet(null, "key")).toBeNull();
  });

  it("returns value on cache hit", async () => {
    const redis = createMockRedis({ get: mock(async () => "hello") });
    expect(await cacheGet(redis as any, "key")).toBe("hello");
    expect(redis.get).toHaveBeenCalledWith("key");
  });

  it("returns null on cache miss", async () => {
    const redis = createMockRedis({ get: mock(async () => null) });
    expect(await cacheGet(redis as any, "key")).toBeNull();
  });

  it("returns null on error (never throws)", async () => {
    const redis = createMockRedis({
      get: mock(async () => {
        throw new Error("connection lost");
      }),
    });
    expect(await cacheGet(redis as any, "key")).toBeNull();
  });
});

describe("cacheSet", () => {
  it("does nothing when redis is null", async () => {
    await cacheSet(null, "key", "value");
    // No error thrown
  });

  it("calls SET without TTL when ttl is undefined", async () => {
    const redis = createMockRedis();
    await cacheSet(redis as any, "key", "value");
    expect(redis.set).toHaveBeenCalledWith("key", "value");
  });

  it("calls SET with EX when ttl > 0", async () => {
    const redis = createMockRedis();
    await cacheSet(redis as any, "key", "value", 30);
    expect(redis.set).toHaveBeenCalledWith("key", "value", "EX", 30);
  });

  it("calls SET without EX when ttl is 0", async () => {
    const redis = createMockRedis();
    await cacheSet(redis as any, "key", "value", 0);
    expect(redis.set).toHaveBeenCalledWith("key", "value");
  });

  it("swallows errors (never throws)", async () => {
    const redis = createMockRedis({
      set: mock(async () => {
        throw new Error("write error");
      }),
    });
    await cacheSet(redis as any, "key", "value");
    // No error thrown
  });
});

describe("cacheDel", () => {
  it("does nothing when redis is null", async () => {
    await cacheDel(null, "key");
  });

  it("calls DEL on the key", async () => {
    const redis = createMockRedis();
    await cacheDel(redis as any, "key");
    expect(redis.del).toHaveBeenCalledWith("key");
  });

  it("swallows errors (never throws)", async () => {
    const redis = createMockRedis({
      del: mock(async () => {
        throw new Error("del error");
      }),
    });
    await cacheDel(redis as any, "key");
  });
});

describe("cacheMGet", () => {
  it("returns all nulls when redis is null", async () => {
    const result = await cacheMGet(null, ["a", "b", "c"]);
    expect(result).toEqual([null, null, null]);
  });

  it("returns all nulls for empty keys", async () => {
    const redis = createMockRedis();
    const result = await cacheMGet(redis as any, []);
    expect(result).toEqual([]);
    expect(redis.mget).not.toHaveBeenCalled();
  });

  it("returns MGET results on success", async () => {
    const redis = createMockRedis({
      mget: mock(async () => ["1", null, "1"]),
    });
    const result = await cacheMGet(redis as any, ["a", "b", "c"]);
    expect(result).toEqual(["1", null, "1"]);
  });

  it("returns all nulls on error (never throws)", async () => {
    const redis = createMockRedis({
      mget: mock(async () => {
        throw new Error("mget error");
      }),
    });
    const result = await cacheMGet(redis as any, ["a", "b"]);
    expect(result).toEqual([null, null]);
  });
});
