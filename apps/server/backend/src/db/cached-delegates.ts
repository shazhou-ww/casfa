/**
 * Cached Delegates wrapper — wraps DelegatesDb with Redis caching.
 *
 * Cached methods:
 *   get(delegateId)  → `dlg:{id}` — TTL 30s
 *
 * Invalidation (DEL after mutation):
 *   revoke(delegateId, ...)
 *   rotateTokens({ delegateId, ... })
 */

import type Redis from "ioredis";
import { cacheDel, cacheGet, cacheSet } from "./cache.ts";
import type { DelegatesDb } from "./delegates.ts";

const DEFAULT_TTL = 30; // seconds

export const withDelegateCache = (
  db: DelegatesDb,
  redis: Redis | null,
  prefix: string,
  ttl = DEFAULT_TTL
): DelegatesDb => {
  if (!redis) return db;

  const keyFor = (delegateId: string) => `${prefix}dlg:${delegateId}`;

  return {
    ...db,

    get: async (delegateId) => {
      const key = keyFor(delegateId);
      const cached = await cacheGet(redis, key);
      if (cached) {
        try {
          return JSON.parse(cached);
        } catch {
          // corrupted cache entry — fall through
        }
      }

      const result = await db.get(delegateId);
      if (result) {
        cacheSet(redis, key, JSON.stringify(result), ttl).catch(() => {});
      }
      return result;
    },

    revoke: async (delegateId, revokedBy) => {
      const result = await db.revoke(delegateId, revokedBy);
      cacheDel(redis, keyFor(delegateId)).catch(() => {});
      return result;
    },

    rotateTokens: async (params) => {
      const result = await db.rotateTokens(params);
      cacheDel(redis, keyFor(params.delegateId)).catch(() => {});
      return result;
    },
  };
};
