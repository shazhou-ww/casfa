/**
 * Refresh Token Controller
 *
 * POST /api/tokens/refresh — Binary RT → new RT + new AT (rotation)
 *
 * Implements RT one-time-use rotation:
 * 1. Decode binary RT from Authorization header
 * 2. Compute tokenId → look up TokenRecord
 * 3. Check isUsed:
 *    - already used → 409 TOKEN_REUSE + invalidate token family
 *    - not used → mark used, issue new RT + AT
 * 4. Check isInvalidated → 401 TOKEN_INVALIDATED
 * 5. Issue new RT + AT with same delegateId
 */

import {
  computeTokenId as computeTokenIdRaw,
  decodeDelegateToken,
  DELEGATE_TOKEN_SIZE,
  formatTokenId,
} from "@casfa/delegate-token";
import { blake3 } from "@noble/hashes/blake3";
import type { Context } from "hono";
import type { DelegatesDb } from "../db/delegates.ts";
import type { TokenRecordsDb } from "../db/token-records.ts";
import type { Env } from "../types.ts";
import {
  computeRealmHash,
  computeScopeHash,
  generateTokenPair,
} from "../util/delegate-token-utils.ts";

// ============================================================================
// Types
// ============================================================================

export type RefreshControllerDeps = {
  delegatesDb: DelegatesDb;
  tokenRecordsDb: TokenRecordsDb;
};

export type RefreshController = {
  refresh: (c: Context<Env>) => Promise<Response>;
};

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_AT_TTL_SECONDS = 3600; // 1 hour

/**
 * Blake3-128 hash function for computing Token IDs
 */
const blake3_128 = (data: Uint8Array): Uint8Array => {
  return blake3(data, { dkLen: 16 });
};

// ============================================================================
// Controller Factory
// ============================================================================

