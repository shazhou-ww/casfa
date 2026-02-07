/**
 * Token Requests Controller
 *
 * Handles client authorization request flow.
 * Based on docs/delegate-token-refactor/impl/04-controller-refactor.md
 */

import type { Context } from "hono";
import type { DelegateTokensDb } from "../db/delegate-tokens.ts";
import type { ScopeSetNodesDb } from "../db/scope-set-nodes.ts";
import type { TokenRequestsDb } from "../db/token-requests.ts";
import type { DepotsDb } from "../db/depots.ts";
import type { Env, JwtAuthContext } from "../types.ts";
import {
  computeRealmHash,
  computeScopeHash,
  computeTokenId,
  computeUserIdHash,
  generateToken,
} from "../util/token.ts";
import { generateDisplayCode, generateRequestId } from "../util/token-request.ts";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { parseCasUri } from "../util/scope.ts";
import { blake3Hash } from "../util/hashing.ts";

// ============================================================================
// Types
// ============================================================================

export type TokenRequestsControllerDeps = {
  tokenRequestsDb: TokenRequestsDb;
  delegateTokensDb: DelegateTokensDb;
  scopeSetNodesDb: ScopeSetNodesDb;
  depotsDb: DepotsDb;
  authorizeUrlBase: string;
};

export type TokenRequestsController = {
  create: (c: Context<Env>) => Promise<Response>;
  poll: (c: Context<Env>) => Promise<Response>;
  list: (c: Context<Env>) => Promise<Response>;
  get: (c: Context<Env>) => Promise<Response>;
  approve: (c: Context<Env>) => Promise<Response>;
  reject: (c: Context<Env>) => Promise<Response>;
};

// ============================================================================
// Constants
// ============================================================================

const REQUEST_TTL_MS = 10 * 60 * 1000; // 10 minutes
const DEFAULT_TOKEN_TTL_SECONDS = 30 * 24 * 3600; // 30 days

// ============================================================================
// Controller Factory
// ============================================================================

