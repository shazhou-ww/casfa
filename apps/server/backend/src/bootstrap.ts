/**
 * CASFA v2 - Bootstrap Utilities
 *
 * Shared factory functions for creating application dependencies.
 * Used by both server.ts (local dev) and handler.ts (Lambda).
 */

import type { AppConfig } from "./config.ts";
import {
  createDelegatesDb,
  createDelegateTokensDb,
  createDepotsDb,
  createOwnershipDb,
  createOwnershipV2Db,
  createRefCountDb,
  createScopeSetNodesDb,
  createTicketsDb,
  createTokenAuditDb,
  createTokenRecordsDb,
  createTokenRequestsDb,
  createUsageDb,
  createUserRolesDb,
  type DelegatesDb,
  type DelegateTokensDb,
  type DepotsDb,
  type OwnershipDb,
  type OwnershipV2Db,
  type RefCountDb,
  type ScopeSetNodesDb,
  type TicketsDb,
  type TokenAuditDb,
  type TokenRecordsDb,
  type TokenRequestsDb,
  type UsageDb,
  type UserRolesDb,
} from "./db/index.ts";
import { createLocalUsersDb, type LocalUsersDb } from "./db/local-users.ts";

// ============================================================================
// Types
// ============================================================================

export type DbInstances = {
  delegateTokensDb: DelegateTokensDb;
  delegatesDb: DelegatesDb;
  tokenRecordsDb: TokenRecordsDb;
  ticketsDb: TicketsDb;
  scopeSetNodesDb: ScopeSetNodesDb;
  tokenRequestsDb: TokenRequestsDb;
  tokenAuditDb: TokenAuditDb;
  ownershipDb: OwnershipDb;
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
  delegateTokensDb: createDelegateTokensDb({ tableName: config.db.tokensTable }),
  delegatesDb: createDelegatesDb({ tableName: config.db.casRealmTable }),
  tokenRecordsDb: createTokenRecordsDb({ tableName: config.db.tokensTable }),
  ticketsDb: createTicketsDb({ tableName: config.db.casRealmTable }),
  scopeSetNodesDb: createScopeSetNodesDb({ tableName: config.db.tokensTable }),
  tokenRequestsDb: createTokenRequestsDb({ tableName: config.db.tokensTable }),
  tokenAuditDb: createTokenAuditDb({ tableName: config.db.tokensTable }),
  ownershipDb: createOwnershipDb({ tableName: config.db.casRealmTable }),
  ownershipV2Db: createOwnershipV2Db({ tableName: config.db.tokensTable }),
  depotsDb: createDepotsDb({ tableName: config.db.casRealmTable }),
  refCountDb: createRefCountDb({ tableName: config.db.refCountTable }),
  usageDb: createUsageDb({ tableName: config.db.usageTable }),
  userRolesDb: createUserRolesDb({ tableName: config.db.tokensTable }),
  localUsersDb: createLocalUsersDb({ tableName: config.db.tokensTable }),
});
