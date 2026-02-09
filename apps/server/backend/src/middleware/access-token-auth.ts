/**
 * Access Token Authentication Middleware (New Delegate Model)
 *
 * Validates Access Tokens by looking up the TokenRecord (from token-records.ts)
 * and the associated Delegate entity (from delegates.ts).
 *
 * Flow:
 *   1. Extract Base64 Bearer token from Authorization header
 *   2. Decode 128-byte binary token, compute tokenId via Blake3
 *   3. Look up TokenRecord — must be type="access", not invalidated, not expired
 *   4. Look up Delegate — must not be revoked, not expired
 *   5. Build AccessTokenAuthContext with Delegate info
 */

import type { Delegate } from "@casfa/delegate";
import type { MiddlewareHandler } from "hono";
import type { DelegatesDb } from "../db/delegates.ts";
import type { TokenRecordsDb } from "../db/token-records.ts";
import type { AccessTokenAuthContext, Env } from "../types.ts";
import { computeTokenId, TOKEN_SIZE } from "../util/token.ts";

// ============================================================================
// Types
// ============================================================================

export type AccessTokenMiddlewareDeps = {
  tokenRecordsDb: TokenRecordsDb;
  delegatesDb: DelegatesDb;
};

// ============================================================================
// Middleware Factory
// ============================================================================

/**
 * Create Access Token authentication middleware.
 *
 * Validates an Access Token and sets `auth` on the Hono context
 * with the associated Delegate entity's permissions and scope.
 */
export const createAccessTokenMiddleware = (
  deps: AccessTokenMiddlewareDeps,
): MiddlewareHandler<Env> => {
  const { tokenRecordsDb, delegatesDb } = deps;

  return async (c, next) => {
    // 1. Extract Authorization header
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

    // 2. Decode token bytes
    let tokenBytes: Uint8Array;
    try {
      const buffer = Buffer.from(tokenBase64, "base64");
      if (buffer.length !== TOKEN_SIZE) {
        return c.json(
          { error: "INVALID_TOKEN_FORMAT", message: `Token must be ${TOKEN_SIZE} bytes` },
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

    // 3. Look up TokenRecord
    const tokenId = computeTokenId(tokenBytes);
    const tokenRecord = await tokenRecordsDb.get(tokenId);

    if (!tokenRecord) {
      return c.json(
        { error: "TOKEN_NOT_FOUND", message: "Token not found or invalid" },
        401,
      );
    }

    // Must be access token
    if (tokenRecord.tokenType !== "access") {
      return c.json(
        {
          error: "ACCESS_TOKEN_REQUIRED",
          message: "This endpoint requires an Access Token",
        },
        403,
      );
    }

    // Check invalidated (token family invalidation)
    if (tokenRecord.isInvalidated) {
      return c.json(
        { error: "TOKEN_INVALIDATED", message: "Token has been invalidated" },
        401,
      );
    }

    // Check expired
    if (tokenRecord.expiresAt > 0 && tokenRecord.expiresAt < Date.now()) {
      return c.json(
        { error: "TOKEN_EXPIRED", message: "Token has expired" },
        401,
      );
    }

    // 4. Look up Delegate
    const delegate: Delegate | null = await delegatesDb.get(
      tokenRecord.realm,
      tokenRecord.delegateId,
    );

    if (!delegate) {
      return c.json(
        { error: "DELEGATE_NOT_FOUND", message: "Associated delegate not found" },
        401,
      );
    }

    // Check delegate revoked
    if (delegate.isRevoked) {
      return c.json(
        { error: "DELEGATE_REVOKED", message: "The delegate has been revoked" },
        401,
      );
    }

    // Check delegate expired
    if (delegate.expiresAt && delegate.expiresAt < Date.now()) {
      return c.json(
        { error: "DELEGATE_EXPIRED", message: "The delegate has expired" },
        401,
      );
    }

    // 5. Build auth context from Delegate
    const auth: AccessTokenAuthContext = {
      type: "access",
      tokenId,
      tokenBytes,
      delegate,
      delegateId: delegate.delegateId,
      realm: delegate.realm,
      canUpload: delegate.canUpload,
      canManageDepot: delegate.canManageDepot,
      issuerChain: delegate.chain,
    };

    c.set("auth", auth);
    return next();
  };
};
