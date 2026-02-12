/**
 * Refresh Token Controller (token-simplification v3)
 *
 * POST /api/auth/refresh — Binary RT → new RT + new AT (rotation)
 *
 * Simplified flow:
 * 1. Decode 24-byte RT from Authorization: Bearer {base64}
 * 2. Extract delegateId from token bytes
 * 3. Compute hash → compare with delegate.currentRtHash
 * 4. Generate new RT + AT pair
 * 5. Atomic conditional update: SET new hashes WHERE currentRtHash = old hash
 * 6. Return new tokens
 *
 * RT replay → conditional update fails → reject (do NOT auto-revoke delegate)
 */

import { decodeToken, RT_SIZE } from "@casfa/delegate-token";
import type { Context } from "hono";
import type { DelegatesDb } from "../db/delegates.ts";
import type { Env } from "../types.ts";
import {
  bytesToDelegateId,
  computeTokenHash,
  generateTokenPair,
} from "../util/delegate-token-utils.ts";

// ============================================================================
// Types
// ============================================================================

export type RefreshControllerDeps = {
  delegatesDb: DelegatesDb;
};

export type RefreshController = {
  refresh: (c: Context<Env>) => Promise<Response>;
};

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_AT_TTL_SECONDS = 3600; // 1 hour

// ============================================================================
// Controller Factory
// ============================================================================

export const createRefreshController = (deps: RefreshControllerDeps): RefreshController => {
  const { delegatesDb } = deps;

  /**
   * POST /api/auth/refresh
   *
   * RT is passed via Authorization: Bearer {base64} header.
   */
  const refresh = async (c: Context<Env>): Promise<Response> => {
    // 1. Extract RT from Authorization header
    const authHeader = c.req.header("Authorization");
    if (!authHeader) {
      return c.json({ error: "UNAUTHORIZED", message: "Missing Authorization header" }, 401);
    }

    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer") {
      return c.json({ error: "UNAUTHORIZED", message: "Invalid Authorization header format" }, 401);
    }

    const tokenBase64 = parts[1]!;

    // 2. Decode RT binary — must be 24 bytes
    let tokenBytes: Uint8Array;
    try {
      const buffer = Buffer.from(tokenBase64, "base64");
      if (buffer.length !== RT_SIZE) {
        return c.json(
          {
            error: "INVALID_TOKEN_FORMAT",
            message: `Refresh Token must be ${RT_SIZE} bytes`,
          },
          401
        );
      }
      tokenBytes = new Uint8Array(buffer);
    } catch {
      return c.json({ error: "INVALID_TOKEN_FORMAT", message: "Invalid Base64 encoding" }, 401);
    }

    // 3. Decode token to extract delegateId
    let decoded;
    try {
      decoded = decodeToken(tokenBytes);
    } catch (e) {
      return c.json(
        {
          error: "INVALID_TOKEN_FORMAT",
          message: e instanceof Error ? e.message : "Invalid token format",
        },
        401
      );
    }

    if (decoded.type !== "refresh") {
      return c.json(
        {
          error: "NOT_REFRESH_TOKEN",
          message: "Expected a Refresh Token, got an Access Token",
        },
        400
      );
    }

    const delegateId = bytesToDelegateId(decoded.delegateId);

    // 4. Look up delegate — single DB read
    const delegate = await delegatesDb.get(delegateId);
    if (!delegate) {
      return c.json({ error: "DELEGATE_NOT_FOUND", message: "Delegate not found" }, 401);
    }

    // Root delegates (depth=0) use JWT auth directly — no RT/AT rotation
    if (delegate.depth === 0) {
      return c.json(
        {
          error: "ROOT_REFRESH_NOT_ALLOWED",
          message: "Root delegate uses JWT authentication directly. Use your JWT for API calls.",
        },
        400
      );
    }

    if (delegate.isRevoked) {
      return c.json(
        { error: "DELEGATE_REVOKED", message: "Associated delegate has been revoked" },
        401
      );
    }

    if (delegate.expiresAt && delegate.expiresAt < Date.now()) {
      return c.json({ error: "DELEGATE_EXPIRED", message: "Associated delegate has expired" }, 401);
    }

    // 5. Verify RT hash matches
    const rtHash = computeTokenHash(tokenBytes);
    if (rtHash !== delegate.currentRtHash) {
      // RT replay or stale RT — reject without revoking delegate
      return c.json(
        {
          error: "TOKEN_INVALID",
          message: "Refresh token is no longer valid (possible replay)",
        },
        401
      );
    }

    // 6. Generate new RT + AT pair
    const newTokenPair = generateTokenPair({
      delegateId,
      accessTokenTtlSeconds: DEFAULT_AT_TTL_SECONDS,
    });

    // 7. Atomic conditional update — ensures no concurrent refresh
    const rotated = await delegatesDb.rotateTokens({
      delegateId,
      expectedRtHash: rtHash,
      newRtHash: newTokenPair.refreshToken.hash,
      newAtHash: newTokenPair.accessToken.hash,
      newAtExpiresAt: newTokenPair.accessToken.expiresAt,
    });

    if (!rotated) {
      // Concurrent refresh beat us — reject
      return c.json(
        {
          error: "TOKEN_INVALID",
          message: "Refresh token was already used (concurrent request)",
        },
        409
      );
    }

    // 8. Return new tokens
    return c.json({
      refreshToken: newTokenPair.refreshToken.base64,
      accessToken: newTokenPair.accessToken.base64,
      accessTokenExpiresAt: newTokenPair.accessToken.expiresAt,
      delegateId,
    });
  };

  return { refresh };
};
