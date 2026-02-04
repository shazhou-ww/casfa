/**
 * Hashing utilities
 *
 * Common hash functions used across the application.
 */

import { blake3 } from "@noble/hashes/blake3";
import { toCrockfordBase32 } from "./encoding.ts";

/**
 * Compute Blake3s-128 hash and encode to Crockford Base32
 *
 * Blake3s-128 = first 128 bits of Blake3 hash (16 bytes)
 * Output: 26-character Crockford Base32 string
 *
 * @param data - Input string to hash
 * @returns 26-character Crockford Base32 encoded hash
 */
export const blake3sBase32 = (data: string): string => {
  const hash = blake3(data, { dkLen: 16 }); // 128 bits = 16 bytes
  return toCrockfordBase32(hash);
};

/**
 * Compute Blake3s-128 hash (raw bytes)
 *
 * @param data - Input bytes or string
 * @returns 16-byte hash
 */
export const blake3s128 = (data: Uint8Array | string): Uint8Array => {
  return blake3(data, { dkLen: 16 });
};

/**
 * Compute full Blake3 hash (256 bits)
 *
 * @param data - Input bytes or string
 * @returns 32-byte hash
 */
export const blake3Hash = (data: Uint8Array | string): Uint8Array => {
  return blake3(data);
};
