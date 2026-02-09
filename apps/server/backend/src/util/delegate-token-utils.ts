/**
 * New delegate-model token utilities
 *
 * Uses @casfa/delegate-token package (LE binary format) for encoding
 * Refresh Tokens and Access Tokens.
 *
 * This module bridges the @casfa/delegate-token package with the server's
 * hash functions for creating token pairs for delegates.
 */

import {
  computeTokenId as computeTokenIdRaw,
  encodeDelegateToken,
  formatTokenId,
  type DelegateTokenInput,
} from "@casfa/delegate-token";
import { blake3 } from "@noble/hashes/blake3";

// ============================================================================
// Hash Function (server-side Blake3-128)
// ============================================================================

/**
 * Blake3-128 hash function for computing Token IDs.
 * Returns 16 bytes (128 bits) for use with @casfa/delegate-token.
 */
const blake3_128: (data: Uint8Array) => Uint8Array = (data) => {
  return blake3(data, { dkLen: 16 });
};

// ============================================================================
// Token Pair Generation
// ============================================================================

export type TokenPairInput = {
  /** Delegate ID (UUID v7) — will be left-padded to 32 bytes */
  delegateId: string;
  /** Realm hash (32 bytes) */
  realmHash: Uint8Array;
  /** Scope hash (32 bytes) — all zeros for root delegate */
  scopeHash: Uint8Array;
  /** Delegation depth (0 for root) */
  depth: number;
  /** Can upload */
  canUpload: boolean;
  /** Can manage depots */
  canManageDepot: boolean;
  /** Access Token TTL in seconds (default: 3600 = 1 hour) */
  accessTokenTtlSeconds?: number;
};

export type TokenPair = {
  refreshToken: {
    bytes: Uint8Array;
    id: string;
    base64: string;
  };
  accessToken: {
    bytes: Uint8Array;
    id: string;
    base64: string;
    expiresAt: number;
  };
};

/**
 * Convert a delegate UUID string to a 32-byte issuer field.
 * UUID v7 is 16 bytes — left-pad with zeros to 32 bytes.
 */
export function delegateIdToIssuer(delegateId: string): Uint8Array {
  // Parse UUID hex — remove hyphens
  const hex = delegateId.replace(/-/g, "");
  if (hex.length !== 32) {
    throw new Error(`Invalid delegate ID format (expected UUID): ${delegateId}`);
  }

  const issuer = new Uint8Array(32);
  // Left-pad: write 16-byte UUID to bytes 16-31
  for (let i = 0; i < 16; i++) {
    issuer[16 + i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return issuer;
}

/**
 * Compute realm hash from realm string
 */
export function computeRealmHash(realm: string): Uint8Array {
  return blake3(`realm:${realm}`);
}

/**
 * Compute scope hash from scope root(s)
 */
export function computeScopeHash(scopeRoots: string[]): Uint8Array {
  if (scopeRoots.length === 0) {
    return blake3("scope:empty");
  }
  if (scopeRoots.length === 1) {
    return blake3(`scope:${scopeRoots[0]}`);
  }
  const sorted = [...scopeRoots].sort();
  return blake3(`scope:${sorted.join(",")}`);
}

/** Default Access Token TTL: 1 hour */
const DEFAULT_AT_TTL_SECONDS = 3600;

/**
 * Generate a RT + AT pair for a delegate
 */
export async function generateTokenPair(input: TokenPairInput): Promise<TokenPair> {
  const {
    delegateId,
    realmHash,
    scopeHash,
    depth,
    canUpload,
    canManageDepot,
    accessTokenTtlSeconds = DEFAULT_AT_TTL_SECONDS,
  } = input;

  const issuer = delegateIdToIssuer(delegateId);

  // Encode Refresh Token (isRefresh = true, ttl = 0 = never expires)
  const rtInput: DelegateTokenInput = {
    type: "refresh",
    ttl: 0,
    canUpload,
    canManageDepot,
    issuer,
    realm: realmHash,
    scope: scopeHash,
    depth,
  };
  const rtBytes = encodeDelegateToken(rtInput);

  // Encode Access Token (isRefresh = false, ttl = expiresAt in ms)
  const atExpiresAt = Date.now() + accessTokenTtlSeconds * 1000;
  const atInput: DelegateTokenInput = {
    type: "access",
    ttl: atExpiresAt,
    canUpload,
    canManageDepot,
    issuer,
    realm: realmHash,
    scope: scopeHash,
    depth,
  };
  const atBytes = encodeDelegateToken(atInput);

  // Compute Token IDs
  const rtIdRaw = await computeTokenIdRaw(rtBytes, blake3_128);
  const atIdRaw = await computeTokenIdRaw(atBytes, blake3_128);

  const rtId = formatTokenId(rtIdRaw);
  const atId = formatTokenId(atIdRaw);

  return {
    refreshToken: {
      bytes: rtBytes,
      id: rtId,
      base64: Buffer.from(rtBytes).toString("base64"),
    },
    accessToken: {
      bytes: atBytes,
      id: atId,
      base64: Buffer.from(atBytes).toString("base64"),
      expiresAt: atExpiresAt,
    },
  };
}
