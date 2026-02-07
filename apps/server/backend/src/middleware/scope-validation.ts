/**
 * Scope Validation Middleware
 *
 * Validates that requested nodes are within the token's scope.
 * Requires X-CAS-Index-Path header for node access.
 *
 * Based on docs/delegate-token-refactor/impl/03-middleware-refactor.md
 */

import type { MiddlewareHandler } from "hono";
import type { ScopeSetNodesDb } from "../db/scope-set-nodes.ts";
import type { AccessTokenAuthContext, Env } from "../types.ts";
import { verifyIndexPath } from "../util/scope.ts";

// ============================================================================
// Types
// ============================================================================

export type ScopeValidationMiddlewareDeps = {
  scopeSetNodesDb: ScopeSetNodesDb;
  /** Function to get node data by hash */
  getNode: (realm: string, hash: string) => Promise<Uint8Array | null>;
};

// ============================================================================
// Middleware Factory
// ============================================================================

/**
 * Create scope validation middleware
 *
 * This middleware verifies that the requested node is within the token's scope.
 * Must be used after accessTokenMiddleware.
 */
export const createScopeValidationMiddleware = (
  deps: ScopeValidationMiddlewareDeps
): MiddlewareHandler<Env> => {
  const { scopeSetNodesDb, getNode } = deps;

  return async (c, next) => {
    const auth = c.get("auth") as AccessTokenAuthContext;
    if (!auth || auth.type !== "access") {
      return c.json({ error: "ACCESS_TOKEN_REQUIRED", message: "Access token required" }, 403);
    }

    // Get the requested node key from path parameter
    const nodeKey = c.req.param("key");
    if (!nodeKey) {
      return c.json({ error: "INVALID_REQUEST", message: "Missing node key" }, 400);
    }

    // Get Index Path header
    const indexPath = c.req.header("X-CAS-Index-Path");
    if (!indexPath) {
      return c.json(
        {
          error: "INDEX_PATH_REQUIRED",
          message: "X-CAS-Index-Path header is required for node access",
        },
        400
      );
    }

    // Get token's scope roots
    let scopeRoots: string[];
    const tokenRecord = auth.tokenRecord;

    if (tokenRecord.scopeNodeHash) {
      // Single scope
      scopeRoots = [tokenRecord.scopeNodeHash];
    } else if (tokenRecord.scopeSetNodeId) {
      // Multi scope or empty set
      const setNode = await scopeSetNodesDb.get(tokenRecord.scopeSetNodeId);
      if (!setNode) {
        return c.json({ error: "INTERNAL_ERROR", message: "Scope set node not found" }, 500);
      }
      scopeRoots = setNode.children;
    } else {
      // Should not happen - tokens must have scope
      return c.json({ error: "INTERNAL_ERROR", message: "Token has no scope" }, 500);
    }

    // Empty scope means no access
    if (scopeRoots.length === 0) {
      return c.json(
        {
          error: "NODE_NOT_IN_SCOPE",
          message: "Token has empty scope - no node access allowed",
        },
        403
      );
    }

    // Get realm from path parameter
    const realmId = c.req.param("realmId");
    if (!realmId) {
      return c.json({ error: "INVALID_REQUEST", message: "Missing realmId" }, 400);
    }

    // Create node getter bound to realm
    const getNodeInRealm = async (hash: string) => getNode(realmId, hash);

    // Verify index path
    const verification = await verifyIndexPath(nodeKey, indexPath, scopeRoots, getNodeInRealm);

    if (!verification.valid) {
      // Return 400 for format errors, 403 for scope violations
      const isFormatError =
        verification.reason?.includes("Invalid index path format") ||
        verification.reason?.includes("Empty index path");
      const statusCode = isFormatError ? 400 : 403;
      const errorCode = isFormatError ? "INVALID_INDEX_PATH" : "NODE_NOT_IN_SCOPE";
      const errorMessage = isFormatError
        ? "Invalid X-CAS-Index-Path header format"
        : "The requested node is not within the authorized scope";

      return c.json(
        {
          error: errorCode,
          message: errorMessage,
          details: {
            nodeKey,
            indexPath,
            reason: verification.reason,
          },
        },
        statusCode
      );
    }

    // Store verification result for later use
    c.set("scopeVerification", verification);

    return next();
  };
};
