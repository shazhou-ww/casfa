/**
 * Delegate Token decoding — v3 (simplified)
 *
 * AT and RT distinguished by byte length:
 *   32 bytes → Access Token
 *   24 bytes → Refresh Token
 */

import {
  AT_OFFSETS,
  AT_SIZE,
  DELEGATE_ID_SIZE,
  NONCE_SIZE,
  RT_OFFSETS,
  RT_SIZE,
} from "./constants.ts";
import type { DecodedAccessToken, DecodedRefreshToken, DecodedToken } from "./types.ts";

/**
 * Decode a binary token by byte length.
 *
 *   32 bytes → Access Token:  [delegateId 16B] [expiresAt 8B LE] [nonce 8B]
 *   24 bytes → Refresh Token: [delegateId 16B] [nonce 8B]
 *
 * @param bytes - Raw token bytes (32 or 24)
 * @returns Decoded token with discriminating `type` field
 * @throws Error if byte length is neither 32 nor 24
 */
export function decodeToken(bytes: Uint8Array): DecodedToken {
  if (bytes.length === AT_SIZE) {
    return decodeAccessToken(bytes);
  }
  if (bytes.length === RT_SIZE) {
    return decodeRefreshToken(bytes);
  }
  throw new Error(
    `Invalid token size: expected ${AT_SIZE} (AT) or ${RT_SIZE} (RT) bytes, got ${bytes.length}`
  );
}

/**
 * Decode a 32-byte Access Token
 */
function decodeAccessToken(bytes: Uint8Array): DecodedAccessToken {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const delegateId = bytes.slice(AT_OFFSETS.DELEGATE_ID, AT_OFFSETS.DELEGATE_ID + DELEGATE_ID_SIZE);
  const expiresAt = Number(view.getBigUint64(AT_OFFSETS.EXPIRES_AT, true));
  const nonce = bytes.slice(AT_OFFSETS.NONCE, AT_OFFSETS.NONCE + NONCE_SIZE);

  return { type: "access", delegateId, expiresAt, nonce };
}

/**
 * Decode a 24-byte Refresh Token
 */
function decodeRefreshToken(bytes: Uint8Array): DecodedRefreshToken {
  const delegateId = bytes.slice(RT_OFFSETS.DELEGATE_ID, RT_OFFSETS.DELEGATE_ID + DELEGATE_ID_SIZE);
  const nonce = bytes.slice(RT_OFFSETS.NONCE, RT_OFFSETS.NONCE + NONCE_SIZE);

  return { type: "refresh", delegateId, nonce };
}
