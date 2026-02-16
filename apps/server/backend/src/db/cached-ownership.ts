/**
 * Cached Ownership wrapper — wraps OwnershipV2Db with Redis caching.
 *
 * Cached methods:
 *   hasOwnership(nodeHash, delegateId)  → `own:{hash}:{dlgId}` — immutable, no TTL
 *   hasAnyOwnership(nodeHash)           → `own:any:{hash}`     — immutable, no TTL
 *   addOwnership(...)                   → pre-warms both keys
 *
 * Only positive (true) results are cached — negative results are never cached
 * because ownership can be created at any time.
 */

import type Redis from "ioredis";
import { cacheGet, cacheMGet, cacheSet } from "./cache.ts";
import type { OwnershipV2Db } from "./ownership-v2.ts";

// ============================================================================
// Factory
// ============================================================================

export const withOwnershipCache = (
  db: OwnershipV2Db,
  redis: Redis | null,
  prefix: string
): OwnershipV2Db => {
  if (!redis) return db; // no-op when Redis is disabled

  return {
    ...db,

    hasOwnership: async (nodeHash: string, delegateId: string): Promise<boolean> => {
      const key = `${prefix}own:${nodeHash}:${delegateId}`;
      const cached = await cacheGet(redis, key);
      if (cached === "1") return true;

      const result = await db.hasOwnership(nodeHash, delegateId);
      if (result) {
        cacheSet(redis, key, "1").catch(() => {});
      }
      return result;
    },

    hasAnyOwnership: async (nodeHash: string): Promise<boolean> => {
      const key = `${prefix}own:any:${nodeHash}`;
      const cached = await cacheGet(redis, key);
      if (cached === "1") return true;

      const result = await db.hasAnyOwnership(nodeHash);
      if (result) {
        cacheSet(redis, key, "1").catch(() => {});
      }
      return result;
    },

    addOwnership: async (
      nodeHash: string,
      chain: string[],
      uploadedBy: string,
      contentType: string,
      size: number,
      kind?: string
    ): Promise<void> => {
      await db.addOwnership(nodeHash, chain, uploadedBy, contentType, size, kind);

      // Pre-warm cache for all chain members
      for (const delegateId of chain) {
        cacheSet(redis, `${prefix}own:${nodeHash}:${delegateId}`, "1").catch(() => {});
      }
      cacheSet(redis, `${prefix}own:any:${nodeHash}`, "1").catch(() => {});
    },
  };
};

// ============================================================================
// Batch helper — MGET for chain lookups
// ============================================================================

/**
 * Batch ownership check across a delegate chain using MGET.
 * Returns the first delegateId that owns the node, or null if none.
 * Falls through to DynamoDB one-by-one for cache misses.
 */
export const hasOwnershipBatch = async (
  db: OwnershipV2Db,
  redis: Redis | null,
  prefix: string,
  nodeHash: string,
  delegateIds: string[]
): Promise<string | null> => {
  if (delegateIds.length === 0) return null;

  // Try batch Redis lookup first
  if (redis) {
    const keys = delegateIds.map((id) => `${prefix}own:${nodeHash}:${id}`);
    const results = await cacheMGet(redis, keys);
    for (let i = 0; i < results.length; i++) {
      if (results[i] === "1") return delegateIds[i]!;
    }
  }

  // Fall through to DynamoDB one-by-one (with cache-aside fill)
  for (const id of delegateIds) {
    if (await db.hasOwnership(nodeHash, id)) return id;
  }
  return null;
};
