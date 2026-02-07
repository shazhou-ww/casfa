/**
 * Common schema definitions and ID format patterns
 *
 * All 128-bit identifiers use Crockford Base32 encoding (26 characters).
 * Crockford Base32 charset: 0-9, A-H, J-K, M-N, P-T, V-Z (excludes I, L, O, U)
 */

import { z } from "zod";

// ============================================================================
// ID Format Patterns
// ============================================================================

/**
 * Crockford Base32 character class (excludes I, L, O, U)
 */
const CROCKFORD_BASE32 = "0-9A-HJKMNP-TV-Z";

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

/**
 * Convert 128-bit hash bytes to node key string
 * Format: node:{crockford_base32(hash)}
 */
export function hashToNodeKey(hash: Uint8Array): string {
  if (hash.length !== 16) {
    throw new Error(`Invalid hash length: expected 16 bytes, got ${hash.length}`);
  }
  return `node:${encodeCrockfordBase32(hash)}`;
}

/**
 * Extract 128-bit hash bytes from node key string
 */
export function nodeKeyToHash(key: string): Uint8Array {
  if (!key.startsWith("node:")) {
    throw new Error(`Invalid node key format: ${key}`);
  }
  const base32Part = key.slice(5);
  const hash = decodeCrockfordBase32(base32Part);
  if (hash.length !== 16) {
    throw new Error(`Invalid hash length after decode: expected 16 bytes, got ${hash.length}`);
  }
  return hash;
}

/**
 * Convert hex storage key to node key string
 */
export function hexToNodeKey(hexKey: string): string {
  if (hexKey.length !== 32) {
    throw new Error(`Invalid hex key length: expected 32 chars, got ${hexKey.length}`);
  }
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = Number.parseInt(hexKey.slice(i * 2, i * 2 + 2), 16);
  }
  return hashToNodeKey(bytes);
}

/**
 * Convert node key to hex storage key
 */
export function nodeKeyToHex(nodeKey: string): string {
  const hash = nodeKeyToHash(nodeKey);
  return Array.from(hash)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Well-known empty dict node key (API format)
 * Corresponds to cas-core's EMPTY_DICT_KEY (hex format)
 */
export const EMPTY_DICT_NODE_KEY = hexToNodeKey("0000b2da2b8398251c05e6a73a6f1918");

/**
 * User ID format: usr_{base32}
 * Example: usr_A6JCHNMFWRT90AXMYWHJ8HKS90
 */
export const USER_ID_REGEX = new RegExp(`^usr_[${CROCKFORD_BASE32}]{26}$`);

/**
 * Ticket ID format: ticket:{ulid}
 * Example: ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC
 */
export const TICKET_ID_REGEX = new RegExp(`^ticket:[${CROCKFORD_BASE32}]{26}$`);

/**
 * Depot ID format: depot:{name} or depot:{ulid}
 * Examples: depot:MAIN, depot:01HQXK5V8N3Y7M2P4R6T9W0ABC
 */
export const DEPOT_ID_REGEX = /^depot:[A-Za-z0-9_-]+$/;

/**
 * @deprecated Use DELEGATE_TOKEN_ID_REGEX instead
 * Old client ID format: client:{blake3s(pubkey)}
 */
export const CLIENT_ID_REGEX = new RegExp(`^client:[${CROCKFORD_BASE32}]{26}$`);

/**
 * @deprecated Use DELEGATE_TOKEN_ID_REGEX instead
 * Old token ID format: token:{blake3s(token)}
 */
export const TOKEN_ID_REGEX = new RegExp(`^token:[${CROCKFORD_BASE32}]{26}$`);

/**
 * Delegate Token ID format: dlt1_{base32}
 * Example: dlt1_4xzrt7y2m5k9bqwp3fnhjc6d
 * Note: Uses lowercase Crockford Base32 (24 characters for 120 bits)
 */
export const DELEGATE_TOKEN_ID_REGEX = /^dlt1_[0-9a-hjkmnp-tv-z]{24}$/;

/**
 * Authorization Request ID format: req_{base64url}
 * Example: req_xxxxxxxxxxxxxxxxxxxxxxxx
 */
export const REQUEST_ID_REGEX = /^req_[A-Za-z0-9_-]{22,}$/;

/**
 * Node key format: node:{crockford_base32(blake3s(content))}
 * Uses Crockford Base32, 26 characters (128-bit BLAKE3s hash)
 * Example: node:A6JCHNMFWRT90AXMYWHJ8HKS90
 */
export const NODE_KEY_REGEX = new RegExp(`^node:[${CROCKFORD_BASE32}]{26}$`);

/**
 * Issuer ID format: can be usr_{id} or dlt1_{hash}
 * - usr_{base32}: User ID (for user-issued tokens)
 * - dlt1_{base32}: Delegate Token ID (for delegated tokens)
 */
export const ISSUER_ID_REGEX = /^(usr_[0-9A-HJKMNP-TV-Z]{26}|dlt1_[0-9a-hjkmnp-tv-z]{24})$/i;

// ============================================================================
// Zod Schemas for IDs
// ============================================================================

export const UserIdSchema = z.string().regex(USER_ID_REGEX, "Invalid user ID format");
export const TicketIdSchema = z.string().regex(TICKET_ID_REGEX, "Invalid ticket ID format");
export const DepotIdSchema = z.string().regex(DEPOT_ID_REGEX, "Invalid depot ID format");
/** @deprecated Use DelegateTokenIdSchema instead */
export const ClientIdSchema = z.string().regex(CLIENT_ID_REGEX, "Invalid client ID format");
/** @deprecated Use DelegateTokenIdSchema instead */
export const TokenIdSchema = z.string().regex(TOKEN_ID_REGEX, "Invalid token ID format");
export const NodeKeySchema = z.string().regex(NODE_KEY_REGEX, "Invalid node key format");
export const IssuerIdSchema = z.string().regex(ISSUER_ID_REGEX, "Invalid issuer ID format");
export const DelegateTokenIdSchema = z
  .string()
  .regex(DELEGATE_TOKEN_ID_REGEX, "Invalid delegate token ID format");
export const RequestIdSchema = z.string().regex(REQUEST_ID_REGEX, "Invalid request ID format");

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
// Ticket Status
// ============================================================================

/**
 * Ticket status:
 * - pending: Waiting for submission, task in progress
 * - submitted: Task completed, root node set
 */
export const TicketStatusSchema = z.enum(["pending", "submitted"]);
export type TicketStatus = z.infer<typeof TicketStatusSchema>;

// ============================================================================
// Token Type
// ============================================================================

/**
 * Delegate Token types:
 * - delegate: Re-authorization token, can issue child tokens and create tickets
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
