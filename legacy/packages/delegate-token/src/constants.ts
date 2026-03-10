/**
 * Delegate Token constants — v3 (simplified)
 *
 * Token format: no magic, no type byte.
 * AT and RT distinguished by byte length alone.
 *
 * AT (32 bytes): [delegateId 16B] [expiresAt 8B] [nonce 8B]
 * RT (24 bytes): [delegateId 16B] [nonce 8B]
 */

// ============================================================================
// Sizes
// ============================================================================

/** Access Token total size in bytes */
export const AT_SIZE = 32;

/** Refresh Token total size in bytes */
export const RT_SIZE = 24;

/** Delegate ID size in bytes (UUID v7 raw binary) */
export const DELEGATE_ID_SIZE = 16;

/** Nonce size in bytes */
export const NONCE_SIZE = 8;

/** ExpiresAt field size in bytes (u64 LE, epoch ms) */
export const EXPIRES_AT_SIZE = 8;

/** Prefix for Token ID string format */
export const TOKEN_ID_PREFIX = "tkn_";

// ============================================================================
// Offsets
// ============================================================================

/**
 * Field offsets for Access Token (32 bytes)
 *
 * Layout: [delegateId 16B] [expiresAt 8B] [nonce 8B]
 */
export const AT_OFFSETS = {
  DELEGATE_ID: 0,
  EXPIRES_AT: 16,
  NONCE: 24,
} as const;

/**
 * Field offsets for Refresh Token (24 bytes)
 *
 * Layout: [delegateId 16B] [nonce 8B]
 */
export const RT_OFFSETS = {
  DELEGATE_ID: 0,
  NONCE: 16,
} as const;
