/**
 * Access Token Authentication Middleware
 *
 * Validates Access Tokens (data access tokens).
 * Used for all Realm data operations.
 *
 * Access Tokens can read/write data but cannot re-delegate.
 *
 * Based on docs/delegate-token-refactor/impl/03-middleware-refactor.md
 */

import type { MiddlewareHandler } from "hono";
import type { DelegateTokensDb } from "../db/delegate-tokens.ts";
import type { AccessTokenAuthContext, Env } from "../types.ts";
import { validateToken } from "./token-auth-common.ts";

// ============================================================================
// Types
// ============================================================================

export type AccessTokenMiddlewareDeps = {
  delegateTokensDb: DelegateTokensDb;
};

// ============================================================================
// Middleware Factory
// ============================================================================

/**
 * Create Access Token authentication middleware
 *
 * This middleware requires an Access Token (not Delegate Token).
 */
export const createAccessTokenMiddleware = (
  deps: AccessTokenMiddlewareDeps
): MiddlewareHandler<Env> => {
  const { delegateTokensDb } = deps;

  return async (c, next) => {
    // Use common validation logic
    const result = await validateToken(c, delegateTokensDb);

    if (!result.success) {
      return c.json({ error: result.error, message: result.message }, result.status);
    }

    const { tokenId, tokenBytes, tokenRecord, decoded } = result;

    // Check token type - must be access
    if (tokenRecord.tokenType !== "access") {
      return c.json(
        {
          error: "ACCESS_TOKEN_REQUIRED",
          message: "This endpoint requires an Access Token, not Delegate Token",
        },
        403
      );
    }

    const auth: AccessTokenAuthContext = {
      type: "access",
      tokenId,
      tokenBytes,
      tokenRecord,
      realm: tokenRecord.realm,
      canUpload: tokenRecord.canUpload,
      canManageDepot: tokenRecord.canManageDepot,
      issuerChain: tokenRecord.issuerChain,
    };

    c.set("auth", auth);
    return next();
  };
};
