/**
 * Database exports
 *
 * Delegate Token model database modules.
 */

// ============================================================================
// Core exports
// ============================================================================

export { createDocClient, createDynamoClient, resetClient } from "./client.ts";
export { createDelegatesDb, type DelegatesDb } from "./delegates.ts";
export { createOwnershipDb, type OwnershipDb } from "./ownership.ts";
export { createRefCountDb, type RefCountDb } from "./refcount.ts";
export { createUserRolesDb, type UserRoleRecord, type UserRolesDb } from "./user-roles.ts";

// ============================================================================
// DelegateToken modules
// ============================================================================

// DelegateToken operations
export {
  createDelegateTokensDb,
  type DelegateTokensDb,
  type TokenInvalidReason,
  type TokenValidationResult,
} from "./delegate-tokens.ts";
// ScopeSetNode operations
export {
  createScopeSetNodesDb,
  EMPTY_SET_NODE_ID,
  type ScopeSetNodesDb,
} from "./scope-set-nodes.ts";
// Ticket operations
export { createTicketsDb, type TicketsDb } from "./tickets.ts";
// TokenAudit operations
export { createTokenAuditDb, type TokenAuditDb } from "./token-audit.ts";
// TokenRequest operations
export {
  createTokenRequestsDb,
  type SimpleApproveInput,
  type TokenRequestsDb,
} from "./token-requests.ts";

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
