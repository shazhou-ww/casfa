/**
 * CASFA v2 - Bootstrap Utilities
 *
 * Shared factory functions for creating application dependencies.
 * Used by both server.ts (local dev) and handler.ts (Lambda).
 */

import type { AppConfig } from "./config.ts";
import {
  type AuthCodesDb,
  createAuthCodesDb,
  createDelegatesDb,
  createDepotsDb,
  createOAuthClientsDb,
  createOwnershipV2Db,
  createRefCountDb,
  createScopeSetNodesDb,
  createUsageDb,
  createUserRolesDb,
  type DelegatesDb,
  type DepotsDb,
  type OAuthClientsDb,
  type OwnershipV2Db,
  type RefCountDb,
  type ScopeSetNodesDb,
  type UsageDb,
  type UserRolesDb,
} from "./db/index.ts";
import { createLocalUsersDb, type LocalUsersDb } from "./db/local-users.ts";

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
};

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create all database instances based on configuration
 */
export const createDbInstances = (config: AppConfig): DbInstances => ({
  authCodesDb: createAuthCodesDb({ tableName: config.db.tokensTable }),
  delegatesDb: createDelegatesDb({ tableName: config.db.tokensTable }),
  oauthClientsDb: createOAuthClientsDb({ tableName: config.db.tokensTable }),
  scopeSetNodesDb: createScopeSetNodesDb({ tableName: config.db.tokensTable }),
  ownershipV2Db: createOwnershipV2Db({ tableName: config.db.tokensTable }),
  depotsDb: createDepotsDb({ tableName: config.db.casRealmTable }),
  refCountDb: createRefCountDb({ tableName: config.db.refCountTable }),
  usageDb: createUsageDb({ tableName: config.db.usageTable }),
  userRolesDb: createUserRolesDb({ tableName: config.db.tokensTable }),
  localUsersDb: createLocalUsersDb({ tableName: config.db.tokensTable }),
});