export const createTokenRequestsController = (
  deps: TokenRequestsControllerDeps
): TokenRequestsController => {
  const { tokenRequestsDb, delegateTokensDb, scopeSetNodesDb, depotsDb, authorizeUrlBase } = deps;

  /**
   * POST /api/tokens/requests
   * Client initiates authorization request
   */
  const create = async (c: Context<Env>): Promise<Response> => {
    const body = await c.req.json();

    const requestId = generateRequestId();
    const displayCode = generateDisplayCode();
    const expiresAt = Date.now() + REQUEST_TTL_MS;

    await tokenRequestsDb.create({
      requestId,
      clientName: body.clientName,
      clientSecretHash: body.clientSecretHash,
      displayCode,
      expiresIn: Math.floor(REQUEST_TTL_MS / 1000),
    });

    return c.json(
      {
        requestId,
        displayCode,
        authorizeUrl: `${authorizeUrlBase}/authorize/${requestId}`,
        expiresAt,
        pollInterval: 5,
      },
      201
    );
  };

  /**
   * GET /api/tokens/requests/:requestId/poll
   * Client polls for request status
   */
  const poll = async (c: Context<Env>): Promise<Response> => {
    const requestId = c.req.param("requestId");

    const request = await tokenRequestsDb.get(requestId);
    if (!request) {
      return c.json({ error: "REQUEST_NOT_FOUND", message: "Request not found" }, 404);
    }

    // Check if expired
    if (request.status === "pending" && request.expiresAt < Date.now()) {
      await tokenRequestsDb.updateStatus(requestId, "expired");
      return c.json({
        requestId,
        status: "expired",
      });
    }

    switch (request.status) {
      case "pending":
        return c.json({
          requestId,
          status: "pending",
          clientName: request.clientName,
          requestExpiresAt: request.expiresAt,
        });

      case "approved":
        // Only return encryptedToken on first poll after approval
        const response: Record<string, unknown> = {
          requestId,
          status: "approved",
        };

        if (request.encryptedToken) {
          response.encryptedToken = request.encryptedToken;
          // Mark as delivered (one-time delivery)
          await tokenRequestsDb.clearEncryptedToken(requestId);
        }

        return c.json(response);

      case "rejected":
        return c.json({ requestId, status: "rejected" });

      case "expired":
        return c.json({ requestId, status: "expired" });

      default:
        return c.json({ requestId, status: request.status });
    }
  };

  /**
   * GET /api/tokens/requests
   * User lists pending authorization requests
   */
  const list = async (c: Context<Env>): Promise<Response> => {
    const auth = c.get("auth") as JwtAuthContext;

    // List all pending requests (in a real implementation, might filter by targeted realm)
    const requests = await tokenRequestsDb.listPending();

    // Filter out expired requests
    const activeRequests = requests.filter((r) => r.expiresAt > Date.now());

    return c.json({
      requests: activeRequests.map((r) => ({
        requestId: r.requestId,
        clientName: r.clientName,
        status: r.status,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
      })),
    });
  };

  /**
   * GET /api/tokens/requests/:requestId
   * User views request details (before approving/rejecting)
   */
  const get = async (c: Context<Env>): Promise<Response> => {
    const requestId = c.req.param("requestId");

    const request = await tokenRequestsDb.get(requestId);
    if (!request) {
      return c.json({ error: "REQUEST_NOT_FOUND", message: "Request not found" }, 404);
    }

    // Check if expired
    if (request.status === "pending" && request.expiresAt < Date.now()) {
      return c.json({ error: "REQUEST_EXPIRED", message: "Request has expired" }, 400);
    }

    return c.json({
      requestId,
      status: request.status,
      clientName: request.clientName,
      displayCode: request.displayCode,
      createdAt: request.createdAt,
      expiresAt: request.expiresAt,
    });
  };

  /**
   * POST /api/tokens/requests/:requestId/approve
   * User approves authorization request
   */
  const approve = async (c: Context<Env>): Promise<Response> => {
    const auth = c.get("auth") as JwtAuthContext;
    const requestId = c.req.param("requestId");
    const body = await c.req.json();

    const request = await tokenRequestsDb.get(requestId);
    if (!request) {
      return c.json({ error: "REQUEST_NOT_FOUND", message: "Request not found" }, 404);
    }

    // Check status
    if (request.status !== "pending") {
      return c.json(
        { error: "REQUEST_ALREADY_PROCESSED", message: "Request already processed" },
        400
      );
    }

    // Check expiration
    if (request.expiresAt < Date.now()) {
      return c.json({ error: "REQUEST_EXPIRED", message: "Request has expired" }, 400);
    }

    // Validate realm permission
    const expectedRealm = `usr_${auth.userId}`;
    if (body.realm !== expectedRealm) {
      return c.json(
        { error: "INVALID_REALM", message: "Cannot create token for another user's realm" },
        400
      );
    }

    // Resolve scope from CAS URIs
    const resolvedHashes: string[] = [];
    for (const uri of body.scope) {
      const parsed = parseCasUri(uri);
      if (!parsed) {
        return c.json({ error: "INVALID_SCOPE", message: `Invalid CAS URI: ${uri}` }, 400);
      }

      if (parsed.type === "depot") {
        if (parsed.depotId === "*") {
          // Wildcard: include all depot roots in this realm
          const result = await depotsDb.list(body.realm);
          for (const depot of result.depots) {
            resolvedHashes.push(depot.root);
          }
        } else {
          const depot = await depotsDb.get(body.realm, parsed.depotId);
          if (!depot) {
            return c.json(
              { error: "INVALID_SCOPE", message: `Depot not found: ${parsed.depotId}` },
              400
            );
          }
          resolvedHashes.push(depot.root);
        }
      } else {
        resolvedHashes.push(parsed.hash);
      }
    }

    const uniqueHashes = [...new Set(resolvedHashes)].sort();
    const scopeHash = computeScopeHash(uniqueHashes);

    let scopeNodeHash: string | undefined;
    let scopeSetNodeId: string | undefined;

    if (uniqueHashes.length === 1) {
      scopeNodeHash = uniqueHashes[0];
    } else {
      const setNodeId = Buffer.from(blake3Hash(uniqueHashes.join(",")).slice(0, 16)).toString(
        "hex"
      );
      await scopeSetNodesDb.createOrIncrement(setNodeId, uniqueHashes);
      scopeSetNodeId = setNodeId;
    }

    // Generate token
    const expiresIn = body.expiresIn ?? DEFAULT_TOKEN_TTL_SECONDS;
    const expiresAt = Date.now() + expiresIn * 1000;

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
      scopeHash,
    });

    const tokenId = computeTokenId(tokenBytes);

    // Create token record
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
      scopeNodeHash,
      scopeSetNodeId,
    });

    // Encrypt raw token bytes with AES-256-GCM.
    // Key = SHA256(clientSecretHash hex string) — client recomputes from raw secret.
    const encKey = createHash("sha256").update(request.clientSecretHash).digest();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", encKey, iv);
    const encrypted = Buffer.concat([cipher.update(tokenBytes), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const encryptedToken = Buffer.concat([iv, encrypted, authTag]).toString("base64");

    // Update request status
    await tokenRequestsDb.approve(requestId, {
      encryptedToken,
      approvedBy: auth.userId,
      approvedAt: Date.now(),
    });

    return c.json({
      success: true,
      tokenId,
      expiresAt,
      encryptedToken, // Include encrypted token in response
    });
  };

  /**
   * POST /api/tokens/requests/:requestId/reject
   * User rejects authorization request
   */
  const reject = async (c: Context<Env>): Promise<Response> => {
    const requestId = c.req.param("requestId");

    const request = await tokenRequestsDb.get(requestId);
    if (!request) {
      return c.json({ error: "REQUEST_NOT_FOUND", message: "Request not found" }, 404);
    }

    if (request.status !== "pending") {
      return c.json(
        { error: "REQUEST_ALREADY_PROCESSED", message: "Request already processed" },
        400
      );
    }

    if (request.expiresAt < Date.now()) {
      return c.json({ error: "REQUEST_EXPIRED", message: "Request has expired" }, 400);
    }

    await tokenRequestsDb.updateStatus(requestId, "rejected");

    return c.json({ success: true });
  };

  return { create, poll, list, get, approve, reject };
};
