/**
 * Delegate Token type definitions
 *
 * v2: Delegate-as-entity model
 * - isDelegate/isUserIssued → isRefresh (bit 0)
 * - Issuer = Delegate UUID (16B left-padded to 32B)
 * - depth in high nibble (bits 4-7)
 */

/**
 * Hash function type for computing Token ID
 * Should return Blake3-128 (16 bytes)
 */
export type HashFunction = (data: Uint8Array) => Uint8Array | Promise<Uint8Array>;

/**
 * Delegate Token flags
 *
 * Low nibble (bits 0-3): type + permissions
 *   bit 0: isRefresh
 *   bit 1: canUpload
 *   bit 2: canManageDepot
 *   bit 3: reserved
 * High nibble (bits 4-7): depth (0-15)
 */
export type DelegateTokenFlags = {
  /** Is this a Refresh Token (true) or Access Token (false) */
  isRefresh: boolean;
  /** Can upload new nodes */
  canUpload: boolean;
  /** Can manage depots (create, delete, commit) */
  canManageDepot: boolean;
  /** Delegation depth (0 = root delegate, 1-15 = child delegate level) */
  depth: number;
};

/**
 * Decoded Delegate Token
 */
export type DelegateToken = {
  /** Token flags */
  flags: DelegateTokenFlags;
  /** Expiration timestamp (Unix epoch milliseconds). 0 for Refresh Token (never expires) */
  ttl: number;
  /** Write quota in bytes (0 = unlimited, reserved for future use) */
  quota: number;
  /** Random salt (8 bytes) */
  salt: Uint8Array;
  /** Delegate ID — UUID v7 (16 bytes) left-padded to 32 bytes */
  issuer: Uint8Array;
  /** Realm ID hash (32 bytes) */
  realm: Uint8Array;
  /** Scope hash — left-padded to 32 bytes (all zeros for root, 16B CAS key for single/set-node) */
  scope: Uint8Array;
};

/**
 * Input for encoding a new Delegate Token
 */
export type DelegateTokenInput = {
  /** Token type: "refresh" or "access" */
  type: "refresh" | "access";
  /** Expiration timestamp (Unix epoch milliseconds). Use 0 for Refresh Tokens */
  ttl: number;
  /** Can upload new nodes (default: false) */
  canUpload?: boolean;
  /** Can manage depots (default: false) */
  canManageDepot?: boolean;
  /** Write quota in bytes (default: 0 = unlimited, reserved) */
  quota?: number;
  /** Delegate ID — UUID v7 (16 bytes) left-padded to 32 bytes */
  issuer: Uint8Array;
  /** Realm ID hash (32 bytes) */
  realm: Uint8Array;
  /** Scope hash (32 bytes) — left-padded (all zeros for root) */
  scope: Uint8Array;
  /** Delegation depth (0 = root delegate, 1-15 = child delegate level) */
  depth: number;
};

/**
 * Validation error type
 */
export type ValidationError =
  | "expired"
  | "invalid_magic"
  | "invalid_size"
  | "depth_exceeded"
  | "invalid_flags";

/**
 * Token validation result
 */
export type ValidationResult =
  | { valid: true }
  | { valid: false; error: ValidationError; message: string };
