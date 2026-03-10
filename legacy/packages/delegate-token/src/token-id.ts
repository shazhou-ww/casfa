/**
 * Delegate Token ID computation and formatting
 *
 * Token ID = tkn_{crockford_base32(blake3_128(token_bytes))}
 */

import { decodeCrockfordBase32, encodeCrockfordBase32 } from "@casfa/protocol";
import { TOKEN_ID_PREFIX } from "./constants.ts";
import type { HashFunction } from "./types.ts";

/**
 * Expected length of Token ID hash (Blake3-128 = 16 bytes)
 */
const TOKEN_ID_HASH_LENGTH = 16;

/**
 * Expected length of Base32 encoded Token ID (26 chars for 128 bits)
 */
const TOKEN_ID_BASE32_LENGTH = 26;

/**
 * Compute Token ID from token bytes
 *
 * @param bytes - 128-byte token data
 * @param hashFn - Blake3-128 hash function
 * @returns 16-byte Token ID hash
 */
export async function computeTokenId(bytes: Uint8Array, hashFn: HashFunction): Promise<Uint8Array> {
  const result = await hashFn(bytes);
  if (result.length !== TOKEN_ID_HASH_LENGTH) {
    throw new Error(
      `Hash function must return ${TOKEN_ID_HASH_LENGTH} bytes, got ${result.length}`
    );
  }
  return result;
}

/**
 * Format Token ID hash as string
 *
 * @param id - 16-byte Token ID hash
 * @returns Formatted Token ID (e.g., "tkn_0A1B2C3D...")
 */
export function formatTokenId(id: Uint8Array): string {
  if (id.length !== TOKEN_ID_HASH_LENGTH) {
    throw new Error(
      `Invalid Token ID length: expected ${TOKEN_ID_HASH_LENGTH} bytes, got ${id.length}`
    );
  }
  return TOKEN_ID_PREFIX + encodeCrockfordBase32(id);
}

/**
 * Parse Token ID string to bytes
 *
 * @param str - Token ID string (e.g., "tkn_0A1B2C3D...")
 * @returns 16-byte Token ID hash
 * @throws Error if format is invalid
 */
export function parseTokenId(str: string): Uint8Array {
  if (!str.startsWith(TOKEN_ID_PREFIX)) {
    throw new Error(`Invalid Token ID format: must start with "${TOKEN_ID_PREFIX}"`);
  }

  const base32Part = str.slice(TOKEN_ID_PREFIX.length);
  if (base32Part.length !== TOKEN_ID_BASE32_LENGTH) {
    throw new Error(
      `Invalid Token ID length: expected ${TOKEN_ID_BASE32_LENGTH} Base32 chars, got ${base32Part.length}`
    );
  }

  const bytes = decodeCrockfordBase32(base32Part);
  if (bytes.length !== TOKEN_ID_HASH_LENGTH) {
    throw new Error(
      `Invalid Token ID decode: expected ${TOKEN_ID_HASH_LENGTH} bytes, got ${bytes.length}`
    );
  }

  return bytes;
}

/**
 * Check if a string is a valid Token ID format
 *
 * @param str - String to check
 * @returns true if valid format
 */
export function isValidTokenIdFormat(str: string): boolean {
  if (!str.startsWith(TOKEN_ID_PREFIX)) {
    return false;
  }

  const base32Part = str.slice(TOKEN_ID_PREFIX.length);
  if (base32Part.length !== TOKEN_ID_BASE32_LENGTH) {
    return false;
  }

  // Check if all characters are valid Crockford Base32
  const CROCKFORD_REGEX = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]+$/;
  return CROCKFORD_REGEX.test(base32Part);
}
