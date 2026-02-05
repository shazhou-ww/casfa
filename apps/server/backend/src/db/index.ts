/**
 * Database exports
 *
 * Updated for DelegateToken refactor:
 * - Added new modules: delegate-tokens, tickets, scope-set-nodes, token-requests, token-audit
 * - Legacy modules (awp-*, client-*, tokens) are deprecated but still exported for compatibility
 */

// ============================================================================
// Core exports (always available)
// ============================================================================

export { createDocClient, createDynamoClient, resetClient } from "./client.ts";
export { createOwnershipDb, type OwnershipDb } from "./ownership.ts";
export { createRefCountDb, type RefCountDb } from "./refcount.ts";
export { createUserRolesDb, type UserRoleRecord, type UserRolesDb } from "./user-roles.ts";

// ============================================================================
// New DelegateToken modules
// ============================================================================

// DelegateToken operations
export {
  createDelegateTokensDb,
  type DelegateTokensDb,
  type TokenValidationResult,
  type TokenInvalidReason,
} from "./delegate-tokens.ts";

// Ticket operations (independent from tokens)
export { createTicketsDb, type TicketsDb } from "./tickets.ts";

// ScopeSetNode operations
export {
  createScopeSetNodesDb,
  type ScopeSetNodesDb,
  EMPTY_SET_NODE_ID,
} from "./scope-set-nodes.ts";

// TokenRequest operations (replaces client-pending)
export { createTokenRequestsDb, type TokenRequestsDb } from "./token-requests.ts";

// TokenAudit operations
export { createTokenAuditDb, type TokenAuditDb } from "./token-audit.ts";

// ============================================================================
// Updated modules (extended with new features)
// ============================================================================

// Depots (extended with creator tracking and access control)
export {
  createDepotsDb,
  DEFAULT_MAX_HISTORY,
  type DepotsDb,
  type CreateDepotOptions,
  type UpdateDepotOptions,
  type ExtendedDepot,
  MAIN_DEPOT_NAME,
  MAIN_DEPOT_TITLE, // Deprecated, use MAIN_DEPOT_NAME
  SYSTEM_MAX_HISTORY,
} from "./depots.ts";

// Usage (extended with UserQuota support)
export { createUsageDb, type UsageDb, type ResourceType } from "./usage.ts";

// ============================================================================
// Legacy exports (deprecated, for backward compatibility)
// Files moved to ./deprecated/ folder
// ============================================================================

/**
 * @deprecated Use createDelegateTokensDb instead
 */
export { createTokensDb, type TokensDb } from "./deprecated/tokens.ts";

/**
 * @deprecated AWP authentication is being replaced by TokenRequest
 */
export { type AwpPendingDb, createAwpPendingDb } from "./deprecated/awp-pending.ts";

/**
 * @deprecated AWP authentication is being replaced by TokenRequest
 */
export { type AwpPubkeysDb, createAwpPubkeysDb } from "./deprecated/awp-pubkeys.ts";

/**
 * @deprecated Use createTokenRequestsDb instead
 */
export { type ClientPendingDb, createClientPendingDb } from "./deprecated/client-pending.ts";

/**
 * @deprecated Client pubkeys are being replaced by DelegateToken
 */
export { type ClientPubkeysDb, createClientPubkeysDb } from "./deprecated/client-pubkeys.ts";
