/**
 * Proof-of-Possession (PoP) computation and verification.
 *
 * PoP binds an access token to specific CAS content — a delegate must prove
 * possession of both the token bytes and the content to claim ownership.
 *
 * Algorithm (see ownership-and-permissions.md §6.4):
 *   1. popKey  = blake3_256(tokenBytes)        — derive 32-byte key from 32B token
 *   2. popHash = blake3_128(content, {key: popKey})  — keyed hash of content
 *   3. pop     = "pop:" + crockfordBase32(popHash)
 *
 * This module is pure — hash functions are injected via PopContext.
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Hash functions injected by the caller (server or client).
 * This keeps @casfa/proof dependency-free.
 */
export type PopContext = {
  /** Blake3 256-bit (32-byte output) hash */
  blake3_256: (data: Uint8Array) => Uint8Array;
  /** Blake3 128-bit (16-byte output) keyed hash */
  blake3_128_keyed: (data: Uint8Array, key: Uint8Array) => Uint8Array;
  /** Crockford Base32 encoder */
  crockfordBase32Encode: (bytes: Uint8Array) => string;
};

/** PoP string prefix */
const POP_PREFIX = "pop:";

// ============================================================================
// Public API
// ============================================================================

/**
 * Compute a Proof-of-Possession string.
 *
 * @param tokenBytes - The full 32-byte access token
 * @param content    - The CAS node content bytes
 * @param ctx        - Injected hash functions
 * @returns PoP string in format "pop:XXXXXX..."
 */
export function computePoP(tokenBytes: Uint8Array, content: Uint8Array, ctx: PopContext): string {
  const popKey = ctx.blake3_256(tokenBytes); // 32B → 32B key
  const popHash = ctx.blake3_128_keyed(content, popKey); // keyed hash → 16B
  return POP_PREFIX + ctx.crockfordBase32Encode(popHash);
}

/**
 * Verify a Proof-of-Possession string.
 *
 * @param pop        - The PoP string to verify (e.g., "pop:XXXXXX...")
 * @param tokenBytes - The full 32-byte access token
 * @param content    - The CAS node content bytes
 * @param ctx        - Injected hash functions
 * @returns true if the PoP matches
 */
export function verifyPoP(
  pop: string,
  tokenBytes: Uint8Array,
  content: Uint8Array,
  ctx: PopContext
): boolean {
  if (!pop.startsWith(POP_PREFIX)) return false;
  const expected = computePoP(tokenBytes, content, ctx);
  return constantTimeEqual(pop, expected);
}

/**
 * Check if a string looks like a valid PoP format (starts with "pop:").
 */
export function isPopString(value: string): boolean {
  return value.startsWith(POP_PREFIX) && value.length > POP_PREFIX.length;
}

// ============================================================================
// Internals
// ============================================================================

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
