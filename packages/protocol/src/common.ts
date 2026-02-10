/**
 * Common schema definitions and ID format patterns
 *
 * All 128-bit identifiers use Crockford Base32 encoding (26 characters)
 * with a 4-character prefix: prefix_[CB32]{26}
 *
 * Crockford Base32 charset: 0-9, A-H, J-K, M-N, P-T, V-Z (excludes I, L, O, U)
 */

import { z } from "zod";

// ============================================================================
// Crockford Base32 Encoding
// ============================================================================

/**
 * Crockford Base32 character class (excludes I, L, O, U)
 */
const CROCKFORD_BASE32 = "0-9A-HJKMNP-TV-Z";

/**
 * Valid trailing characters for 128-bit (16-byte) CB32-encoded IDs.
 * 26 chars × 5 bits = 130 bits; only 128 are data, so the last
 * character's low 2 bits must be zero → value ∈ {0,4,8,12,16,20,24,28}
 * which maps to characters: 0 4 8 C G M R W
 */
const CB32_TAIL_128 = "048CGMRW";

/**
 * Crockford Base32 alphabet for encoding (32 characters)
 */
const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Decode map for Crockford Base32 (handles lowercase and confusable chars)
 */
const CROCKFORD_DECODE: Record<string, number> = {};
for (let i = 0; i < CROCKFORD_ALPHABET.length; i++) {
  CROCKFORD_DECODE[CROCKFORD_ALPHABET[i]!] = i;
  CROCKFORD_DECODE[CROCKFORD_ALPHABET[i]!.toLowerCase()] = i;
}
// Handle confusable characters: I/i/L/l -> 1, O/o -> 0
CROCKFORD_DECODE.I = 1;
CROCKFORD_DECODE.i = 1;
CROCKFORD_DECODE.L = 1;
CROCKFORD_DECODE.l = 1;
CROCKFORD_DECODE.O = 0;
CROCKFORD_DECODE.o = 0;

/**
 * Encode bytes to Crockford Base32 string
 */
export function encodeCrockfordBase32(bytes: Uint8Array): string {
  let result = "";
  let buffer = 0;
  let bitsLeft = 0;

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bitsLeft += 8;

    while (bitsLeft >= 5) {
      bitsLeft -= 5;
      result += CROCKFORD_ALPHABET[(buffer >> bitsLeft) & 0x1f];
    }
  }

  // Handle remaining bits (pad with zeros)
  if (bitsLeft > 0) {
    result += CROCKFORD_ALPHABET[(buffer << (5 - bitsLeft)) & 0x1f];
  }

  return result;
}

/**
 * Decode Crockford Base32 string to bytes
 */
export function decodeCrockfordBase32(str: string): Uint8Array {
  let buffer = 0;
  let bitsLeft = 0;
  const result: number[] = [];

  for (const char of str) {
    const value = CROCKFORD_DECODE[char];
    if (value === undefined) {
      throw new Error(`Invalid Crockford Base32 character: ${char}`);
    }

    buffer = (buffer << 5) | value;
    bitsLeft += 5;

    if (bitsLeft >= 8) {
      bitsLeft -= 8;
      result.push((buffer >> bitsLeft) & 0xff);
    }
  }

  return new Uint8Array(result);
}

// ============================================================================
// Node Key Conversion (nod_ prefix)
// ============================================================================

/**
 * Node key prefix
 */
export const NODE_KEY_PREFIX = "nod_";

/**
 * Convert 128-bit hash bytes to node key string
 * Format: nod_{crockford_base32(hash)}
 */
export function hashToNodeKey(hash: Uint8Array): string {
  if (hash.length !== 16) {
    throw new Error(`Invalid hash length: expected 16 bytes, got ${hash.length}`);
  }
  return `${NODE_KEY_PREFIX}${encodeCrockfordBase32(hash)}`;
}

/**
 * Extract 128-bit hash bytes from node key string
 */
export function nodeKeyToHash(key: string): Uint8Array {
  if (!key.startsWith(NODE_KEY_PREFIX)) {
    throw new Error(`Invalid node key format: ${key}`);
  }
  const base32Part = key.slice(NODE_KEY_PREFIX.length);
  const hash = decodeCrockfordBase32(base32Part);
  if (hash.length !== 16) {
    throw new Error(`Invalid hash length after decode: expected 16 bytes, got ${hash.length}`);
  }
  return hash;
}

/**
 * Convert CB32 storage key to node key string.
 * Storage keys are already CB32, so just prepend the prefix.
 */
export function storageKeyToNodeKey(storageKey: string): string {
  return `${NODE_KEY_PREFIX}${storageKey}`;
}

/**
 * Convert node key to CB32 storage key.
 * Just strips the "nod_" prefix.
 */
export function nodeKeyToStorageKey(nodeKey: string): string {
  if (!nodeKey.startsWith(NODE_KEY_PREFIX)) {
    throw new Error(`Invalid node key format: ${nodeKey}`);
  }
  return nodeKey.slice(NODE_KEY_PREFIX.length);
}

/**
 * Well-known empty dict node key (API format)
 * Corresponds to cas-core's EMPTY_DICT_KEY (CB32 format)
 */
export const EMPTY_DICT_NODE_KEY = storageKeyToNodeKey("000B5PHBGEC2A705WTKKMVRS30");

