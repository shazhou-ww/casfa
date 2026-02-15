/**
 * Node Authorization Middleware (Direct Authorization Check)
 *
 * Replaces the X-CAS-Proof based proof-validation middleware with a simpler
 * Direct Authorization Check:
 *
 *   1. Root delegate (depth=0) → pass (unrestricted access)
 *   2. hasOwnership(nodeId, delegateId) → pass
 *   3. nodeId ∈ delegate.scopeRoots → pass
 *   4. Otherwise → 403
 *
 * No proof headers, no DAG walk for authorization — just O(1) checks.
 * Must be used after accessTokenMiddleware sets `auth` on context.
 *
 * See docs/proof-inline-migration/README.md §4
 */

import { isWellKnownNode } from "@casfa/core";
import { nodeKeyToStorageKey } from "@casfa/protocol";
import type { MiddlewareHandler } from "hono";
import type { AccessTokenAuthContext, Env } from "../types.ts";

// ============================================================================
// Types
// ============================================================================

export type NodeAuthMiddlewareDeps = {
  /**
   * Check O(1) ownership: does this delegate own this node?
   * (Full-chain ownership from ownership-v2)
   */
  hasOwnership: (nodeHash: string, delegateId: string) => Promise<boolean>;
};

// ============================================================================
// Middleware Factory
// ============================================================================

/**
 * Create node authorization middleware with Direct Authorization Check.
 *
 * Reads the `:key` route parameter and validates access via:
 *   1. Well-known nodes → always pass
 *   2. Root delegate (depth=0) → pass
 *   3. Ownership check → pass
 *   4. Scope root check → pass
 *   5. Otherwise → 403 NODE_NOT_AUTHORIZED
 *
 * Stores `authorizedNodeKey` in context for downstream handlers.
 */
export function createNodeAuthMiddleware(deps: NodeAuthMiddlewareDeps): MiddlewareHandler<Env> {
  return async (c, next) => {
    const auth = c.get("auth") as AccessTokenAuthContext;
    if (!auth || auth.type !== "access") {
      return c.json({ error: "ACCESS_TOKEN_REQUIRED", message: "Access token required" }, 403);
    }

    const nodeKey = c.req.param("key");
    if (!nodeKey) {
      return c.json({ error: "INVALID_REQUEST", message: "Missing node key" }, 400);
    }

    const storageKey = nodeKeyToStorageKey(nodeKey);

    // 1. Well-known nodes — always accessible
    if (isWellKnownNode(storageKey)) {
      c.set("authorizedNodeKey", nodeKey);
      return next();
    }

    // 2. Root delegate — unrestricted access
    if (auth.delegate.depth === 0) {
      c.set("authorizedNodeKey", nodeKey);
      return next();
    }

    // 3. Ownership check — O(1) DB lookup
    const delegateChain = auth.issuerChain;
    for (const id of delegateChain) {
      if (await deps.hasOwnership(storageKey, id)) {
        c.set("authorizedNodeKey", nodeKey);
        return next();
      }
    }

    // 4. Scope root check — nodeKey is one of the delegate's scope roots
    const delegate = auth.delegate;
    if (delegate.scopeNodeHash) {
      // Single scope: compare directly
      if (storageKey === delegate.scopeNodeHash) {
        c.set("authorizedNodeKey", nodeKey);
        return next();
      }
    }
    // Multi scope via scopeSetNodeId is resolved in accessTokenMiddleware
    // and stored as scopeRoots on the auth context (if available).
    // For now, scopeNodeHash covers the common case.

    // 5. Not authorized
    return c.json(
      {
        error: "NODE_NOT_AUTHORIZED",
        message: `Not authorized to access node ${nodeKey}`,
      },
      403
    );
  };
}
