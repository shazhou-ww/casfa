/**
 * Utility exports
 */

// Legacy client ID utilities (deprecated)
export {
  computeClientId,
  computeTokenId as computeLegacyTokenId,
  extractIdHash,
  isValidClientId,
  isValidTokenId as isValidLegacyTokenId,
} from "./client-id.ts";

// New db-keys utilities for DelegateToken schema
export * as dbKeys from "./db-keys.ts";

export {
  fromCrockfordBase32,
  isValidCrockfordBase32,
  normalizeUserId,
  toCrockfordBase32,
  userIdToUuid,
  uuidToUserId,
} from "./encoding.ts";

export { createNodeKeyProvider } from "./hash-provider.ts";
export { blake3Hash, blake3s128, blake3sBase32 } from "./hashing.ts";
export { binaryResponse, corsResponse, errorResponse, jsonResponse } from "./response.ts";
export { err, flatMap, map, ok, type Result, unwrap, unwrapOr } from "./result.ts";
// Scope utilities
export {
  isValidCasUri,
  type ParsedIndexNode,
  parseCasUri,
  parseIndexNode,
  resolveRelativeScope,
  type ScopeResolution,
  verifyIndexPath,
} from "./scope.ts";

// New Delegate Token utilities
export {
  computeRealmHash,
  computeScopeHash,
  computeTokenId,
  computeTokenIdHash,
  computeUserIdHash,
  type DecodedDelegateToken,
  type DelegateTokenFlags,
  decodeToken,
  type GenerateTokenOptions,
  generateToken,
  isValidTokenFormat,
  isValidTokenId,
  parseTokenBase64,
  TOKEN_ID_PREFIX,
  TOKEN_MAGIC,
  TOKEN_SIZE,
} from "./token.ts";
export {
  extractTokenId,
  generateDelegateId,
  generateDepotId,
  generateRequestId,
  toTokenPk,
} from "./token-id.ts";

// Token request utilities
export {
  decryptToken,
  encryptToken,
  generateClientSecret,
  generateDisplayCode,
  hashClientSecret,
  isValidClientSecret,
} from "./token-request.ts";
