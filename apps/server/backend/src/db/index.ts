/**
 * Database exports
 */

// Legacy exports for backwards compatibility
export { type AwpPendingDb, createAwpPendingDb } from "./awp-pending.ts";
export { type AwpPubkeysDb, createAwpPubkeysDb } from "./awp-pubkeys.ts";
export { createDocClient, createDynamoClient, resetClient } from "./client.ts";
// New client-based exports
export { type ClientPendingDb, createClientPendingDb } from "./client-pending.ts";
export { type ClientPubkeysDb, createClientPubkeysDb } from "./client-pubkeys.ts";
export {
  createDepotsDb,
  DEFAULT_MAX_HISTORY,
  type DepotsDb,
  MAIN_DEPOT_TITLE,
  SYSTEM_MAX_HISTORY,
} from "./depots.ts";
export { createOwnershipDb, type OwnershipDb } from "./ownership.ts";
export { createRefCountDb, type RefCountDb } from "./refcount.ts";
export { createTokensDb, type TokensDb } from "./tokens.ts";
export { createUsageDb, type UsageDb } from "./usage.ts";
export { createUserRolesDb, type UserRoleRecord, type UserRolesDb } from "./user-roles.ts";
