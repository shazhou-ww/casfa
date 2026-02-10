/**
 * Proof Validation Middleware (X-CAS-Proof)
 *
 * Replaces scope-validation.ts (X-CAS-Index-Path) with the new proof system.
 *
 * Verification flow per §5.4:
 *   1. Ownership check — O(1) GetItem via ownership-v2
 *   2. Root delegate — skip proof entirely
 *   3. Proof walk — parse X-CAS-Proof header, walk CAS DAG, compare
 *
 * Must be used after accessTokenMiddleware sets `auth` on context.
 *
 * See ownership-and-permissions.md §5.2–5.5
 */

import type { ProofMap, ProofResult, ProofVerificationContext } from "@casfa/proof";
import { parseProofHeader, verifyMultiNodeAccess, verifyNodeAccess } from "@casfa/proof";
import type { MiddlewareHandler } from "hono";
import type { AccessTokenAuthContext, Env } from "../types.ts";

// ============================================================================
// Types
// ============================================================================

export type ProofValidationMiddlewareDeps = {
  /**
   * Check O(1) ownership: does this delegate own this node?
   * (Full-chain ownership from ownership-v2)
   */
  hasOwnership: (nodeHash: string, delegateId: string) => Promise<boolean>;

  /**
   * Is this delegate ID a root delegate (no scope restriction)?
   * Root delegates are determined server-side from DB record (depth=0, parentId=null).
   */
  isRootDelegate: (delegateId: string) => Promise<boolean>;

  /**
   * Resolve scope roots for a delegate.
   * - Single scope → [scopeNodeHash]
   * - Multi scope → children from ScopeSetNode
   * - Root delegate → [] (root skips proof entirely)
   */
  getScopeRoots: (delegateId: string) => Promise<readonly string[]>;

  /**
   * Resolve a CAS node hash to its parsed children (hex strings).
   * Uses decodeNode from @casfa/core.
   */
  resolveNode: (realm: string, hash: string) => Promise<{ children: readonly string[] } | null>;

  /**
   * Resolve a depot version to its root node hash.
   */
  resolveDepotVersion: (realm: string, depotId: string, version: string) => Promise<string | null>;

  /**
   * Check if a delegate has management access to a depot.
   */
  hasDepotAccess: (delegateId: string, depotId: string) => Promise<boolean>;
};

// ============================================================================
// Result stored in context
// ============================================================================

/**
 * Proof verification result stored in Hono context after middleware runs.
 */
export type ProofVerificationState = {
  /** The parsed proof map (for use by downstream handlers) */
  proofMap: ProofMap;
  /** The delegateId used for verification */
  delegateId: string;
};

// ============================================================================
// Single-node middleware (for GET /nodes/:key)
// ============================================================================

/**
 * Create proof validation middleware for single-node access.
 *
 * Reads the `:key` route parameter as the target node hash and validates
 * access via ownership, root delegate, or X-CAS-Proof header.
 */
export function createProofValidationMiddleware(
  deps: ProofValidationMiddlewareDeps
): MiddlewareHandler<Env> {
  return async (c, next) => {
    const auth = c.get("auth") as AccessTokenAuthContext;
    if (!auth || auth.type !== "access") {
      return c.json({ error: "ACCESS_TOKEN_REQUIRED", message: "Access token required" }, 403);
    }

    const nodeKey = c.req.param("key");
    if (!nodeKey) {
      return c.json({ error: "INVALID_REQUEST", message: "Missing node key" }, 400);
    }

    const realmId = c.req.param("realmId");
    if (!realmId) {
      return c.json({ error: "INVALID_REQUEST", message: "Missing realmId" }, 400);
    }

    // Parse X-CAS-Proof header
    const rawProof = c.req.header("X-CAS-Proof");
    const proofMap = parseProofHeader(rawProof);
    if (proofMap === null) {
      return c.json(
        {
          error: "INVALID_PROOF_FORMAT",
          message: "X-CAS-Proof header contains invalid JSON or malformed proof words",
        },
        400
      );
    }

    // Build verification context bound to this realm
    const ctx = buildContext(deps, realmId, auth);

    // Derive delegate ID from the auth context
    const delegateId = deriveDelegateId(auth);

    const result = await verifyNodeAccess(nodeKey, delegateId, proofMap, ctx);

    if (!result.ok) {
      return toErrorResponse(c, result);
    }

    // Store for downstream handlers
    c.set("proofVerification", {
      proofMap,
      delegateId,
    } satisfies ProofVerificationState);

    return next();
  };
}

// ============================================================================
// Multi-node middleware (for PUT /nodes/:key — verifying children)
// ============================================================================

