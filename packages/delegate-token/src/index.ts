/**
 * @casfa/delegate-token
 *
 * Delegate Token encoding/decoding for CASFA authorization system.
 * Simplified v3 format: AT (32 bytes), RT (24 bytes).
 * No magic number, no type byte — distinguished by byte length.
 *
 * @packageDocumentation
 */

// ============================================================================
// Constants
// ============================================================================

export {
  AT_OFFSETS,
  AT_SIZE,
  DELEGATE_ID_SIZE,
  EXPIRES_AT_SIZE,
  NONCE_SIZE,
  RT_OFFSETS,
  RT_SIZE,
  TOKEN_ID_PREFIX,
} from "./constants.ts";

// ============================================================================
// Types
// ============================================================================

export type {
  DecodedAccessToken,
  DecodedRefreshToken,
  DecodedToken,
  EncodeAccessTokenInput,
  EncodeRefreshTokenInput,
  HashFunction,
  ValidationError,
  ValidationResult,
} from "./types.ts";

// ============================================================================
// Encoding
// ============================================================================

export { encodeAccessToken, encodeRefreshToken } from "./encode.ts";

// ============================================================================
// Decoding
// ============================================================================

export { decodeToken } from "./decode.ts";

// ============================================================================
// Token ID
// ============================================================================

export {
  computeTokenId,
  formatTokenId,
  isValidTokenIdFormat,
  parseTokenId,
} from "./token-id.ts";

// ============================================================================
// Validation
// ============================================================================

export { validateToken, validateTokenBytes } from "./validate.ts";
