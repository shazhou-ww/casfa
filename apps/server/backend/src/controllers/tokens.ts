/**
 * Tokens Controller
 *
 * Handles Delegate Token management: create, list, get, revoke, and delegate.
 * Based on docs/delegate-token-refactor/impl/04-controller-refactor.md
 */

import type { Context } from "hono";
import type { DelegateTokensDb } from "../db/delegate-tokens.ts";
import type { DepotsDb } from "../db/depots.ts";
import type { ScopeSetNodesDb } from "../db/scope-set-nodes.ts";
import type { TokenAuditDb } from "../db/token-audit.ts";
import type { DelegateTokenAuthContext, Env, JwtAuthContext } from "../types.ts";
import { blake3Hash } from "../util/hashing.ts";
import { parseCasUri, resolveRelativeScope } from "../util/scope.ts";
import {
  computeRealmHash,
  computeScopeHash,
  computeTokenId,
  computeTokenIdHash,
  computeUserIdHash,
  generateToken,
} from "../util/token.ts";

// ============================================================================
// Types
// ============================================================================

export type TokensControllerDeps = {
  delegateTokensDb: DelegateTokensDb;
  scopeSetNodesDb: ScopeSetNodesDb;
  tokenAuditDb: TokenAuditDb;
  depotsDb: DepotsDb;
  /** Function to get node data by hash */
  getNode: (realm: string, hash: string) => Promise<Uint8Array | null>;
};

export type TokensController = {
  create: (c: Context<Env>) => Promise<Response>;
  list: (c: Context<Env>) => Promise<Response>;
  get: (c: Context<Env>) => Promise<Response>;
  revoke: (c: Context<Env>) => Promise<Response>;
  delegate: (c: Context<Env>) => Promise<Response>;
};

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_TOKEN_TTL_SECONDS = 30 * 24 * 3600; // 30 days
const MAX_DEPTH = 15;

// ============================================================================
// Controller Factory
// ============================================================================

