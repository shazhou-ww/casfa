/**
 * Delegate Token type definitions — v3 (simplified)
 *
 * No magic, no flags, no type byte.
 * AT and RT distinguished by byte length (32 vs 24).
 */

/**
 * Hash function type for computing Token ID.
 * Should return Blake3-128 (16 bytes).
 */
export type HashFunction = (data: Uint8Array) => Uint8Array | Promise<Uint8Array>;

// ============================================================================
// Encoding Input Types
// ============================================================================

/**
 * Input for encoding an Access Token (32 bytes)
 */
export interface EncodeAccessTokenInput {
  /** Delegate UUID v7 — raw 16 bytes */
  delegateId: Uint8Array;
  /** Expiration timestamp (Unix epoch milliseconds) */
  expiresAt: number;
}

/**
 * Input for encoding a Refresh Token (24 bytes)
 */
export interface EncodeRefreshTokenInput {
  /** Delegate UUID v7 — raw 16 bytes */
  delegateId: Uint8Array;
}

// ============================================================================
// Decoded Token Types
// ============================================================================

/**
 * Decoded Access Token
 */
export interface DecodedAccessToken {
  type: "access";
  /** Delegate UUID v7 — raw 16 bytes */
  delegateId: Uint8Array;
  /** Expiration timestamp (Unix epoch milliseconds) */
  expiresAt: number;
  /** Random nonce — 8 bytes */
  nonce: Uint8Array;
}

/**
 * Decoded Refresh Token
 */
export interface DecodedRefreshToken {
  type: "refresh";
  /** Delegate UUID v7 — raw 16 bytes */
  delegateId: Uint8Array;
  /** Random nonce — 8 bytes */
  nonce: Uint8Array;
}

/**
 * Union of decoded token types.
 * Discriminated by `type` field, determined from byte length.
 */
export type DecodedToken = DecodedAccessToken | DecodedRefreshToken;

// ============================================================================
// Validation Types
// ============================================================================

/**
 * Validation error type
 */
export type ValidationError = "expired" | "invalid_size";

/**
 * Token validation result
 */
export type ValidationResult =
  | { valid: true }
  | { valid: false; error: ValidationError; message: string };
