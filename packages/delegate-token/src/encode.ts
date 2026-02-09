/**
 * Delegate Token encoding
 *
 * v2: Delegate-as-entity model
 * Flags low nibble: is_refresh(0), can_upload(1), can_manage_depot(2), reserved(3)
 * Flags high nibble: depth(4-7)
 */

import {
  DELEGATE_TOKEN_SIZE,
  FLAGS,
  MAGIC_NUMBER,
  MAX_DEPTH,
  OFFSETS,
  SIZES,
} from "./constants.ts";
import type { DelegateTokenInput } from "./types.ts";

/**
 * Generate cryptographically secure random bytes for salt
 */
function generateSalt(): Uint8Array {
  const salt = new Uint8Array(SIZES.SALT);
  crypto.getRandomValues(salt);
  return salt;
}

/**
 * Encode a Delegate Token to 128-byte binary format
 *
 * @param input - Token parameters
 * @returns 128-byte Uint8Array containing the encoded token
 * @throws Error if input validation fails
 */
export function encodeDelegateToken(input: DelegateTokenInput): Uint8Array {
  // Validate issuer size
  if (input.issuer.length !== SIZES.ISSUER) {
    throw new Error(
      `Invalid issuer length: expected ${SIZES.ISSUER} bytes, got ${input.issuer.length}`
    );
  }

  // Validate realm size
  if (input.realm.length !== SIZES.REALM) {
    throw new Error(
      `Invalid realm length: expected ${SIZES.REALM} bytes, got ${input.realm.length}`
    );
  }

  // Validate scope size
  if (input.scope.length !== SIZES.SCOPE) {
    throw new Error(
      `Invalid scope length: expected ${SIZES.SCOPE} bytes, got ${input.scope.length}`
    );
  }

  // Validate depth
  if (input.depth < 0 || input.depth > MAX_DEPTH) {
    throw new Error(`Delegation depth out of range: ${input.depth} (must be 0-${MAX_DEPTH})`);
  }

  // Allocate buffer
  const buffer = new Uint8Array(DELEGATE_TOKEN_SIZE);
  const view = new DataView(buffer.buffer);

  // Write magic number (u32 LE)
  view.setUint32(OFFSETS.MAGIC, MAGIC_NUMBER, true);

  // Build and write flags (u32 LE)
  // Low nibble: bit 0 is_refresh, bit 1 can_upload, bit 2 can_manage_depot, bit 3 reserved
  // High nibble: bits 4-7 depth
  let flags = 0;
  if (input.type === "refresh") {
    flags |= 1 << FLAGS.IS_REFRESH;
  }
  if (input.canUpload) {
    flags |= 1 << FLAGS.CAN_UPLOAD;
  }
  if (input.canManageDepot) {
    flags |= 1 << FLAGS.CAN_MANAGE_DEPOT;
  }
  flags |= (input.depth & FLAGS.DEPTH_MASK) << FLAGS.DEPTH_SHIFT;
  view.setUint32(OFFSETS.FLAGS, flags, true);

  // Write TTL (u64 LE) — 0 for Refresh Tokens
  view.setBigUint64(OFFSETS.TTL, BigInt(input.ttl), true);

  // Write quota (u64 LE, reserved - default 0)
  view.setBigUint64(OFFSETS.QUOTA, BigInt(input.quota ?? 0), true);

  // Generate and write salt (8 bytes)
  const salt = generateSalt();
  buffer.set(salt, OFFSETS.SALT);

  // Write issuer (32 bytes) — Delegate UUID left-padded
  buffer.set(input.issuer, OFFSETS.ISSUER);

  // Write realm (32 bytes)
  buffer.set(input.realm, OFFSETS.REALM);

  // Write scope (32 bytes)
  buffer.set(input.scope, OFFSETS.SCOPE);

  return buffer;
}
