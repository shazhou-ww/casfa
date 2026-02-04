/**
 * CASFA v2 - Bootstrap Utilities
 *
 * Shared factory functions for creating application dependencies.
 * Used by both server.ts (local dev) and handler.ts (Lambda).
 */

import type { AppConfig } from "./config.ts";
import type { AwpPendingDb } from "./db/awp-pending.ts";
import type { AwpPubkeysDb } from "./db/awp-pubkeys.ts";
import type { ClientPendingDb } from "./db/client-pending.ts";
import type { ClientPubkeysDb } from "./db/client-pubkeys.ts";
import type { DepotsDb } from "./db/depots.ts";
import {
  createAwpPendingDb,
  createAwpPubkeysDb,
  createClientPendingDb,
  createClientPubkeysDb,
  createDepotsDb,
  createOwnershipDb,
  createRefCountDb,
  createTokensDb,
  createUsageDb,
  createUserRolesDb,
} from "./db/index.ts";
import type { OwnershipDb } from "./db/ownership.ts";
import type { RefCountDb } from "./db/refcount.ts";
import type { TokensDb } from "./db/tokens.ts";
import type { UsageDb } from "./db/usage.ts";
import type { UserRolesDb } from "./db/user-roles.ts";
import { type AuthService, createAuthService } from "./services/auth.ts";

// ============================================================================
// Types
// ============================================================================

export type DbInstances = {
  tokensDb: TokensDb;
  ownershipDb: OwnershipDb;
  depotsDb: DepotsDb;
  refCountDb: RefCountDb;
  usageDb: UsageDb;
  userRolesDb: UserRolesDb;
  // Legacy AWP naming (for backwards compatibility)
  awpPendingDb: AwpPendingDb;
  awpPubkeysDb: AwpPubkeysDb;
  // New client-based naming
  clientPendingDb: ClientPendingDb;
  clientPubkeysDb: ClientPubkeysDb;
};

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create all database instances based on configuration
 */
export const createDbInstances = (config: AppConfig): DbInstances => ({
  tokensDb: createTokensDb({ tableName: config.db.tokensTable }),
  ownershipDb: createOwnershipDb({ tableName: config.db.casRealmTable }),
  depotsDb: createDepotsDb({ tableName: config.db.casRealmTable }),
  refCountDb: createRefCountDb({ tableName: config.db.refCountTable }),
  usageDb: createUsageDb({ tableName: config.db.usageTable }),
  userRolesDb: createUserRolesDb({ tableName: config.db.tokensTable }),
  // Legacy AWP naming
  awpPendingDb: createAwpPendingDb({ tableName: config.db.tokensTable }),
  awpPubkeysDb: createAwpPubkeysDb({ tableName: config.db.tokensTable }),
  // New client-based naming
  clientPendingDb: createClientPendingDb({ tableName: config.db.tokensTable }),
  clientPubkeysDb: createClientPubkeysDb({ tableName: config.db.tokensTable }),
});

/**
 * Create auth service based on configuration
 */
export const createAuthServiceFromConfig = (db: DbInstances, config: AppConfig): AuthService => {
  return createAuthService({
    tokensDb: db.tokensDb,
    userRolesDb: db.userRolesDb,
    cognitoConfig: config.cognito,
  });
};
