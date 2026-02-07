/**
 * @casfa/delegate-token
 *
 * Delegate Token encoding/decoding for CASFA authorization system.
 * Implements 128-byte binary format for Delegate Tokens.
 *
 * @packageDocumentation
 */

// ============================================================================
// Constants
// ============================================================================

export {
  DELEGATE_TOKEN_SIZE,
  FLAGS,
  MAGIC_NUMBER,
  MAX_DEPTH,
  TOKEN_ID_PREFIX,
} from "./constants.ts";

// ============================================================================
// Types
// ============================================================================

export type {
  DelegateToken,
  DelegateTokenFlags,
  DelegateTokenInput,
  HashFunction,
  ValidationError,
  ValidationResult,
} from "./types.ts";

// ============================================================================
// Encoding/Decoding
// ============================================================================

export { decodeDelegateToken } from "./decode.ts";
export { encodeDelegateToken } from "./encode.ts";

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
