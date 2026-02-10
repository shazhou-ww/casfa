/**
 * ID generation utilities
 *
 * All IDs follow the unified format: prefix_[CrockfordBase32]{26} (128-bit)
 */

import { randomBytes } from "node:crypto";
import { toCrockfordBase32 } from "./encoding.ts";

/**
 * Generate a random 128-bit ID with the given prefix
 * Format: prefix_[CB32]{26}
 */
const generateCb32Id = (prefix: string): string => {
  const bytes = randomBytes(16);
  return `${prefix}_${toCrockfordBase32(bytes)}`;
};

/**
 * Generate a ULID-based delegate ID
 * Format: dlt_[CB32]{26}
 * ULID = 48-bit timestamp (ms) + 80-bit random = 128 bits
 */
export const generateDelegateId = (): string => {
  const now = Date.now();
  const bytes = new Uint8Array(16);
  // First 6 bytes = timestamp (big-endian)
  bytes[0] = (now / 2 ** 40) & 0xff;
  bytes[1] = (now / 2 ** 32) & 0xff;
  bytes[2] = (now / 2 ** 24) & 0xff;
  bytes[3] = (now / 2 ** 16) & 0xff;
  bytes[4] = (now / 2 ** 8) & 0xff;
  bytes[5] = now & 0xff;
  // Last 10 bytes = random
  const random = randomBytes(10);
  bytes.set(random, 6);
  return `dlt_${toCrockfordBase32(bytes)}`;
};

/**
 * Generate a depot ID
 * Format: dpt_[CB32]{26}
 */
export const generateDepotId = (): string => generateCb32Id("dpt");

/**
 * Generate a request ID
 * Format: req_[CB32]{26}
 */
export const generateRequestId = (): string => generateCb32Id("req");

/**
 * Extract token ID from primary key
 * pk format: "token#{id}" -> returns "{id}"
 */
export const extractTokenId = (pk: string): string => {
  if (pk.startsWith("token#")) {
    return pk.slice(6);
  }
  return pk;
};

/**
 * Create primary key from token ID
 */
export const toTokenPk = (tokenId: string): string => {
  return `token#${tokenId}`;
};
