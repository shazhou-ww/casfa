/**
 * Cached Depots wrapper — wraps DepotsDb with Redis caching.
 *
 * Cached methods:
 *   get(realm, depotId)      → `dpt:{realm}:{depotId}` — TTL 10s
 *   getByName(realm, name)   → `dpt:n:{realm}:{name}`  — TTL 10s
 *
 * Invalidation (DEL after mutation):
 *   commit, update, delete   → DEL both keys
 */

import type Redis from "ioredis";
import { cacheDel, cacheGet, cacheSet } from "./cache.ts";
import type { DepotsDb, ExtendedDepot } from "./depots.ts";

const DEFAULT_TTL = 10; // seconds

export const withDepotCache = (
  db: DepotsDb,
  redis: Redis | null,
  prefix: string,
  ttl = DEFAULT_TTL
): DepotsDb => {
  if (!redis) return db;

  const idKey = (realm: string, depotId: string) => `${prefix}dpt:${realm}:${depotId}`;
  const nameKey = (realm: string, name: string) => `${prefix}dpt:n:${realm}:${name}`;

  /** Invalidate both ID and name keys for a depot */
  const invalidate = (depot: ExtendedDepot | null, realm: string, depotId: string) => {
    cacheDel(redis, idKey(realm, depotId)).catch(() => {});
    if (depot?.name) {
      cacheDel(redis, nameKey(realm, depot.name)).catch(() => {});
    }
    // Also try title (legacy alias)
    if (depot?.title && depot.title !== depot.name) {
      cacheDel(redis, nameKey(realm, depot.title)).catch(() => {});
    }
  };

  return {
    ...db,

    get: async (realm, depotId) => {
      const key = idKey(realm, depotId);
      const cached = await cacheGet(redis, key);
      if (cached) {
        try {
          return JSON.parse(cached);
        } catch {
          /* fall through */
        }
      }

      const result = await db.get(realm, depotId);
      if (result) {
        cacheSet(redis, key, JSON.stringify(result), ttl).catch(() => {});
      }
      return result;
    },

    getByName: async (realm, name) => {
      const key = nameKey(realm, name);
      const cached = await cacheGet(redis, key);
      if (cached) {
        try {
          return JSON.parse(cached);
        } catch {
          /* fall through */
        }
      }

      const result = await db.getByName(realm, name);
      if (result) {
        cacheSet(redis, key, JSON.stringify(result), ttl).catch(() => {});
      }
      return result;
    },

    commit: async (realm, depotId, newRoot, expectedRoot?, diff?) => {
      const result = await db.commit(realm, depotId, newRoot, expectedRoot, diff);
      invalidate(result, realm, depotId);
      return result;
    },

    update: async (realm, depotId, options) => {
      // Pre-fetch for old name invalidation
      const old = await db.get(realm, depotId);
      const result = await db.update(realm, depotId, options);
      // Invalidate old and new names
      invalidate(old, realm, depotId);
      if (result && options.name && options.name !== old?.name) {
        cacheDel(redis, nameKey(realm, options.name)).catch(() => {});
      }
      return result;
    },

    delete: async (realm, depotId) => {
      const old = await db.get(realm, depotId);
      const result = await db.delete(realm, depotId);
      if (result) {
        invalidate(old, realm, depotId);
      }
      return result;
    },
  };
};
