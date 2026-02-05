/**
 * Token utilities
 *
 * Functions for generating, decoding, and computing IDs for Delegate Tokens.
 * Based on docs/delegate-token-refactor/01-delegate-token.md
 */

import { randomBytes } from "node:crypto";
import { blake3 } from "@noble/hashes/blake3";
import { toCrockfordBase32 } from "./encoding.ts";

// ============================================================================
// Constants
// ============================================================================

/**
 * Token magic number: "DLT\x01" (Delegate Token v1)
 */
export const TOKEN_MAGIC = 0x01544c44;

/**
 * Token size in bytes
 */
export const TOKEN_SIZE = 128;

/**
 * Token ID prefix
 */
export const TOKEN_ID_PREFIX = "dlt1_";

// ============================================================================
// Types
// ============================================================================

/**
 * Token flags
 */
export type DelegateTokenFlags = {
  /** Is this a Delegate Token (can re-delegate) */
  isDelegate: boolean;
  /** Was this issued by a user (vs by another token) */
  isUserIssued: boolean;
  /** Can upload nodes */
  canUpload: boolean;
  /** Can manage depots */
  canManageDepot: boolean;
  /** Token depth (0-15) */
  depth: number;
};

/**
 * Decoded delegate token structure
 */
export type DecodedDelegateToken = {
  flags: DelegateTokenFlags;
  /** TTL in milliseconds */
  ttl: number;
  /** Quota (reserved) */
  quota: number;
  /** Random salt (8 bytes) */
  salt: Uint8Array;
  /** Issuer hash (32 bytes) */
  issuer: Uint8Array;
  /** Realm hash (32 bytes) */
  realm: Uint8Array;
  /** Scope hash (32 bytes) */
  scope: Uint8Array;
};

/**
 * Options for generating a new token
 */
export type GenerateTokenOptions = {
  type: "delegate" | "access";
  isUserIssued: boolean;
  canUpload: boolean;
  canManageDepot: boolean;
  depth: number;
  expiresAt: number;
  quota?: number;
  /** 32-byte issuer hash */
  issuerHash: Uint8Array;
  /** 32-byte realm hash */
  realmHash: Uint8Array;
  /** 32-byte scope hash */
  scopeHash: Uint8Array;
};

// ============================================================================
// Token ID Functions
// ============================================================================

/**
 * Compute Token ID from token bytes
 *
 * Token ID = "dlt1_" + Crockford Base32(Blake3-128(tokenBytes))
 *
 * @param tokenBytes - 128-byte token
 * @returns Token ID string (e.g., "dlt1_XXXX...")
 */
export const computeTokenId = (tokenBytes: Uint8Array): string => {
  if (tokenBytes.length !== TOKEN_SIZE) {
    throw new Error(`Token must be ${TOKEN_SIZE} bytes, got ${tokenBytes.length}`);
  }
  const hash = blake3(tokenBytes, { dkLen: 16 }); // 128 bits
  return `${TOKEN_ID_PREFIX}${toCrockfordBase32(hash)}`;
};

/**
 * Check if a string is a valid token ID format
 */
export const isValidTokenId = (id: string): boolean => {
  if (!id.startsWith(TOKEN_ID_PREFIX)) return false;
  const base32Part = id.slice(TOKEN_ID_PREFIX.length);
  // 128 bits / 5 bits per char = 26 chars (with padding consideration)
  if (base32Part.length !== 26) return false;
  return /^[0-9A-HJ-KM-NP-TV-Z]+$/i.test(base32Part);
};

// ============================================================================
// Token Generation
// ============================================================================

/**
 * Generate a new delegate token
 *
 * @param options - Token generation options
 * @returns 128-byte token
 */
export const generateToken = (options: GenerateTokenOptions): Uint8Array => {
  const tokenBytes = new Uint8Array(TOKEN_SIZE);
  const view = new DataView(tokenBytes.buffer);

  // Magic number (bytes 0-3, big-endian)
  view.setUint32(0, TOKEN_MAGIC, false);

  // Flags (byte 4)
  let flagsByte = 0;
  if (options.type === "delegate") flagsByte |= 0x01;
  if (options.isUserIssued) flagsByte |= 0x02;
  if (options.canUpload) flagsByte |= 0x04;
  if (options.canManageDepot) flagsByte |= 0x08;
  flagsByte |= (options.depth & 0x0f) << 4;
  tokenBytes[4] = flagsByte;

  // Reserved (bytes 5-7)
  tokenBytes[5] = 0;
  tokenBytes[6] = 0;
  tokenBytes[7] = 0;

  // TTL (bytes 8-15, big-endian uint64) - milliseconds
  const ttl = BigInt(options.expiresAt);
  view.setBigUint64(8, ttl, false);

  // Quota (bytes 16-23, big-endian uint64)
  const quota = BigInt(options.quota ?? 0);
  view.setBigUint64(16, quota, false);

  // Salt (bytes 24-31, random)
  const salt = randomBytes(8);
  tokenBytes.set(salt, 24);

  // Issuer hash (bytes 32-63, 32 bytes)
  if (options.issuerHash.length !== 32) {
    throw new Error(`Issuer hash must be 32 bytes, got ${options.issuerHash.length}`);
  }
  tokenBytes.set(options.issuerHash, 32);

  // Realm hash (bytes 64-95, 32 bytes)
  if (options.realmHash.length !== 32) {
    throw new Error(`Realm hash must be 32 bytes, got ${options.realmHash.length}`);
  }
  tokenBytes.set(options.realmHash, 64);

  // Scope hash (bytes 96-127, 32 bytes)
  if (options.scopeHash.length !== 32) {
    throw new Error(`Scope hash must be 32 bytes, got ${options.scopeHash.length}`);
  }
  tokenBytes.set(options.scopeHash, 96);

  return tokenBytes;
};

