/**
 * Shared Delegate Token Refresh Logic
 *
 * Core refresh flow used by both:
 * - POST /api/auth/refresh (internal format)
 * - POST /api/auth/token grant_type=refresh_token (OAuth format)
 *
 * Extracts the common logic: decode RT → verify → rotate → return new tokens.
 */

import { decodeToken } from "@casfa/delegate-token";
import type { DelegatesDb } from "../db/delegates.ts";
import {
  bytesToDelegateId,
  computeTokenHash,
  generateTokenPair,
} from "../util/delegate-token-utils.ts";

// ============================================================================
// Types
// ============================================================================

export type RefreshDeps = {
  delegatesDb: DelegatesDb;
};

export type RefreshResult = {
  newAccessToken: string; // base64
  newRefreshToken: string; // base64
  accessTokenExpiresAt: number;
  delegateId: string;
};

export class RefreshError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 401
  ) {
    super(message);
    this.name = "RefreshError";
  }
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_AT_TTL_SECONDS = 3600;

// ============================================================================
// Shared Refresh Function
// ============================================================================

/**
 * Perform delegate token refresh: decode RT → verify → rotate → return new tokens.
 *
 * @param rtBytes - The raw refresh token bytes (24 bytes)
 * @param deps - Database dependencies
 * @returns New token pair + metadata
 * @throws RefreshError on any validation failure
 */
export async function refreshDelegateToken(
  rtBytes: Uint8Array,
  deps: RefreshDeps
): Promise<RefreshResult> {
  const { delegatesDb } = deps;

  // 1. Decode token → extract delegateId
  let decoded;
  try {
    decoded = decodeToken(rtBytes);
  } catch (e) {
    throw new RefreshError(
      "INVALID_TOKEN_FORMAT",
      e instanceof Error ? e.message : "Invalid token format"
    );
  }

  if (decoded.type !== "refresh") {
    throw new RefreshError(
      "NOT_REFRESH_TOKEN",
      "Expected a Refresh Token, got an Access Token",
      400
    );
  }

  const delegateId = bytesToDelegateId(decoded.delegateId);

  // 2. Look up delegate
  const delegate = await delegatesDb.get(delegateId);
  if (!delegate) {
    throw new RefreshError("DELEGATE_NOT_FOUND", "Delegate not found");
  }

  // Root delegates (depth=0) use JWT auth directly
  if (delegate.depth === 0) {
    throw new RefreshError(
      "ROOT_REFRESH_NOT_ALLOWED",
      "Root delegate uses JWT authentication directly",
      400
    );
  }

  if (delegate.isRevoked) {
    throw new RefreshError("DELEGATE_REVOKED", "Associated delegate has been revoked");
  }

  if (delegate.expiresAt && delegate.expiresAt < Date.now()) {
    throw new RefreshError("DELEGATE_EXPIRED", "Associated delegate has expired");
  }

  // 3. Verify RT hash matches
  const rtHash = computeTokenHash(rtBytes);
  if (rtHash !== delegate.currentRtHash) {
    throw new RefreshError("TOKEN_INVALID", "Refresh token is no longer valid (possible replay)");
  }

  // 4. Generate new RT + AT pair
  const newTokenPair = generateTokenPair({
    delegateId,
    accessTokenTtlSeconds: DEFAULT_AT_TTL_SECONDS,
  });

  // 5. Atomic conditional update — ensures no concurrent refresh
  const rotated = await delegatesDb.rotateTokens({
    delegateId,
    expectedRtHash: rtHash,
    newRtHash: newTokenPair.refreshToken.hash,
    newAtHash: newTokenPair.accessToken.hash,
    newAtExpiresAt: newTokenPair.accessToken.expiresAt,
  });

  if (!rotated) {
    throw new RefreshError(
      "TOKEN_INVALID",
      "Refresh token was already used (concurrent request)",
      409
    );
  }

  return {
    newAccessToken: newTokenPair.accessToken.base64,
    newRefreshToken: newTokenPair.refreshToken.base64,
    accessTokenExpiresAt: newTokenPair.accessToken.expiresAt,
    delegateId,
  };
}
