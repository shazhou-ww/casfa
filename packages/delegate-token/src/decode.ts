/**
 * Delegate Token decoding
 */

import { DELEGATE_TOKEN_SIZE, FLAGS, MAGIC_NUMBER, OFFSETS, SIZES } from "./constants.ts";
import type { DelegateToken, DelegateTokenFlags } from "./types.ts";

/**
 * Decode flags from u32 value
 */
function decodeFlags(flagsValue: number): DelegateTokenFlags {
  return {
    isDelegate: (flagsValue & (1 << FLAGS.IS_DELEGATE)) !== 0,
    isUserIssued: (flagsValue & (1 << FLAGS.IS_USER_ISSUED)) !== 0,
    canUpload: (flagsValue & (1 << FLAGS.CAN_UPLOAD)) !== 0,
    canManageDepot: (flagsValue & (1 << FLAGS.CAN_MANAGE_DEPOT)) !== 0,
    depth: (flagsValue >> FLAGS.DEPTH_SHIFT) & FLAGS.DEPTH_MASK,
  };
}

/**
 * Decode a 128-byte binary Delegate Token
 *
 * @param bytes - 128-byte Uint8Array containing the token
 * @returns Decoded DelegateToken object
 * @throws Error if token format is invalid
 */
export function decodeDelegateToken(bytes: Uint8Array): DelegateToken {
  // Validate size
  if (bytes.length !== DELEGATE_TOKEN_SIZE) {
    throw new Error(
      `Invalid token size: expected ${DELEGATE_TOKEN_SIZE} bytes, got ${bytes.length}`
    );
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // Validate magic number
  const magic = view.getUint32(OFFSETS.MAGIC, true);
  if (magic !== MAGIC_NUMBER) {
    throw new Error(
      `Invalid magic number: expected 0x${MAGIC_NUMBER.toString(16)}, got 0x${magic.toString(16)}`
    );
  }

  // Read flags
  const flagsValue = view.getUint32(OFFSETS.FLAGS, true);
  const flags = decodeFlags(flagsValue);

  // Read TTL
  const ttl = Number(view.getBigUint64(OFFSETS.TTL, true));

  // Read quota
  const quota = Number(view.getBigUint64(OFFSETS.QUOTA, true));

  // Read salt
  const salt = bytes.slice(OFFSETS.SALT, OFFSETS.SALT + SIZES.SALT);

  // Read issuer
  const issuer = bytes.slice(OFFSETS.ISSUER, OFFSETS.ISSUER + SIZES.ISSUER);

  // Read realm
  const realm = bytes.slice(OFFSETS.REALM, OFFSETS.REALM + SIZES.REALM);

  // Read scope
  const scope = bytes.slice(OFFSETS.SCOPE, OFFSETS.SCOPE + SIZES.SCOPE);

  return {
    flags,
    ttl,
    quota,
    salt,
    issuer,
    realm,
    scope,
  };
}
