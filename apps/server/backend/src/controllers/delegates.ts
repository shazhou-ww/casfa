/**
 * Delegates Controller (token-simplification v3)
 *
 * Handles Delegate entity CRUD operations:
 * - POST /api/realm/{realmId}/delegates — create child delegate + RT + AT
 * - GET /api/realm/{realmId}/delegates — list children
 * - GET /api/realm/{realmId}/delegates/:delegateId — get detail
 * - POST /api/realm/{realmId}/delegates/:delegateId/revoke — revoke
 *
 * Token hashes stored directly on Delegate entity (no TokenRecord table).
 *
 * The create handler delegates to the shared createChildDelegate service
 * (services/delegate-creation.ts) for business logic reuse with MCP.
 */

import { storageKeyToNodeKey } from "@casfa/protocol";
import type { Context } from "hono";
import type { DelegatesDb } from "../db/delegates.ts";
import type { DepotsDb } from "../db/depots.ts";
import type { ScopeSetNodesDb } from "../db/scope-set-nodes.ts";
import { createChildDelegate } from "../services/delegate-creation.ts";
import type { AccessTokenAuthContext, Env } from "../types.ts";

// ============================================================================
// Types
// ============================================================================

export type DelegatesControllerDeps = {
  delegatesDb: DelegatesDb;
  scopeSetNodesDb: ScopeSetNodesDb;
  depotsDb: DepotsDb;
  /** Function to get node data by hash */
  getNode: (realm: string, hash: string) => Promise<Uint8Array | null>;
};

export type DelegatesController = {
  create: (c: Context<Env>) => Promise<Response>;
  list: (c: Context<Env>) => Promise<Response>;
  get: (c: Context<Env>) => Promise<Response>;
  revoke: (c: Context<Env>) => Promise<Response>;
};

// ============================================================================
// Controller Factory
// ============================================================================

