/**
 * Delegate Token validation
 */

import { DELEGATE_TOKEN_SIZE, MAGIC_NUMBER, MAX_DEPTH, OFFSETS } from "./constants.ts";
import type { DelegateToken, ValidationResult } from "./types.ts";

/**
 * Validate a decoded Delegate Token
 *
 * @param token - Decoded token to validate
 * @param now - Current timestamp in milliseconds (defaults to Date.now())
 * @returns Validation result
 */
export function validateToken(token: DelegateToken, now: number = Date.now()): ValidationResult {
  // Check expiration
  if (token.ttl <= now) {
    return {
      valid: false,
      error: "expired",
      message: `Token expired at ${new Date(token.ttl).toISOString()}`,
    };
  }

  // Check depth
  if (token.flags.depth > MAX_DEPTH) {
    return {
      valid: false,
      error: "depth_exceeded",
      message: `Token depth ${token.flags.depth} exceeds maximum ${MAX_DEPTH}`,
    };
  }

  // Check flags consistency
  // User-issued tokens should have depth 0
  if (token.flags.isUserIssued && token.flags.depth !== 0) {
    return {
      valid: false,
      error: "invalid_flags",
      message: `User-issued token should have depth 0, got ${token.flags.depth}`,
    };
  }

  // Delegated tokens should have depth > 0
  if (!token.flags.isUserIssued && token.flags.depth === 0) {
    return {
      valid: false,
      error: "invalid_flags",
      message: "Delegated token should have depth > 0",
    };
  }

  return { valid: true };
}

/**
 * Validate raw token bytes (quick checks without full decode)
 *
 * @param bytes - Raw token bytes
 * @returns Validation result
 */
export function validateTokenBytes(bytes: Uint8Array): ValidationResult {
  // Check size
  if (bytes.length !== DELEGATE_TOKEN_SIZE) {
    return {
      valid: false,
      error: "invalid_size",
      message: `Invalid token size: expected ${DELEGATE_TOKEN_SIZE} bytes, got ${bytes.length}`,
    };
  }

  // Check magic number
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = view.getUint32(OFFSETS.MAGIC, true);
  if (magic !== MAGIC_NUMBER) {
    return {
      valid: false,
      error: "invalid_magic",
      message: `Invalid magic number: expected 0x${MAGIC_NUMBER.toString(16)}, got 0x${magic.toString(16)}`,
    };
  }

  return { valid: true };
}