export const createRefreshController = (
  deps: RefreshControllerDeps,
): RefreshController => {
  const { delegatesDb, tokenRecordsDb } = deps;

  /**
   * POST /api/tokens/refresh
   *
   * RT is passed via Authorization: Bearer {base64} header.
   */
  const refresh = async (c: Context<Env>): Promise<Response> => {
    // 1. Extract RT from Authorization header
    const authHeader = c.req.header("Authorization");
    if (!authHeader) {
      return c.json(
        { error: "UNAUTHORIZED", message: "Missing Authorization header" },
        401,
      );
    }

    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer") {
      return c.json(
        { error: "UNAUTHORIZED", message: "Invalid Authorization header format" },
        401,
      );
    }

    const tokenBase64 = parts[1]!;

    // 2. Decode RT binary
    let tokenBytes: Uint8Array;
    try {
      const buffer = Buffer.from(tokenBase64, "base64");
      if (buffer.length !== DELEGATE_TOKEN_SIZE) {
        return c.json(
          {
            error: "INVALID_TOKEN_FORMAT",
            message: `Token must be ${DELEGATE_TOKEN_SIZE} bytes`,
          },
          401,
        );
      }
      tokenBytes = new Uint8Array(buffer);
    } catch {
      return c.json(
        { error: "INVALID_TOKEN_FORMAT", message: "Invalid Base64 encoding" },
        401,
      );
    }

    // 3. Verify it's a refresh token
    let decoded;
    try {
      decoded = decodeDelegateToken(tokenBytes);
    } catch (e) {
      return c.json(
        {
          error: "INVALID_TOKEN_FORMAT",
          message: e instanceof Error ? e.message : "Invalid token format",
        },
        401,
      );
    }

    if (!decoded.flags.isRefresh) {
      return c.json(
        {
          error: "NOT_REFRESH_TOKEN",
          message: "Expected a Refresh Token, got an Access Token",
        },
        400,
      );
    }

    // 4. Compute Token ID
    const tokenIdRaw = await computeTokenIdRaw(tokenBytes, blake3_128);
    const tokenId = formatTokenId(tokenIdRaw);

    // 5. Look up token record
    const tokenRecord = await tokenRecordsDb.get(tokenId);
    if (!tokenRecord) {
      return c.json(
        { error: "TOKEN_NOT_FOUND", message: "Refresh token not found" },
        401,
      );
    }

    // 6. Check if token family is invalidated
    if (tokenRecord.isInvalidated) {
      return c.json(
        {
          error: "TOKEN_INVALIDATED",
          message: "Token family has been invalidated due to security concern",
        },
        401,
      );
    }

    // 7. Check one-time-use: if already used → replay detected → invalidate family
    if (tokenRecord.isUsed) {
      // RT replay detected! Invalidate the entire token family
      await tokenRecordsDb.invalidateFamily(tokenRecord.familyId);
      return c.json(
        {
          error: "TOKEN_REUSE",
          message:
            "Refresh token has already been used. All tokens in this family have been invalidated.",
        },
        409,
      );
    }

    // 8. Mark RT as used (atomic conditional update)
    const markSuccess = await tokenRecordsDb.markUsed(tokenId);
    if (!markSuccess) {
      // Race condition: another request used it first
      await tokenRecordsDb.invalidateFamily(tokenRecord.familyId);
      return c.json(
        {
          error: "TOKEN_REUSE",
          message: "Refresh token was already used (concurrent request detected)",
        },
        409,
      );
    }

    // 9. Verify the delegate still exists and is not revoked
    const delegate = await delegatesDb.get(
      tokenRecord.realm,
      tokenRecord.delegateId,
    );
    if (!delegate) {
      return c.json(
        { error: "DELEGATE_NOT_FOUND", message: "Associated delegate not found" },
        401,
      );
    }

    if (delegate.isRevoked) {
      return c.json(
        { error: "DELEGATE_REVOKED", message: "Associated delegate has been revoked" },
        401,
      );
    }

    if (delegate.expiresAt && delegate.expiresAt < Date.now()) {
      return c.json(
        { error: "DELEGATE_EXPIRED", message: "Associated delegate has expired" },
        401,
      );
    }

    // 10. Issue new RT + AT pair
    const realmHash = computeRealmHash(tokenRecord.realm);

    // Get scope roots for scope hash
    let scopeRoots: string[] = [];
    if (delegate.scopeNodeHash) {
      scopeRoots = [delegate.scopeNodeHash];
    }
    // For root delegates (no scope), scopeRoots stays empty
    const scopeHash = computeScopeHash(scopeRoots);

    const newTokenPair = await generateTokenPair({
      delegateId: tokenRecord.delegateId,
      realmHash,
      scopeHash,
      depth: delegate.depth,
      canUpload: delegate.canUpload,
      canManageDepot: delegate.canManageDepot,
      accessTokenTtlSeconds: DEFAULT_AT_TTL_SECONDS,
    });

    // Store new token records with the SAME familyId for family tracking
    await tokenRecordsDb.create({
      tokenId: newTokenPair.refreshToken.id,
      tokenType: "refresh",
      delegateId: tokenRecord.delegateId,
      realm: tokenRecord.realm,
      expiresAt: 0,
      familyId: tokenRecord.familyId,
    });
    await tokenRecordsDb.create({
      tokenId: newTokenPair.accessToken.id,
      tokenType: "access",
      delegateId: tokenRecord.delegateId,
      realm: tokenRecord.realm,
      expiresAt: newTokenPair.accessToken.expiresAt,
      familyId: tokenRecord.familyId,
    });

    return c.json({
      refreshToken: newTokenPair.refreshToken.base64,
      accessToken: newTokenPair.accessToken.base64,
      refreshTokenId: newTokenPair.refreshToken.id,
      accessTokenId: newTokenPair.accessToken.id,
      accessTokenExpiresAt: newTokenPair.accessToken.expiresAt,
      delegateId: tokenRecord.delegateId,
    });
  };

  return { refresh };
};