export const createDelegatesController = (deps: DelegatesControllerDeps): DelegatesController => {
  const { delegatesDb, scopeSetNodesDb, getNode } = deps;

  /**
   * POST /api/realm/{realmId}/delegates
   *
   * Create a child delegate under the current delegate.
   * Requires Access Token auth — the caller's delegate becomes the parent.
   */
  const create = async (c: Context<Env>): Promise<Response> => {
    const auth = c.get("auth") as AccessTokenAuthContext;
    const body = await c.req.json();
    const realmId = c.req.param("realmId");

    // Verify realm matches token
    if (auth.realm !== realmId) {
      return c.json(
        { error: "REALM_MISMATCH", message: "Token realm does not match request realm" },
        403
      );
    }

    // Resolve the parent delegate from the token's issuer chain
    const parentDelegateId = resolveParentDelegateId(auth);
    if (!parentDelegateId) {
      return c.json(
        { error: "INVALID_TOKEN", message: "Cannot determine parent delegate from token" },
        400
      );
    }

    const parentDelegate = await delegatesDb.get(parentDelegateId);
    if (!parentDelegate) {
      return c.json({ error: "DELEGATE_NOT_FOUND", message: "Parent delegate not found" }, 404);
    }

    // Delegate to shared service
    const result = await createChildDelegate(
      { delegatesDb, scopeSetNodesDb, getNode },
      parentDelegate,
      realmId,
      {
        name: body.name,
        canUpload: body.canUpload,
        canManageDepot: body.canManageDepot,
        scope: body.scope,
        expiresIn: body.expiresIn,
        delegatedDepots: body.delegatedDepots,
        tokenTtlSeconds: body.tokenTtlSeconds,
      }
    );

    if (!result.ok) {
      return c.json({ error: result.error, message: result.message }, result.status as 400);
    }

    return c.json(
      {
        delegate: result.delegate,
        refreshToken: result.refreshToken,
        accessToken: result.accessToken,
        accessTokenExpiresAt: result.accessTokenExpiresAt,
      },
      201
    );
  };

  /**
   * GET /api/realm/{realmId}/delegates
   *
   * List direct children of the caller's delegate.
   */
  const list = async (c: Context<Env>): Promise<Response> => {
    const auth = c.get("auth") as AccessTokenAuthContext;
    const realmId = c.req.param("realmId");

    if (auth.realm !== realmId) {
      return c.json(
        { error: "REALM_MISMATCH", message: "Token realm does not match request realm" },
        403
      );
    }

    const parentDelegateId = resolveParentDelegateId(auth);
    if (!parentDelegateId) {
      return c.json(
        { error: "INVALID_TOKEN", message: "Cannot determine delegate from token" },
        400
      );
    }

    const limit = parseInt(c.req.query("limit") ?? "20", 10);
    const cursor = c.req.query("cursor");

    const result = await delegatesDb.listChildren(parentDelegateId, {
      limit,
      cursor: cursor ?? undefined,
    });

    const includeRevoked = c.req.query("includeRevoked") === "true";
    const filtered = includeRevoked
      ? result.delegates
      : result.delegates.filter((d) => !d.isRevoked);

    return c.json({
      delegates: filtered.map((d) => ({
        delegateId: d.delegateId,
        name: d.name,
        depth: d.depth,
        canUpload: d.canUpload,
        canManageDepot: d.canManageDepot,
        isRevoked: d.isRevoked,
        createdAt: d.createdAt,
        expiresAt: d.expiresAt,
      })),
      nextCursor: result.nextCursor,
    });
  };

  /**
   * GET /api/realm/{realmId}/delegates/:delegateId
   */
  const get = async (c: Context<Env>): Promise<Response> => {
    const auth = c.get("auth") as AccessTokenAuthContext;
    const realmId = c.req.param("realmId");
    const delegateId = c.req.param("delegateId");

    if (auth.realm !== realmId) {
      return c.json(
        { error: "REALM_MISMATCH", message: "Token realm does not match request realm" },
        403
      );
    }

    const delegate = await delegatesDb.get(delegateId);
    if (!delegate) {
      return c.json({ error: "DELEGATE_NOT_FOUND", message: "Delegate not found" }, 404);
    }

    // Verify the caller is an ancestor of this delegate
    const callerDelegateId = resolveParentDelegateId(auth);
    if (callerDelegateId && !delegate.chain.includes(callerDelegateId)) {
      return c.json({ error: "DELEGATE_NOT_FOUND", message: "Delegate not found" }, 404);
    }

    return c.json({
      delegateId: delegate.delegateId,
      name: delegate.name,
      realm: delegate.realm,
      parentId: delegate.parentId,
      chain: delegate.chain,
      depth: delegate.depth,
      canUpload: delegate.canUpload,
      canManageDepot: delegate.canManageDepot,
      delegatedDepots: delegate.delegatedDepots,
      scopeNodeHash: delegate.scopeNodeHash
        ? storageKeyToNodeKey(delegate.scopeNodeHash)
        : undefined,
      scopeSetNodeId: delegate.scopeSetNodeId,
      expiresAt: delegate.expiresAt,
      isRevoked: delegate.isRevoked,
      revokedAt: delegate.revokedAt,
      revokedBy: delegate.revokedBy,
      createdAt: delegate.createdAt,
    });
  };

  /**
   * POST /api/realm/{realmId}/delegates/:delegateId/revoke
   */
  const revoke = async (c: Context<Env>): Promise<Response> => {
    const auth = c.get("auth") as AccessTokenAuthContext;
    const realmId = c.req.param("realmId");
    const delegateId = c.req.param("delegateId");

    if (auth.realm !== realmId) {
      return c.json(
        { error: "REALM_MISMATCH", message: "Token realm does not match request realm" },
        403
      );
    }

    const delegate = await delegatesDb.get(delegateId);
    if (!delegate) {
      return c.json({ error: "DELEGATE_NOT_FOUND", message: "Delegate not found" }, 404);
    }

    // Verify the caller is an ancestor of this delegate
    const callerDelegateId = resolveParentDelegateId(auth);
    if (callerDelegateId && !delegate.chain.includes(callerDelegateId)) {
      return c.json({ error: "DELEGATE_NOT_FOUND", message: "Delegate not found" }, 404);
    }

    if (delegate.isRevoked) {
      return c.json(
        { error: "DELEGATE_ALREADY_REVOKED", message: "Delegate already revoked" },
        409
      );
    }

    const revokedBy = callerDelegateId ?? auth.delegateId;
    const success = await delegatesDb.revoke(delegateId, revokedBy);

    if (!success) {
      return c.json(
        { error: "DELEGATE_ALREADY_REVOKED", message: "Delegate already revoked" },
        409
      );
    }

    // Also revoke all children recursively
    await revokeDescendants(realmId, delegateId, revokedBy);

    return c.json({
      delegateId,
      revokedAt: Date.now(),
    });
  };

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  /**
   * Recursively revoke all descendants of a delegate
   */
  async function revokeDescendants(
    _realm: string,
    parentId: string,
    revokedBy: string
  ): Promise<void> {
    const result = await delegatesDb.listChildren(parentId);
    for (const child of result.delegates) {
      if (!child.isRevoked) {
        await delegatesDb.revoke(child.delegateId, revokedBy);
        await revokeDescendants(_realm, child.delegateId, revokedBy);
      }
    }
  }

  /**
   * Resolve the parent delegate ID from AccessTokenAuthContext.
   *
   * In the new Delegate model, the auth context carries `delegateId` directly.
   */
  function resolveParentDelegateId(auth: AccessTokenAuthContext): string | undefined {
    return auth.delegateId;
  }

  return { create, list, get, revoke };
};