// ============================================================================
// Token Decoding
// ============================================================================

/**
 * Decode a token from its binary format
 *
 * @param tokenBytes - 128-byte token
 * @returns Decoded token structure
 * @throws Error if token format is invalid
 */
export const decodeToken = (tokenBytes: Uint8Array): DecodedDelegateToken => {
  if (tokenBytes.length !== TOKEN_SIZE) {
    throw new Error(`Token must be ${TOKEN_SIZE} bytes, got ${tokenBytes.length}`);
  }

  const view = new DataView(tokenBytes.buffer, tokenBytes.byteOffset, tokenBytes.length);

  // Magic number check
  const magic = view.getUint32(0, false);
  if (magic !== TOKEN_MAGIC) {
    throw new Error(`Invalid token magic: expected 0x${TOKEN_MAGIC.toString(16)}, got 0x${magic.toString(16)}`);
  }

  // Parse flags (byte 4)
  const flagsByte = tokenBytes[4]!;
  const flags: DelegateTokenFlags = {
    isDelegate: (flagsByte & 0x01) !== 0,
    isUserIssued: (flagsByte & 0x02) !== 0,
    canUpload: (flagsByte & 0x04) !== 0,
    canManageDepot: (flagsByte & 0x08) !== 0,
    depth: (flagsByte >> 4) & 0x0f,
  };

  // Parse TTL (bytes 8-15, big-endian uint64)
  const ttl = Number(view.getBigUint64(8, false));

  // Parse quota (bytes 16-23, big-endian uint64)
  const quota = Number(view.getBigUint64(16, false));

  // Extract fixed-size fields
  const salt = tokenBytes.slice(24, 32);
  const issuer = tokenBytes.slice(32, 64);
  const realm = tokenBytes.slice(64, 96);
  const scope = tokenBytes.slice(96, 128);

  return { flags, ttl, quota, salt, issuer, realm, scope };
};

// ============================================================================
// Hash Computation Functions
// ============================================================================

/**
 * Compute user ID hash (for issuer field when user-issued)
 *
 * @param userId - User ID string
 * @returns 32-byte hash
 */
export const computeUserIdHash = (userId: string): Uint8Array => {
  return blake3(`user:${userId}`);
};

/**
 * Compute token ID hash (for issuer field when token-issued)
 *
 * @param tokenId - Token ID string (dlt1_xxx format)
 * @returns 32-byte hash
 */
export const computeTokenIdHash = (tokenId: string): Uint8Array => {
  return blake3(`token:${tokenId}`);
};

/**
 * Compute realm hash
 *
 * @param realm - Realm string (e.g., "usr_xxx")
 * @returns 32-byte hash
 */
export const computeRealmHash = (realm: string): Uint8Array => {
  return blake3(`realm:${realm}`);
};

/**
 * Compute scope hash from scope root(s)
 *
 * For single scope: hash of the scope root
 * For multiple scopes: hash of sorted concatenated roots
 *
 * @param scopeRoots - Array of scope root hashes
 * @returns 32-byte hash
 */
export const computeScopeHash = (scopeRoots: string[]): Uint8Array => {
  if (scopeRoots.length === 0) {
    // Empty scope - hash of empty string
    return blake3("scope:empty");
  }

  if (scopeRoots.length === 1) {
    return blake3(`scope:${scopeRoots[0]}`);
  }

  // Sort and join for deterministic hash
  const sorted = [...scopeRoots].sort();
  return blake3(`scope:${sorted.join(",")}`);
};

/**
 * Validate token bytes format (quick check without full decode)
 *
 * @param tokenBytes - Bytes to validate
 * @returns true if valid format
 */
export const isValidTokenFormat = (tokenBytes: Uint8Array): boolean => {
  if (tokenBytes.length !== TOKEN_SIZE) return false;

  const view = new DataView(tokenBytes.buffer, tokenBytes.byteOffset, 4);
  const magic = view.getUint32(0, false);
  return magic === TOKEN_MAGIC;
};

/**
 * Parse token from base64 string
 *
 * @param base64 - Base64-encoded token
 * @returns Token bytes, or null if invalid
 */
export const parseTokenBase64 = (base64: string): Uint8Array | null => {
  try {
    const bytes = Buffer.from(base64, "base64");
    if (bytes.length !== TOKEN_SIZE) return null;
    if (!isValidTokenFormat(new Uint8Array(bytes))) return null;
    return new Uint8Array(bytes);
  } catch {
    return null;
  }
};
