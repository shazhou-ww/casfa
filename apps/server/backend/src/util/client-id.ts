/**
 * Client ID utilities
 *
 * Computes client ID from public key using Blake3s-128 hash
 * with Crockford Base32 encoding.
 *
 * Format: client:{26 characters Crockford Base32}
 */

import { blake3sBase32 } from "./hashing.ts";

/**
 * Compute client ID from public key
 *
 * @param pubkey - Public key string (hex or base64 encoded)
 * @returns Client ID in format "client:{26 char Base32}"
 */
export const computeClientId = (pubkey: string): string => {
  return `client:${blake3sBase32(pubkey)}`;
};

/**
 * Compute token ID from token value
 *
 * @param tokenValue - Token value (casfa_xxx format)
 * @returns Token ID in format "token:{26 char Base32}"
 */
export const computeTokenId = (tokenValue: string): string => {
  return `token:${blake3sBase32(tokenValue)}`;
};

/**
 * Extract the hash part from a prefixed ID
 *
 * @param id - ID in format "{prefix}:{hash}"
 * @returns The hash part without prefix
 */
export const extractIdHash = (id: string): string => {
  const colonIndex = id.indexOf(":");
  if (colonIndex === -1) {
    throw new Error(`Invalid ID format: ${id}`);
  }
  return id.slice(colonIndex + 1);
};

/**
 * Validate client ID format
 *
 * @param clientId - Client ID to validate
 * @returns true if valid format
 */
export const isValidClientId = (clientId: string): boolean => {
  return /^client:[A-Z0-9]{26}$/.test(clientId);
};

/**
 * Validate token ID format
 *
 * @param tokenId - Token ID to validate
 * @returns true if valid format
 */
export const isValidTokenId = (tokenId: string): boolean => {
  return /^token:[A-Z0-9]{26}$/.test(tokenId);
};
