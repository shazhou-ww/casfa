/**
 * Cached Usage wrapper — wraps UsageDb with Redis caching.
 *
 * Cached methods:
 *   getUsage(realm)       → `usg:{realm}`   — TTL 5s (optimistic)
 *   getUserQuota(realm)   → `usg:q:{realm}` — TTL 5s (optimistic)
 *
 * No explicit invalidation — TTL handles staleness.
 * updateUsage is called on every upload; DEL on every write would negate caching.
 * 5s staleness is acceptable for quota checks.
 */

import type Redis from "ioredis";
import { cacheGet, cacheSet } from "./cache.ts";
import type { UsageDb } from "./usage.ts";

const DEFAULT_TTL = 5; // seconds

export const withUsageCache = (
  db: UsageDb,
  redis: Redis | null,
  prefix: string,
  ttl = DEFAULT_TTL
): UsageDb => {
  if (!redis) return db;

  return {
    ...db,

    getUsage: async (realm) => {
      const key = `${prefix}usg:${realm}`;
      const cached = await cacheGet(redis, key);
      if (cached) {
        try {
          return JSON.parse(cached);
        } catch {
          /* fall through */
        }
      }

      const result = await db.getUsage(realm);
      cacheSet(redis, key, JSON.stringify(result), ttl).catch(() => {});
      return result;
    },

    getUserQuota: async (realm) => {
      const key = `${prefix}usg:q:${realm}`;
      const cached = await cacheGet(redis, key);
      if (cached) {
        try {
          return JSON.parse(cached);
        } catch {
          /* fall through */
        }
      }

      const result = await db.getUserQuota(realm);
      cacheSet(redis, key, JSON.stringify(result), ttl).catch(() => {});
      return result;
    },
  };
};
