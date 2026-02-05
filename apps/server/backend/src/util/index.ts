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

export { createNodeHashProvider } from "./hash-provider.ts";
export { blake3Hash, blake3s128, blake3sBase32 } from "./hashing.ts";
export { binaryResponse, corsResponse, errorResponse, jsonResponse } from "./response.ts";
export { err, flatMap, map, ok, type Result, unwrap, unwrapOr } from "./result.ts";

export {
  extractTokenId,
  generateAgentTokenId,
  generateDepotId,
  generateTicketId,
  generateTokenId,
  toTokenPk,
} from "./token-id.ts";

// New Delegate Token utilities
export {
  computeRealmHash,
  computeScopeHash,
  computeTokenId,
  computeTokenIdHash,
  computeUserIdHash,
  decodeToken,
  type DecodedDelegateToken,
  type DelegateTokenFlags,
  generateToken,
  type GenerateTokenOptions,
  isValidTokenFormat,
  isValidTokenId,
  parseTokenBase64,
  TOKEN_ID_PREFIX,
  TOKEN_MAGIC,
  TOKEN_SIZE,
} from "./token.ts";

// Scope utilities
export {
  isValidCasUri,
  parseCasUri,
  parseIndexNode,
  type ParsedIndexNode,
  resolveRelativeScope,
  type ScopeResolution,
  verifyIndexPath,
} from "./scope.ts";

// Token request utilities
export {
  decryptToken,
  encryptToken,
  generateClientSecret,
  generateDisplayCode,
  generateRequestId,
  hashClientSecret,
  isValidClientSecret,
} from "./token-request.ts";
