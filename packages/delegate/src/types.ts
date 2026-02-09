/**
 * Delegate entity type definitions
 *
 * Delegate is a first-class business entity — NOT a token.
 * It represents an authorization node in the delegate tree,
 * with its own identity, permissions, and ownership.
 */

// ============================================================================
// Core Types
// ============================================================================

/**
 * A Delegate entity (persisted in DynamoDB).
 *
 * Immutable once created — parentId, chain, depth, permissions,
 * delegatedDepots, and scope cannot change after creation.
 * Only `isRevoked` / `revokedAt` / `revokedBy` can be set (once).
 */
export interface Delegate {
  /** Unique delegate ID (UUID v7 format) */
  delegateId: string;
  /** Optional display name (e.g., "Agent-A", "code-review-tool") */
  name?: string;
  /** Data isolation domain (currently = User ID) */
  realm: string;
  /** Parent delegate ID. `null` for root delegate only. */
  parentId: string | null;
  /** Complete delegate chain from root to self, inclusive: [root, ..., self] */
  chain: string[];
  /** Depth in the delegate tree (0 = root, 1-15 = child levels) */
  depth: number;
  /** Can upload new CAS nodes */
  canUpload: boolean;
  /** Can manage depots (create, delete, commit) */
  canManageDepot: boolean;
  /**
   * Parent-assigned immutable list of Depot IDs this delegate can manage.
   * In addition to self-created and descendant-created depots.
   * `undefined` means no explicitly delegated depots (only implicit ones).
   */
  delegatedDepots?: string[];
  /** Single-scope: CAS node hash of scope root */
  scopeNodeHash?: string;
  /** Multi-scope: ID of the ScopeSetNode record */
  scopeSetNodeId?: string;
  /** Optional expiration (epoch ms). Expired = auto-revoke. */
  expiresAt?: number;
  /** Whether this delegate has been revoked */
  isRevoked: boolean;
  /** When the delegate was revoked (epoch ms) */
  revokedAt?: number;
  /** Which ancestor delegate performed the revoke */
  revokedBy?: string;
  /** When the delegate was created (epoch ms) */
  createdAt: number;
}

// ============================================================================
// Input Types
// ============================================================================

/**
 * Input for creating a new child delegate.
 * The caller (parent delegate) provides these fields.
 */
export interface CreateDelegateInput {
  /** Optional display name */
  name?: string;
  /** Can upload new CAS nodes (must be ≤ parent) */
  canUpload: boolean;
  /** Can manage depots (must be ≤ parent) */
  canManageDepot: boolean;
  /**
   * Depot IDs the parent explicitly delegates to this child.
   * Each must be within the parent's manageable range.
   */
  delegatedDepots?: string[];
  /** Single-scope: CAS node hash */
  scopeNodeHash?: string;
  /** Multi-scope: ScopeSetNode ID */
  scopeSetNodeId?: string;
  /** Optional expiration (epoch ms). Must be ≤ parent's remaining lifetime. */
  expiresAt?: number;
}

/**
 * Extracted permission fields for validation comparisons.
 */
export interface DelegatePermissions {
  canUpload: boolean;
  canManageDepot: boolean;
  depth: number;
  expiresAt?: number;
}

// ============================================================================
// Validation Result
// ============================================================================

/**
 * Validation error codes for delegate creation.
 */
export type DelegateValidationError =
  | "DEPTH_EXCEEDED"
  | "PERMISSION_ESCALATION"
  | "EXPIRES_AFTER_PARENT"
  | "DELEGATED_DEPOTS_ESCALATION"
  | "INVALID_SCOPE";

/**
 * Validation result — either success or an error with details.
 */
export type DelegateValidationResult =
  | { valid: true }
  | { valid: false; error: DelegateValidationError; message: string };
