/**
 * Delegate Token validation — v3 (simplified)
 *
 * Validates token bytes by length, and decoded AT by expiration.
 */

import { AT_SIZE, RT_SIZE } from "./constants.ts";
import type { DecodedToken, ValidationResult } from "./types.ts";

/**
 * Validate raw token bytes (quick size check).
 *
 * @param bytes - Raw token bytes
 * @returns Validation result
 */
export function validateTokenBytes(bytes: Uint8Array): ValidationResult {
  if (bytes.length !== AT_SIZE && bytes.length !== RT_SIZE) {
    return {
      valid: false,
      error: "invalid_size",
      message: `Invalid token size: expected ${AT_SIZE} (AT) or ${RT_SIZE} (RT) bytes, got ${bytes.length}`,
    };
  }
  return { valid: true };
}

/**
 * Validate a decoded token.
 *
 * - Access Token: check expiration
 * - Refresh Token: always valid (no TTL)
 *
 * @param token - Decoded token
 * @param now - Current timestamp in milliseconds (defaults to Date.now())
 * @returns Validation result
 */
export function validateToken(token: DecodedToken, now: number = Date.now()): ValidationResult {
  if (token.type === "access") {
    if (token.expiresAt <= now) {
      return {
        valid: false,
        error: "expired",
        message: `Token expired at ${new Date(token.expiresAt).toISOString()}`,
      };
    }
  }
  // Refresh tokens have no TTL — always valid structurally
  return { valid: true };
}
