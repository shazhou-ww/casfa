/**
 * Access Token Authentication Middleware (token-simplification v3)
 *
 * Validates Access Tokens by:
 *   1. Decode 32-byte AT from Authorization: Bearer {base64}
 *   2. Extract delegateId from token bytes (first 16 bytes)
 *   3. Look up Delegate by delegateId (single DB read)
 *   4. Compute Blake3-128 hash of token bytes → compare with delegate.currentAtHash
 *   5. Check AT expiration, delegate revoked/expired
 *   6. Build AccessTokenAuthContext
 */

import { AT_SIZE, decodeToken } from "@casfa/delegate-token";
import type { MiddlewareHandler } from "hono";
import type { DelegatesDb } from "../db/delegates.ts";
import type { AccessTokenAuthContext, Env } from "../types.ts";
import { bytesToDelegateId, computeTokenHash } from "../util/delegate-token-utils.ts";

// ============================================================================
// Types
// ============================================================================

export type AccessTokenMiddlewareDeps = {
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
  deps: AccessTokenMiddlewareDeps
): MiddlewareHandler<Env> => {
  const { delegatesDb } = deps;

  return async (c, next) => {
    // 1. Extract Authorization header
    const authHeader = c.req.header("Authorization");
    if (!authHeader) {
      return c.json({ error: "UNAUTHORIZED", message: "Missing Authorization header" }, 401);
    }

    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer") {
      return c.json({ error: "UNAUTHORIZED", message: "Invalid Authorization header format" }, 401);
    }

    const tokenBase64 = parts[1]!;

    // 2. Decode token bytes — must be 32 bytes (AT)
    let tokenBytes: Uint8Array;
    try {
      const buffer = Buffer.from(tokenBase64, "base64");
      if (buffer.length !== AT_SIZE) {
        return c.json(
          { error: "INVALID_TOKEN_FORMAT", message: `Access Token must be ${AT_SIZE} bytes` },
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
    } catch {
      return c.json({ error: "INVALID_TOKEN_FORMAT", message: "Invalid token format" }, 401);
    }

    if (decoded.type !== "access") {
      return c.json(
        { error: "ACCESS_TOKEN_REQUIRED", message: "This endpoint requires an Access Token" },
        403
      );
    }

    // Convert raw delegateId bytes → dlt_CB32 string
    const delegateId = bytesToDelegateId(decoded.delegateId);

    // 4. Look up Delegate — single DB read
    const delegate = await delegatesDb.get(delegateId);

    if (!delegate) {
      return c.json({ error: "DELEGATE_NOT_FOUND", message: "Associated delegate not found" }, 401);
    }

    // 5. Check delegate revoked
    if (delegate.isRevoked) {
      return c.json({ error: "DELEGATE_REVOKED", message: "The delegate has been revoked" }, 401);
    }

    // Check delegate expired
    if (delegate.expiresAt && delegate.expiresAt < Date.now()) {
      return c.json({ error: "DELEGATE_EXPIRED", message: "The delegate has expired" }, 401);
    }

    // 6. Verify AT hash matches
    const atHash = computeTokenHash(tokenBytes);
    if (atHash !== delegate.currentAtHash) {
      return c.json({ error: "TOKEN_INVALID", message: "Access token is no longer valid" }, 401);
    }

    // 7. Check AT expiration (from delegate's stored atExpiresAt)
    if (delegate.atExpiresAt < Date.now()) {
      return c.json({ error: "TOKEN_EXPIRED", message: "Access token has expired" }, 401);
    }

    // 8. Build auth context from Delegate
    const auth: AccessTokenAuthContext = {
      type: "access",
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