/**
 * Create proof validation middleware for multi-node access.
 *
 * The caller extracts the node hashes to verify and passes them via a
 * getter function. This supports verifying children in PUT /nodes/:key.
 *
 * @param deps  - I/O dependencies
 * @param getNodeHashes - Extracts the node hashes to verify from the request
 */
export function createMultiNodeProofMiddleware(
  deps: ProofValidationMiddlewareDeps,
  getNodeHashes: (c: Parameters<MiddlewareHandler<Env>>[0]) => string[] | null
): MiddlewareHandler<Env> {
  return async (c, next) => {
    const auth = c.get("auth") as AccessTokenAuthContext;
    if (!auth || auth.type !== "access") {
      return c.json({ error: "ACCESS_TOKEN_REQUIRED", message: "Access token required" }, 403);
    }

    const realmId = c.req.param("realmId");
    if (!realmId) {
      return c.json({ error: "INVALID_REQUEST", message: "Missing realmId" }, 400);
    }

    const nodeHashes = getNodeHashes(c);
    if (!nodeHashes) {
      // getNodeHashes returns null when there are no children to verify
      return next();
    }

    // Parse X-CAS-Proof header
    const rawProof = c.req.header("X-CAS-Proof");
    const proofMap = parseProofHeader(rawProof);
    if (proofMap === null) {
      return c.json(
        {
          error: "INVALID_PROOF_FORMAT",
          message: "X-CAS-Proof header contains invalid JSON or malformed proof words",
        },
        400
      );
    }

    const ctx = buildContext(deps, realmId, auth);
    const delegateId = deriveDelegateId(auth);

    const result = await verifyMultiNodeAccess(nodeHashes, delegateId, proofMap, ctx);

    if (!result.ok) {
      return toErrorResponse(c, result);
    }

    c.set("proofVerification", {
      proofMap,
      delegateId,
    } satisfies ProofVerificationState);

    return next();
  };
}

// ============================================================================
// Internals
// ============================================================================

/**
 * Build a ProofVerificationContext bound to a specific realm.
 */
function buildContext(
  deps: ProofValidationMiddlewareDeps,
  realm: string,
  auth: AccessTokenAuthContext
): ProofVerificationContext {
  return {
    hasOwnership: deps.hasOwnership,
    isRootDelegate: async (delegateId: string) => {
      // Fast-path: if this is the authenticated delegate, check depth directly
      if (delegateId === auth.delegateId) {
        return auth.delegate.depth === 0;
      }
      // Otherwise, delegate to the provider
      return deps.isRootDelegate(delegateId);
    },
    getScopeRoots: async (delegateId: string) => {
      // Fast-path: if scope info is on the auth record itself
      const d = auth.delegate;
      if (d.scopeNodeHash) return [d.scopeNodeHash];
      // Otherwise, delegate to the provider
      return deps.getScopeRoots(delegateId);
    },
    resolveNode: (hash: string) => deps.resolveNode(realm, hash),
    resolveDepotVersion: (depotId: string, version: string) =>
      deps.resolveDepotVersion(realm, depotId, version),
    hasDepotAccess: deps.hasDepotAccess,
  };
}

/**
 * Derive a stable delegate identifier from the auth context.
 */
function deriveDelegateId(auth: AccessTokenAuthContext): string {
  return auth.delegateId;
}

/**
 * Map ProofResult failure to an HTTP error response.
 */
function toErrorResponse(c: Parameters<MiddlewareHandler<Env>>[0], result: ProofResult) {
  if (result.ok) throw new Error("toErrorResponse called with ok result");

  const r = result;
  switch (r.code) {
    case "MISSING_PROOF":
      return c.json(
        {
          error: "PROOF_REQUIRED",
          message: r.message,
        },
        403
      );
    case "INVALID_PROOF_FORMAT":
    case "INVALID_PROOF_WORD":
      return c.json(
        {
          error: "INVALID_PROOF",
          message: r.message,
        },
        400
      );
    case "SCOPE_ROOT_OUT_OF_BOUNDS":
    case "CHILD_INDEX_OUT_OF_BOUNDS":
    case "PATH_MISMATCH":
      return c.json(
        {
          error: "NODE_NOT_IN_SCOPE",
          message: r.message,
        },
        403
      );
    case "NODE_NOT_FOUND":
      return c.json(
        {
          error: "NODE_NOT_FOUND",
          message: r.message,
        },
        404
      );
    case "DEPOT_ACCESS_DENIED":
      return c.json(
        {
          error: "DEPOT_ACCESS_DENIED",
          message: r.message,
        },
        403
      );
    case "DEPOT_VERSION_NOT_FOUND":
      return c.json(
        {
          error: "DEPOT_VERSION_NOT_FOUND",
          message: r.message,
        },
        404
      );
    default:
      return c.json(
        {
          error: "PROOF_VERIFICATION_FAILED",
          message: r.message,
        },
        403
      );
  }
}
