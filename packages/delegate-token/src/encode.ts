/**
 * Delegate Token encoding
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

  // Calculate depth
  const depth = input.isUserIssued ? 0 : (input.parentDepth ?? 0) + 1;
  if (depth > MAX_DEPTH) {
    throw new Error(
      `Maximum token delegation depth exceeded: ${depth} > ${MAX_DEPTH}`
    );
  }

  // Allocate buffer
  const buffer = new Uint8Array(DELEGATE_TOKEN_SIZE);
  const view = new DataView(buffer.buffer);

  // Write magic number (u32 LE)
  view.setUint32(OFFSETS.MAGIC, MAGIC_NUMBER, true);

  // Build and write flags (u32 LE)
  let flags = 0;
  if (input.type === "delegate") {
    flags |= 1 << FLAGS.IS_DELEGATE;
  }
  if (input.isUserIssued) {
    flags |= 1 << FLAGS.IS_USER_ISSUED;
  }
  if (input.canUpload) {
    flags |= 1 << FLAGS.CAN_UPLOAD;
  }
  if (input.canManageDepot) {
    flags |= 1 << FLAGS.CAN_MANAGE_DEPOT;
  }
  flags |= (depth & FLAGS.DEPTH_MASK) << FLAGS.DEPTH_SHIFT;
  view.setUint32(OFFSETS.FLAGS, flags, true);

  // Write TTL (u64 LE)
  view.setBigUint64(OFFSETS.TTL, BigInt(input.ttl), true);

  // Write quota (u64 LE, reserved - default 0)
  view.setBigUint64(OFFSETS.QUOTA, BigInt(input.quota ?? 0), true);

  // Generate and write salt (8 bytes)
  const salt = generateSalt();
  buffer.set(salt, OFFSETS.SALT);

  // Write issuer (32 bytes)
  buffer.set(input.issuer, OFFSETS.ISSUER);

  // Write realm (32 bytes)
  buffer.set(input.realm, OFFSETS.REALM);

  // Write scope (32 bytes)
  buffer.set(input.scope, OFFSETS.SCOPE);

  return buffer;
}
