/**
 * Database exports
 *
 * New Delegate model database modules.
 */

// ============================================================================
// Core exports
// ============================================================================

export { createDocClient, createDynamoClient, resetClient } from "./client.ts";
export {
  type AuthCodesDb,
  type AuthorizationCode,
  createAuthCodesDb,
  type GrantedPermissions,
} from "./auth-codes.ts";
export { createDelegatesDb, type DelegatesDb } from "./delegates.ts";
export {
  createOwnershipV2Db,
  type OwnershipRecord,
  type OwnershipV2Db,
} from "./ownership-v2.ts";
export { createRefCountDb, type RefCountDb } from "./refcount.ts";
export { createUserRolesDb, type UserRoleRecord, type UserRolesDb } from "./user-roles.ts";
export {
  createOAuthClientsDb,
  type OAuthClientRecord,
  type OAuthClientsDb,
} from "./oauth-clients.ts";

// ============================================================================
// Token modules
// ============================================================================

// ScopeSetNode operations
export {
  createScopeSetNodesDb,
  EMPTY_SET_NODE_ID,
  type ScopeSetNodesDb,
} from "./scope-set-nodes.ts";
// TokenRecord operations (delegate model RT/AT)
export {
  type CreateTokenRecordInput,
  createTokenRecordsDb,
  type TokenRecord,
  type TokenRecordsDb,
} from "./token-records.ts";

// ============================================================================
// Other modules
// ============================================================================

// Depots
export {
  type CreateDepotOptions,
  createDepotsDb,
  DEFAULT_MAX_HISTORY,
  type DepotsDb,
  type ExtendedDepot,
  MAIN_DEPOT_NAME,
  SYSTEM_MAX_HISTORY,
  type UpdateDepotOptions,
} from "./depots.ts";

// Usage
export { createUsageDb, type ResourceType, type UsageDb } from "./usage.ts";
