/**
 * Delegate Token encoding — v3 (simplified)
 *
 * AT (32 bytes): [delegateId 16B] [expiresAt 8B] [nonce 8B]
 * RT (24 bytes): [delegateId 16B] [nonce 8B]
 */

import {
  AT_OFFSETS,
  AT_SIZE,
  DELEGATE_ID_SIZE,
  NONCE_SIZE,
  RT_OFFSETS,
  RT_SIZE,
} from "./constants.ts";
import type { EncodeAccessTokenInput, EncodeRefreshTokenInput } from "./types.ts";

/**
 * Generate cryptographically secure random nonce
 */
function generateNonce(): Uint8Array {
  const nonce = new Uint8Array(NONCE_SIZE);
  crypto.getRandomValues(nonce);
  return nonce;
}

/**
 * Validate delegateId is exactly 16 bytes
 */
function validateDelegateId(delegateId: Uint8Array): void {
  if (delegateId.length !== DELEGATE_ID_SIZE) {
    throw new Error(
      `Invalid delegateId length: expected ${DELEGATE_ID_SIZE} bytes, got ${delegateId.length}`
    );
  }
}

/**
 * Encode an Access Token to 32-byte binary format.
 *
 * Layout: [delegateId 16B] [expiresAt 8B LE] [nonce 8B]
 *
 * @param input - Token parameters
 * @returns 32-byte Uint8Array
 */
export function encodeAccessToken(input: EncodeAccessTokenInput): Uint8Array {
  validateDelegateId(input.delegateId);

  const buffer = new Uint8Array(AT_SIZE);
  const view = new DataView(buffer.buffer);

  // Write delegateId (16 bytes)
  buffer.set(input.delegateId, AT_OFFSETS.DELEGATE_ID);

  // Write expiresAt (u64 LE)
  view.setBigUint64(AT_OFFSETS.EXPIRES_AT, BigInt(input.expiresAt), true);

  // Write nonce (8 bytes)
  buffer.set(generateNonce(), AT_OFFSETS.NONCE);

  return buffer;
}

/**
 * Encode a Refresh Token to 24-byte binary format.
 *
 * Layout: [delegateId 16B] [nonce 8B]
 *
 * @param input - Token parameters
 * @returns 24-byte Uint8Array
 */
export function encodeRefreshToken(input: EncodeRefreshTokenInput): Uint8Array {
  validateDelegateId(input.delegateId);

  const buffer = new Uint8Array(RT_SIZE);

  // Write delegateId (16 bytes)
  buffer.set(input.delegateId, RT_OFFSETS.DELEGATE_ID);

  // Write nonce (8 bytes)
  buffer.set(generateNonce(), RT_OFFSETS.NONCE);

  return buffer;
}
