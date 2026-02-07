/**
 * CASFA v2 - Bootstrap Utilities
 *
 * Shared factory functions for creating application dependencies.
 * Used by both server.ts (local dev) and handler.ts (Lambda).
 */

import type { AppConfig } from "./config.ts";
import {
  createDelegateTokensDb,
  createDepotsDb,
  createOwnershipDb,
  createRefCountDb,
  createScopeSetNodesDb,
  createTicketsDb,
  createTokenAuditDb,
  createTokenRequestsDb,
  createUsageDb,
  createUserRolesDb,
  type DelegateTokensDb,
  type DepotsDb,
  type OwnershipDb,
  type RefCountDb,
  type ScopeSetNodesDb,
  type TicketsDb,
  type TokenAuditDb,
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
  ticketsDb: TicketsDb;
  scopeSetNodesDb: ScopeSetNodesDb;
  tokenRequestsDb: TokenRequestsDb;
  tokenAuditDb: TokenAuditDb;
  ownershipDb: OwnershipDb;
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
  ticketsDb: createTicketsDb({ tableName: config.db.casRealmTable }),
  scopeSetNodesDb: createScopeSetNodesDb({ tableName: config.db.tokensTable }),
  tokenRequestsDb: createTokenRequestsDb({ tableName: config.db.tokensTable }),
  tokenAuditDb: createTokenAuditDb({ tableName: config.db.tokensTable }),
  ownershipDb: createOwnershipDb({ tableName: config.db.casRealmTable }),
  depotsDb: createDepotsDb({ tableName: config.db.casRealmTable }),
  refCountDb: createRefCountDb({ tableName: config.db.refCountTable }),
  usageDb: createUsageDb({ tableName: config.db.usageTable }),
  userRolesDb: createUserRolesDb({ tableName: config.db.tokensTable }),
  localUsersDb: createLocalUsersDb({ tableName: config.db.tokensTable }),
});
