/**
 * CASFA v2 - Bootstrap Utilities
 *
 * Shared factory functions for creating application dependencies.
 * Used by both server.ts (local dev) and handler.ts (Lambda).
 */

import type { Redis } from "ioredis";
import type { AppConfig } from "./config.ts";
import { withDelegateCache } from "./db/cached-delegates.ts";
import { withDepotCache } from "./db/cached-depots.ts";
import { withOwnershipCache } from "./db/cached-ownership.ts";
import { withUsageCache } from "./db/cached-usage.ts";
import {
  type AuthCodesDb,
  createAuthCodesDb,
  createDelegatesDb,
  createDepotsDb,
  createNodeDerivedDb,
  createOAuthClientsDb,
  createOwnershipV2Db,
  createRefCountDb,
  createScopeSetNodesDb,
  createUsageDb,
  createUserRolesDb,
  type DelegatesDb,
  type DepotsDb,
  type NodeDerivedDb,
  type OAuthClientsDb,
  type OwnershipV2Db,
  type RefCountDb,
  type ScopeSetNodesDb,
  type UsageDb,
  type UserRolesDb,
} from "./db/index.ts";
import { createLocalUsersDb, type LocalUsersDb } from "./db/local-users.ts";
import { createRedisClient } from "./db/redis-client.ts";

// ============================================================================
// Types
// ============================================================================

export type DbInstances = {
  authCodesDb: AuthCodesDb;
  delegatesDb: DelegatesDb;
  oauthClientsDb: OAuthClientsDb;
  scopeSetNodesDb: ScopeSetNodesDb;
  ownershipV2Db: OwnershipV2Db;
  depotsDb: DepotsDb;
  refCountDb: RefCountDb;
  usageDb: UsageDb;
  userRolesDb: UserRolesDb;
  localUsersDb: LocalUsersDb;
  nodeDerivedDb: NodeDerivedDb;
};

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create Redis client from config. Returns null when disabled.
 */
export const createRedis = (config: AppConfig): Redis | null => {
  return createRedisClient(config.redis);
};

/**
 * Create all database instances based on configuration,
 * optionally wrapping with Redis cache layers.
 */
export const createDbInstances = (config: AppConfig, redis?: Redis | null): DbInstances => {
  const r = redis ?? null;
  const prefix = config.redis.keyPrefix;

  // Raw DB instances (direct DynamoDB access)
  const rawDelegatesDb = createDelegatesDb({ tableName: config.db.tokensTable });
  const rawOwnershipV2Db = createOwnershipV2Db({ tableName: config.db.tokensTable });
  const rawDepotsDb = createDepotsDb({ tableName: config.db.casRealmTable });
  const rawUsageDb = createUsageDb({ tableName: config.db.usageTable });

  return {
    authCodesDb: createAuthCodesDb({ tableName: config.db.tokensTable }),
    oauthClientsDb: createOAuthClientsDb({ tableName: config.db.tokensTable }),
    scopeSetNodesDb: createScopeSetNodesDb({ tableName: config.db.tokensTable }),
    refCountDb: createRefCountDb({ tableName: config.db.refCountTable }),
    userRolesDb: createUserRolesDb({ tableName: config.db.tokensTable }),
    localUsersDb: createLocalUsersDb({ tableName: config.db.tokensTable }),

    // Node derived data (extension-generated metadata)
    nodeDerivedDb: createNodeDerivedDb({ tableName: config.db.tokensTable }),

    // Cached wrappers (no-op when redis is null)
    delegatesDb: withDelegateCache(rawDelegatesDb, r, prefix),
    ownershipV2Db: withOwnershipCache(rawOwnershipV2Db, r, prefix),
    depotsDb: withDepotCache(rawDepotsDb, r, prefix),
    usageDb: withUsageCache(rawUsageDb, r, prefix),
  };
};
