/**
 * Delegate Token Authentication Middleware
 *
 * Validates Delegate Tokens (re-authorization tokens).
 * Used for token delegation (POST /api/tokens/delegate).
 *
 * Delegate Tokens cannot directly access data or create Tickets.
 * They can only be used to issue child tokens.
 *
 * Based on docs/delegate-token-refactor/impl/03-middleware-refactor.md
 */

import type { MiddlewareHandler } from "hono";
import type { DelegateTokensDb } from "../db/delegate-tokens.ts";
import type { DelegateTokenAuthContext, Env } from "../types.ts";
import { validateToken } from "./token-auth-common.ts";

// ============================================================================
// Types
// ============================================================================

export type DelegateTokenMiddlewareDeps = {
  delegateTokensDb: DelegateTokensDb;
};

// ============================================================================
// Middleware Factory
// ============================================================================

/**
 * Create Delegate Token authentication middleware
 *
 * This middleware requires a Delegate Token (not Access Token).
 */
export const createDelegateTokenMiddleware = (
  deps: DelegateTokenMiddlewareDeps
): MiddlewareHandler<Env> => {
  const { delegateTokensDb } = deps;

  return async (c, next) => {
    // Use common validation logic
    const result = await validateToken(c, delegateTokensDb);

    if (!result.success) {
      return c.json({ error: result.error, message: result.message }, result.status);
    }

    const { tokenId, tokenBytes, tokenRecord, decoded } = result;

    // Check token type - must be delegate
    if (tokenRecord.tokenType !== "delegate") {
      return c.json(
        {
          error: "DELEGATE_TOKEN_REQUIRED",
          message: "This endpoint requires a Delegate Token, not Access Token",
        },
        403
      );
    }

    const auth: DelegateTokenAuthContext = {
      type: "delegate",
      tokenId,
      tokenBytes,
      tokenRecord,
      realm: tokenRecord.realm,
      canUpload: tokenRecord.canUpload,
      canManageDepot: tokenRecord.canManageDepot,
      depth: tokenRecord.depth,
      issuerChain: tokenRecord.issuerChain,
    };

    c.set("auth", auth);
    return next();
  };
};
