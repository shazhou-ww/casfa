/**
 * Database exports
 *
 * Delegate Token model database modules.
 */

// ============================================================================
// Core exports
// ============================================================================

export { createDocClient, createDynamoClient, resetClient } from "./client.ts";
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
  type TokenValidationResult,
  type TokenInvalidReason,
} from "./delegate-tokens.ts";

// Ticket operations
export { createTicketsDb, type TicketsDb } from "./tickets.ts";

// ScopeSetNode operations
export {
  createScopeSetNodesDb,
  type ScopeSetNodesDb,
  EMPTY_SET_NODE_ID,
} from "./scope-set-nodes.ts";

// TokenRequest operations
export {
  createTokenRequestsDb,
  type TokenRequestsDb,
  type SimpleApproveInput,
} from "./token-requests.ts";

// TokenAudit operations
export { createTokenAuditDb, type TokenAuditDb } from "./token-audit.ts";

// ============================================================================
// Other modules
// ============================================================================

// Depots
export {
  createDepotsDb,
  DEFAULT_MAX_HISTORY,
  type DepotsDb,
  type CreateDepotOptions,
  type UpdateDepotOptions,
  type ExtendedDepot,
  MAIN_DEPOT_NAME,
  MAIN_DEPOT_TITLE,
  SYSTEM_MAX_HISTORY,
} from "./depots.ts";

// Usage
export { createUsageDb, type UsageDb, type ResourceType } from "./usage.ts";