export const createTokensController = (deps: TokensControllerDeps): TokensController => {
  const { delegateTokensDb, scopeSetNodesDb, tokenAuditDb, depotsDb, getNode } = deps;

  /**
   * Resolve scope from CAS URIs (for user-issued tokens)
   */
  async function resolveScopeFromUris(
    scope: string[],
    realm: string
  ): Promise<
    | { success: true; scopeNodeHash?: string; scopeSetNodeId?: string; scopeHash: Uint8Array }
    | { success: false; error: string }
  > {
    const resolvedHashes: string[] = [];

    for (const uri of scope) {
      const parsed = parseCasUri(uri);
      if (!parsed) {
        return { success: false, error: `Invalid CAS URI: ${uri}` };
      }

      if (parsed.type === "depot") {
        if (parsed.depotId === "*") {
          // Wildcard: include all depot roots in this realm
          const result = await depotsDb.list(realm);
          for (const depot of result.depots) {
            resolvedHashes.push(depot.root);
          }
        } else {
          const depot = await depotsDb.get(realm, parsed.depotId);
          if (!depot) {
            return { success: false, error: `Depot not found: ${parsed.depotId}` };
          }
          resolvedHashes.push(depot.root);
        }
      } else {
        resolvedHashes.push(parsed.hash);
      }
    }

    // Deduplicate and sort
    const uniqueHashes = [...new Set(resolvedHashes)].sort();
    const scopeHash = computeScopeHash(uniqueHashes);

    if (uniqueHashes.length === 1) {
      return { success: true, scopeNodeHash: uniqueHashes[0], scopeHash };
    }

    // Create or get scope set node
    const setNodeId = Buffer.from(blake3Hash(uniqueHashes.join(",")).slice(0, 16)).toString("hex");
    await scopeSetNodesDb.createOrIncrement(setNodeId, uniqueHashes);

    return { success: true, scopeSetNodeId: setNodeId, scopeHash };
  }

  /**
   * POST /api/tokens
   * User creates a new Delegate Token
   */
  const create = async (c: Context<Env>): Promise<Response> => {
    const auth = c.get("auth") as JwtAuthContext;
    const body = await c.req.json();

    // Validate realm - user can only create tokens for their own realm
    const expectedRealm = `usr_${auth.userId}`;
    if (body.realm !== expectedRealm) {
      return c.json(
        { error: "INVALID_REALM", message: "Cannot create token for another user's realm" },
        400
      );
    }

    // Resolve scope from CAS URIs
    const scopeResult = await resolveScopeFromUris(body.scope, body.realm);
    if (!scopeResult.success) {
      return c.json({ error: "INVALID_SCOPE", message: scopeResult.error }, 400);
    }

    // Calculate expiration
    const expiresIn = body.expiresIn ?? DEFAULT_TOKEN_TTL_SECONDS;
    const expiresAt = Date.now() + expiresIn * 1000;

    // Generate token bytes
    const tokenBytes = generateToken({
      type: body.type,
      isUserIssued: true,
      canUpload: body.canUpload ?? false,
      canManageDepot: body.canManageDepot ?? false,
      depth: 0,
      expiresAt,
      quota: 0,
      issuerHash: computeUserIdHash(auth.userId),
      realmHash: computeRealmHash(body.realm),
      scopeHash: scopeResult.scopeHash,
    });

    const tokenId = computeTokenId(tokenBytes);

    // Create database record
    await delegateTokensDb.create({
      tokenId,
      tokenType: body.type,
      realm: body.realm,
      expiresAt,
      depth: 0,
      name: body.name,
      issuerId: auth.userId,
      issuerType: "user",
      issuerChain: [auth.userId],
      canUpload: body.canUpload ?? false,
      canManageDepot: body.canManageDepot ?? false,
      isUserIssued: true,
      scopeNodeHash: scopeResult.scopeNodeHash,
      scopeSetNodeId: scopeResult.scopeSetNodeId,
    });

    // Log audit
    await tokenAuditDb.log({
      tokenId,
      action: "create",
      actorId: auth.userId,
      actorType: "user",
    });

    return c.json(
      {
        tokenId,
        tokenBase64: Buffer.from(tokenBytes).toString("base64"),
        expiresAt,
      },
      201
    );
  };

  /**
   * GET /api/tokens
   * List user's tokens
   */
  const list = async (c: Context<Env>): Promise<Response> => {
    const auth = c.get("auth") as JwtAuthContext;
    const limit = parseInt(c.req.query("limit") ?? "20", 10);
    const cursor = c.req.query("cursor");
    const includeRevoked = c.req.query("includeRevoked") === "true";
    const typeFilter = c.req.query("type"); // "delegate" or "access"

    const realm = `usr_${auth.userId}`;
    const result = await delegateTokensDb.listByRealm(realm, { limit, cursor, includeRevoked });

    // Filter by token type if specified
    let filteredItems = result.items;
    if (typeFilter && (typeFilter === "delegate" || typeFilter === "access")) {
      filteredItems = result.items.filter((t) => t.tokenType === typeFilter);
    }

    return c.json({
      tokens: filteredItems.map((t) => ({
        tokenId: t.tokenId,
        name: t.name,
        realm: t.realm,
        tokenType: t.tokenType,
        expiresAt: t.expiresAt,
        createdAt: t.createdAt,
        isRevoked: t.isRevoked,
        depth: t.depth,
      })),
      nextCursor: result.nextCursor,
    });
  };

  /**
   * GET /api/tokens/:tokenId
   * Get token details
   */
  const get = async (c: Context<Env>): Promise<Response> => {
    const auth = c.get("auth") as JwtAuthContext;
    const tokenId = c.req.param("tokenId");

    const token = await delegateTokensDb.get(tokenId);
    if (!token) {
      return c.json({ error: "TOKEN_NOT_FOUND", message: "Token not found" }, 404);
    }

    // Verify user has permission to view this token
    const expectedRealm = `usr_${auth.userId}`;
    if (token.realm !== expectedRealm) {
      return c.json({ error: "TOKEN_NOT_FOUND", message: "Token not found" }, 404);
    }

    return c.json({
      tokenId: token.tokenId,
      name: token.name,
      realm: token.realm,
      tokenType: token.tokenType,
      expiresAt: token.expiresAt,
      createdAt: token.createdAt,
      isRevoked: token.isRevoked,
      depth: token.depth,
      canUpload: token.canUpload,
      canManageDepot: token.canManageDepot,
      issuerChain: token.issuerChain,
    });
  };

  /**
   * POST /api/tokens/:tokenId/revoke
   * Revoke token (cascade revokes all children)
   */
  const revoke = async (c: Context<Env>): Promise<Response> => {
    const auth = c.get("auth") as JwtAuthContext;
    const tokenId = c.req.param("tokenId");

    const token = await delegateTokensDb.get(tokenId);
    if (!token) {
      return c.json({ error: "TOKEN_NOT_FOUND", message: "Token not found" }, 404);
    }

    // Verify user has permission to revoke this token
    const expectedRealm = `usr_${auth.userId}`;
    if (token.realm !== expectedRealm) {
      return c.json({ error: "TOKEN_NOT_FOUND", message: "Token not found" }, 404);
    }

    if (token.isRevoked) {
      return c.json({ error: "TOKEN_ALREADY_REVOKED", message: "Token already revoked" }, 409);
    }

    // Cascade revoke
    const revokedCount = await delegateTokensDb.revokeWithCascade(tokenId, auth.userId);

    // Log audit
    await tokenAuditDb.log({
      tokenId,
      action: "revoke",
      actorId: auth.userId,
      actorType: "user",
      details: { reason: "user_revoked" },
    });

    return c.json({
      success: true,
      revokedCount,
    });
  };

  /**
   * POST /api/tokens/delegate
   * Delegate (re-issue) a token
   */
  const delegate = async (c: Context<Env>): Promise<Response> => {
    const auth = c.get("auth") as DelegateTokenAuthContext;
    const body = await c.req.json();

    // Verify depth limit
    if (auth.depth >= MAX_DEPTH) {
      return c.json(
        { error: "MAX_DEPTH_EXCEEDED", message: "Maximum delegation depth exceeded" },
        400
      );
    }

    // Verify permissions are not escalated
    if (body.canUpload && !auth.canUpload) {
      return c.json(
        { error: "PERMISSION_ESCALATION", message: "Cannot grant upload permission not held" },
        400
      );
    }
    if (body.canManageDepot && !auth.canManageDepot) {
      return c.json(
        {
          error: "PERMISSION_ESCALATION",
          message: "Cannot grant depot management permission not held",
        },
        400
      );
    }

    // Verify TTL does not exceed parent
    const parentRemainingTtl = auth.tokenRecord.expiresAt - Date.now();
    const requestedExpiresIn = body.expiresIn ?? Math.floor(parentRemainingTtl / 1000);
    if (requestedExpiresIn * 1000 > parentRemainingTtl) {
      return c.json(
        { error: "INVALID_TTL", message: "TTL exceeds parent token remaining time" },
        400
      );
    }

    // Resolve relative scope (must be subset of parent scope)
    const parentScopeRoots = await getParentScopeRoots(auth.tokenRecord);
    const getNodeInRealm = async (hash: string) => getNode(auth.realm, hash);
    const scopeResult = await resolveRelativeScope(body.scope, parentScopeRoots, getNodeInRealm);

    if (!scopeResult.valid) {
      return c.json({ error: "INVALID_SCOPE", message: scopeResult.error }, 400);
    }

    // Calculate scope hash and storage
    const resolvedRoots = scopeResult.resolvedRoots!;
    const scopeHash = computeScopeHash(resolvedRoots);
    let scopeNodeHash: string | undefined;
    let scopeSetNodeId: string | undefined;

    if (resolvedRoots.length === 1) {
      scopeNodeHash = resolvedRoots[0];
    } else {
      const setNodeId = Buffer.from(blake3Hash(resolvedRoots.join(",")).slice(0, 16)).toString(
        "hex"
      );
      await scopeSetNodesDb.createOrIncrement(setNodeId, resolvedRoots);
      scopeSetNodeId = setNodeId;
    }

    // Generate new token
    const expiresAt = Date.now() + requestedExpiresIn * 1000;
    const newDepth = auth.depth + 1;

    const tokenBytes = generateToken({
      type: body.type,
      isUserIssued: false,
      canUpload: body.canUpload ?? false,
      canManageDepot: body.canManageDepot ?? false,
      depth: newDepth,
      expiresAt,
      quota: 0,
      issuerHash: computeTokenIdHash(auth.tokenId),
      realmHash: computeRealmHash(auth.realm),
      scopeHash,
    });

    const tokenId = computeTokenId(tokenBytes);
    const newIssuerChain = [...auth.issuerChain, auth.tokenId];

    // Create database record
    await delegateTokensDb.create({
      tokenId,
      tokenType: body.type,
      realm: auth.realm,
      expiresAt,
      depth: newDepth,
      name: body.name,
      issuerId: auth.tokenId,
      issuerType: "token",
      parentTokenId: auth.tokenId,
      issuerChain: newIssuerChain,
      canUpload: body.canUpload ?? false,
      canManageDepot: body.canManageDepot ?? false,
      isUserIssued: false,
      scopeNodeHash,
      scopeSetNodeId,
    });

    // Log audit
    await tokenAuditDb.log({
      tokenId: auth.tokenId,
      action: "delegate",
      actorId: auth.tokenId,
      actorType: "token",
      details: { childTokenId: tokenId },
    });

    return c.json(
      {
        tokenId,
        tokenBase64: Buffer.from(tokenBytes).toString("base64"),
        expiresAt,
      },
      201
    );
  };

  /**
   * Helper to get parent token's scope roots
   */
  async function getParentScopeRoots(tokenRecord: {
    scopeNodeHash?: string;
    scopeSetNodeId?: string;
  }): Promise<string[]> {
    if (tokenRecord.scopeNodeHash) {
      return [tokenRecord.scopeNodeHash];
    }
    if (tokenRecord.scopeSetNodeId) {
      const setNode = await scopeSetNodesDb.get(tokenRecord.scopeSetNodeId);
      return setNode?.children ?? [];
    }
    return [];
  }

  return { create, list, get, revoke, delegate };
};