// ============================================================================
// ID Format Patterns — unified prefix_[CB32]{26}
// ============================================================================

/**
 * User ID format: usr_{base32}
 * Also serves as realm ID.
 * Example: usr_A6JCHNMFWRT90AXMYWHJ8HKS90
 */
export const USER_ID_REGEX = new RegExp(`^usr_[${CROCKFORD_BASE32}]{25}[${CB32_TAIL_128}]$`);

/**
 * Delegate ID format: dlt_{base32} (ULID-based)
 * Example: dlt_01HQXK5V8N3Y7M2P4R6T9W0ABC
 */
export const DELEGATE_ID_REGEX = new RegExp(`^dlt_[${CROCKFORD_BASE32}]{25}[${CB32_TAIL_128}]$`);

/**
 * Token ID format: tkn_{base32}
 * blake3_128(token_bytes) encoded as CB32
 * Example: tkn_5R8F1Y3GHKM9QXW2TV4BCEJN70
 */
export const DELEGATE_TOKEN_ID_REGEX = new RegExp(
  `^tkn_[${CROCKFORD_BASE32}]{25}[${CB32_TAIL_128}]$`
);

/**
 * Depot ID format: dpt_{base32}
 * Example: dpt_7QWER2T8Y3M5K9BXFNHJC6D0PV
 */
export const DEPOT_ID_REGEX = new RegExp(`^dpt_[${CROCKFORD_BASE32}]{25}[${CB32_TAIL_128}]$`);

/**
 * Node key format: nod_{crockford_base32(blake3s(content))}
 * 26 characters (128-bit BLAKE3s hash)
 * Example: nod_A6JCHNMFWRT90AXMYWHJ8HKS90
 */
export const NODE_KEY_REGEX = new RegExp(`^nod_[${CROCKFORD_BASE32}]{25}[${CB32_TAIL_128}]$`);

/**
 * Authorization Request ID format: req_{base32}
 * Example: req_9X2M5K8BFNHJC6D0PV3QWER2T7Y
 */
export const REQUEST_ID_REGEX = new RegExp(`^req_[${CROCKFORD_BASE32}]{25}[${CB32_TAIL_128}]$`);

/**
 * Issuer ID format: can be usr_{id} or tkn_{hash}
 * - usr_{base32}: User ID (for user-issued tokens)
 * - tkn_{base32}: Token ID (for delegated tokens)
 */
export const ISSUER_ID_REGEX = new RegExp(
  `^(usr_[${CROCKFORD_BASE32}]{25}[${CB32_TAIL_128}]|tkn_[${CROCKFORD_BASE32}]{25}[${CB32_TAIL_128}])$`
);

// ============================================================================
// Zod Schemas for IDs
// ============================================================================

export const UserIdSchema = z.string().regex(USER_ID_REGEX, "Invalid user ID format");
export const DelegateIdSchema = z.string().regex(DELEGATE_ID_REGEX, "Invalid delegate ID format");
export const DelegateTokenIdSchema = z
  .string()
  .regex(DELEGATE_TOKEN_ID_REGEX, "Invalid token ID format");
export const DepotIdSchema = z.string().regex(DEPOT_ID_REGEX, "Invalid depot ID format");
export const NodeKeySchema = z.string().regex(NODE_KEY_REGEX, "Invalid node key format");
export const RequestIdSchema = z.string().regex(REQUEST_ID_REGEX, "Invalid request ID format");
export const IssuerIdSchema = z.string().regex(ISSUER_ID_REGEX, "Invalid issuer ID format");

// ============================================================================
// User Role
// ============================================================================

/**
 * User roles in the system
 * - unauthorized: Cannot access CAS resources
 * - authorized: Can access own Realm
 * - admin: Can manage all users
 */
export const UserRoleSchema = z.enum(["unauthorized", "authorized", "admin"]);
export type UserRole = z.infer<typeof UserRoleSchema>;

// ============================================================================
// Token Type
// ============================================================================

/**
 * Delegate Token types:
 * - delegate: Re-authorization token, can issue child tokens
 * - access: Access token, can read/write data but cannot issue tokens
 */
export const TokenTypeSchema = z.enum(["delegate", "access"]);
export type TokenType = z.infer<typeof TokenTypeSchema>;

// ============================================================================
// Authorization Request Status
// ============================================================================

/**
 * Client authorization request status:
 * - pending: Waiting for user approval
 * - approved: User approved, token issued
 * - rejected: User rejected the request
 * - expired: Request expired (10 min timeout)
 */
export const AuthRequestStatusSchema = z.enum(["pending", "approved", "rejected", "expired"]);
export type AuthRequestStatus = z.infer<typeof AuthRequestStatusSchema>;

// ============================================================================
// Node Kind
// ============================================================================

/**
 * Node types in CAS:
 * - set: Scope-set node (unordered set of node hashes)
 * - dict: Directory node with child mappings
 * - file: File top-level node with content-type
 * - successor: File continuation node for large files
 */
export const NodeKindSchema = z.enum(["set", "dict", "file", "successor"]);
export type NodeKind = z.infer<typeof NodeKindSchema>;

// ============================================================================
// Pagination
// ============================================================================

export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).optional().default(100),
  cursor: z.string().optional(),
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;
