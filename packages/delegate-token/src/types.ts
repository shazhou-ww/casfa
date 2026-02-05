/**
 * Delegate Token type definitions
 */

/**
 * Hash function type for computing Token ID
 * Should return Blake3-128 (16 bytes)
 */
export type HashFunction = (data: Uint8Array) => Uint8Array | Promise<Uint8Array>;

/**
 * Delegate Token flags
 */
export type DelegateTokenFlags = {
  /** Is this a delegation token (can delegate) or access token (can access data) */
  isDelegate: boolean;
  /** Was this token issued directly by user (true) or delegated from another token (false) */
  isUserIssued: boolean;
  /** Can upload new nodes */
  canUpload: boolean;
  /** Can manage depots (create, delete, commit) */
  canManageDepot: boolean;
  /** Delegation depth (0 = user issued, 1-15 = delegation level) */
  depth: number;
};

/**
 * Decoded Delegate Token
 */
export type DelegateToken = {
  /** Token flags */
  flags: DelegateTokenFlags;
  /** Expiration timestamp (Unix epoch milliseconds) */
  ttl: number;
  /** Write quota in bytes (0 = unlimited, reserved for future use) */
  quota: number;
  /** Random salt (8 bytes) */
  salt: Uint8Array;
  /** Issuer ID - user hash (32 bytes) or parent token ID (16 bytes, left-padded to 32) */
  issuer: Uint8Array;
  /** Realm ID hash (32 bytes) */
  realm: Uint8Array;
  /** Scope hash - set-node hash (16 bytes, left-padded to 32) */
  scope: Uint8Array;
};

/**
 * Input for encoding a new Delegate Token
 */
export type DelegateTokenInput = {
  /** Token type */
  type: "delegate" | "access";
  /** Expiration timestamp (Unix epoch milliseconds) */
  ttl: number;
  /** Can upload new nodes (default: false) */
  canUpload?: boolean;
  /** Can manage depots (default: false) */
  canManageDepot?: boolean;
  /** Write quota in bytes (default: 0 = unlimited, reserved) */
  quota?: number;
  /** Issuer ID (32 bytes) - user hash or parent token ID (left-padded) */
  issuer: Uint8Array;
  /** Realm ID hash (32 bytes) */
  realm: Uint8Array;
  /** Scope hash (32 bytes) - set-node hash (left-padded) */
  scope: Uint8Array;
  /** Was this token issued by user directly */
  isUserIssued: boolean;
  /** Parent token depth (for delegation, used to calculate new depth) */
  parentDepth?: number;
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
