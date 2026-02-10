/**
 * Delegate token utilities (v3 — simplified format)
 *
 * Bridges @casfa/delegate-token v3 with server-side Blake3 hashing.
 *
 * Token format:
 * - Access Token: 32 bytes [delegateId 16B][expiresAt 8B LE][nonce 8B]
 * - Refresh Token: 24 bytes [delegateId 16B][nonce 8B]
 *
 * Token hashes (Blake3-128, 32-char hex) are stored on the Delegate entity
 * instead of in a separate TokenRecord table.
 */

import {
  encodeAccessToken,
  encodeRefreshToken,
} from "@casfa/delegate-token";
import { blake3 } from "@noble/hashes/blake3";
import { fromCrockfordBase32, toCrockfordBase32 } from "./encoding.ts";

// ============================================================================
// Hash Utilities
// ============================================================================

/**
 * Compute Blake3-128 hash of token bytes → hex string (32 chars).
 * Used for storing currentRtHash / currentAtHash on Delegate.
 */
export function computeTokenHash(tokenBytes: Uint8Array): string {
  const hash = blake3(tokenBytes, { dkLen: 16 }); // 128 bits = 16 bytes
  return Buffer.from(hash).toString("hex");
}

// ============================================================================
// Delegate ID ↔ Raw Bytes
// ============================================================================

/**
 * Convert a delegate ID string (dlt_CB32) to raw 16 bytes.
 */
export function delegateIdToBytes(delegateId: string): Uint8Array {
  if (!delegateId.startsWith("dlt_")) {
    throw new Error(`Invalid delegate ID format (expected dlt_ prefix): ${delegateId}`);
  }
  const base32Part = delegateId.slice(4);
  const decoded = fromCrockfordBase32(base32Part);
  if (decoded.length !== 16) {
    throw new Error(`Invalid delegate ID: expected 16 bytes, got ${decoded.length}`);
  }
  return decoded;
}

/**
 * Convert raw 16 bytes back to delegate ID string (dlt_CB32).
 */
export function bytesToDelegateId(bytes: Uint8Array): string {
  if (bytes.length !== 16) {
    throw new Error(`Expected 16 bytes, got ${bytes.length}`);
  }
  return `dlt_${toCrockfordBase32(bytes)}`;
}

// ============================================================================
// Token Pair Generation
// ============================================================================

/** Default Access Token TTL: 1 hour */
const DEFAULT_AT_TTL_SECONDS = 3600;

export type TokenPairInput = {
  /** Delegate ID (dlt_CB32 format) */
  delegateId: string;
  /** Access Token TTL in seconds (default: 3600 = 1 hour) */
  accessTokenTtlSeconds?: number;
};

export type TokenPair = {
  refreshToken: {
    bytes: Uint8Array;
    hash: string;
    base64: string;
  };
  accessToken: {
    bytes: Uint8Array;
    hash: string;
    base64: string;
    expiresAt: number;
  };
};

/**
 * Generate a RT + AT pair for a delegate.
 *
 * Returns the raw bytes, base64, and Blake3-128 hash for each token.
 * The hashes are stored on the Delegate entity for later verification.
 */
export function generateTokenPair(input: TokenPairInput): TokenPair {
  const {
    delegateId,
    accessTokenTtlSeconds = DEFAULT_AT_TTL_SECONDS,
  } = input;

  const delegateIdBytes = delegateIdToBytes(delegateId);

  // AT: 32 bytes
  const atExpiresAt = Date.now() + accessTokenTtlSeconds * 1000;
  const atBytes = encodeAccessToken({
    delegateId: delegateIdBytes,
    expiresAt: atExpiresAt,
  });

  // RT: 24 bytes
  const rtBytes = encodeRefreshToken({
    delegateId: delegateIdBytes,
  });

  return {
    refreshToken: {
      bytes: rtBytes,
      hash: computeTokenHash(rtBytes),
      base64: Buffer.from(rtBytes).toString("base64"),
    },
    accessToken: {
      bytes: atBytes,
      hash: computeTokenHash(atBytes),
      base64: Buffer.from(atBytes).toString("base64"),
      expiresAt: atExpiresAt,
    },
  };
}
