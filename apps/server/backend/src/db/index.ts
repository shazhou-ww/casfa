/**
 * Database exports
 *
 * New Delegate model database modules.
 */

// ============================================================================
// Core exports
// ============================================================================

export { createDocClient, createDynamoClient, resetClient } from "./client.ts";
export { createDelegatesDb, type DelegatesDb } from "./delegates.ts";
export {
  createOwnershipV2Db,
  type OwnershipRecord,
  type OwnershipV2Db,
} from "./ownership-v2.ts";
export { createRefCountDb, type RefCountDb } from "./refcount.ts";
export { createUserRolesDb, type UserRoleRecord, type UserRolesDb } from "./user-roles.ts";

// ============================================================================
// Token modules
// ============================================================================

// TokenRecord operations (delegate model RT/AT)
export {
  createTokenRecordsDb,
  type CreateTokenRecordInput,
  type TokenRecord,
  type TokenRecordsDb,
} from "./token-records.ts";
// ScopeSetNode operations
export {
  createScopeSetNodesDb,
  EMPTY_SET_NODE_ID,
  type ScopeSetNodesDb,
} from "./scope-set-nodes.ts";
// Ticket operations
export { createTicketsDb, type TicketsDb } from "./tickets.ts";

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
  MAIN_DEPOT_TITLE,
  SYSTEM_MAX_HISTORY,
  type UpdateDepotOptions,
} from "./depots.ts";

// Usage
export { createUsageDb, type ResourceType, type UsageDb } from "./usage.ts";
