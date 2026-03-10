/**
 * Cache utilities — thin wrappers around Redis that never throw.
 *
 * Every function accepts `Redis | null` and silently returns null / void
 * when Redis is unavailable. This guarantees the system works identically
 * with or without a cache layer.
 */

import type Redis from "ioredis";

// ============================================================================
// Core operations
// ============================================================================

/** GET — returns cached string or null on miss / error */
export const cacheGet = async (redis: Redis | null, key: string): Promise<string | null> => {
  if (!redis) return null;
  try {
    return await redis.get(key);
  } catch {
    return null;
  }
};

/** SET — fire-and-forget. Optional TTL in seconds (0 / undefined = no expiry) */
export const cacheSet = async (
  redis: Redis | null,
  key: string,
  value: string,
  ttlSeconds?: number
): Promise<void> => {
  if (!redis) return;
  try {
    if (ttlSeconds && ttlSeconds > 0) {
      await redis.set(key, value, "EX", ttlSeconds);
    } else {
      await redis.set(key, value);
    }
  } catch {
    // silently ignore
  }
};

/** DEL — fire-and-forget */
export const cacheDel = async (redis: Redis | null, key: string): Promise<void> => {
  if (!redis) return;
  try {
    await redis.del(key);
  } catch {
    // silently ignore
  }
};

/** MGET — batch get. Returns array of same length; null for misses / errors. */
export const cacheMGet = async (
  redis: Redis | null,
  keys: string[]
): Promise<(string | null)[]> => {
  if (!redis || keys.length === 0) return keys.map(() => null);
  try {
    return await redis.mget(...keys);
  } catch {
    return keys.map(() => null);
  }
};
