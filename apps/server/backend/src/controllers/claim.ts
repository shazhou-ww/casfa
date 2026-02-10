/**
 * Claim Controller
 *
 * POST /api/realm/{realmId}/nodes/{key}/claim
 *
 * Claims ownership of a CAS node via Proof-of-Possession.
 * The caller proves they hold both the access token bytes and the node content
 * by submitting a keyed-hash PoP.
 *
 * Flow (§6.4):
 *   1. Validate access token + canUpload
 *   2. Node exists? (404 NODE_NOT_FOUND)
 *   3. Already owned? (200 idempotent)
 *   4. Read content → compute PoP → compare (403 INVALID_POP)
 *   5. Full-chain ownership write → 200
 */

import type { PopContext } from "@casfa/proof";
import { verifyPoP } from "@casfa/proof";
import { nodeKeyToHex } from "@casfa/protocol";
import type { Context } from "hono";
import type { OwnershipV2Db } from "../db/ownership-v2.ts";
import type { AccessTokenAuthContext, Env } from "../types.ts";

// ============================================================================
// Types
// ============================================================================

export type ClaimControllerDeps = {
  ownershipDb: OwnershipV2Db;
  /**
   * Read CAS node content by storage key (hex).
   * Returns raw bytes or null if the node does not exist.
   */
  getNodeContent: (realm: string, storageKey: string) => Promise<Uint8Array | null>;
  /** PoP crypto context (blake3_256, blake3_128_keyed, crockfordBase32Encode) */
  popContext: PopContext;
};

export type ClaimController = {
  claim: (c: Context<Env>) => Promise<Response>;
};

// ============================================================================
// Controller Factory
// ============================================================================

export const createClaimController = (deps: ClaimControllerDeps): ClaimController => {
  const { ownershipDb, getNodeContent, popContext } = deps;

  /**
   * POST /api/realm/{realmId}/nodes/{key}/claim
   */
  const claim = async (c: Context<Env>): Promise<Response> => {
    const auth = c.get("auth") as AccessTokenAuthContext;

    // 1. Must be access token with canUpload
    if (!auth || auth.type !== "access") {
      return c.json({ error: "ACCESS_TOKEN_REQUIRED", message: "Access token required" }, 403);
    }
    if (!auth.canUpload) {
      return c.json(
        { error: "UPLOAD_NOT_ALLOWED", message: "Token does not have upload permission" },
        403
      );
    }

    // Realm check
    const realmId = c.req.param("realmId");
    if (!realmId) {
      return c.json({ error: "INVALID_REQUEST", message: "Missing realmId" }, 400);
    }
    if (auth.realm !== realmId) {
      return c.json(
        { error: "REALM_MISMATCH", message: "Token realm does not match request realm" },
        403
      );
    }

    // Node hash from path
    const nodeKey = c.req.param("key");
    if (!nodeKey) {
      return c.json({ error: "INVALID_REQUEST", message: "Missing node key" }, 400);
    }

    // Convert node:XXXX to hex storage key (consistent with chunks controller)
    const storageKey = nodeKeyToHex(nodeKey);

    // Parse request body
    const body = await c.req.json().catch(() => null);
    if (
      !body ||
      typeof body !== "object" ||
      typeof (body as Record<string, unknown>).pop !== "string"
    ) {
      return c.json(
        { error: "INVALID_REQUEST", message: "Request body must contain a 'pop' string" },
        400
      );
    }
    const pop = (body as Record<string, unknown>).pop as string;

    // Derive delegate ID and chain from auth context
    const delegateId = deriveDelegateId(auth);
    const chain = auth.issuerChain && auth.issuerChain.length > 0 ? auth.issuerChain : [delegateId];

    // 2. Node exists?
    const content = await getNodeContent(realmId, storageKey);
    if (content === null) {
      return c.json({ error: "NODE_NOT_FOUND", message: `Node ${nodeKey} does not exist` }, 404);
    }

    // 3. Already owned? (idempotent)
    const alreadyOwned = await ownershipDb.hasOwnership(storageKey, delegateId);
    if (alreadyOwned) {
      return c.json({ nodeHash: nodeKey, alreadyOwned: true, delegateId }, 200);
    }

    // 4. Verify PoP
    if (!verifyPoP(pop, auth.tokenBytes, content, popContext)) {
      return c.json(
        { error: "INVALID_POP", message: "Proof-of-Possession verification failed" },
        403
      );
    }

    // 5. Full-chain ownership write
    await ownershipDb.addOwnership(
      storageKey,
      chain,
      delegateId,
      "", // contentType — not needed for claim
      content.length
    );

    return c.json({ nodeHash: nodeKey, alreadyOwned: false, delegateId }, 200);
  };

  return { claim };
};

// ============================================================================
// Internals
// ============================================================================

/**
 * Derive delegate ID from auth context — same logic as proof-validation.ts
 */
function deriveDelegateId(auth: AccessTokenAuthContext): string {
  if (auth.issuerChain && auth.issuerChain.length > 0) {
    return auth.issuerChain[auth.issuerChain.length - 1]!;
  }
  return auth.tokenId;
}
