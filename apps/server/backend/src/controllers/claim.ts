/**
 * Claim Controller
 *
 * Legacy single claim:
 *   POST /api/realm/{realmId}/nodes/{key}/claim
 *
 * New batch claim:
 *   POST /api/realm/{realmId}/nodes/claim
 *
 * Claims ownership of CAS nodes via:
 * - Proof-of-Possession (PoP): keyed-hash proving possession of token bytes + node content
 * - Path-based: prove reachability from an authorized scope root via ~N index path
 *
 * See docs/proof-inline-migration/README.md §6.2
 */

import { decodeNode, isWellKnownNode } from "@casfa/core";
import type { PopContext } from "@casfa/proof";
import { verifyPoP } from "@casfa/proof";
import {
  type BatchClaimRequest,
  type BatchClaimResponse,
  type BatchClaimResult,
  hashToNodeKey,
  nodeKeyToStorageKey,
  storageKeyToNodeKey,
} from "@casfa/protocol";
import type { StorageProvider } from "@casfa/storage-core";
import type { Context } from "hono";
import type { OwnershipV2Db } from "../db/ownership-v2.ts";
import type { AccessTokenAuthContext, Env } from "../types.ts";

// ============================================================================
// Types
// ============================================================================

export type ClaimControllerDeps = {
  ownershipDb: OwnershipV2Db;
  /**
   * Read CAS node content by storage key (CB32).
   * Returns raw bytes or null if the node does not exist.
   */
  getNodeContent: (realm: string, storageKey: string) => Promise<Uint8Array | null>;
  /** PoP crypto context (blake3_256, blake3_128_keyed, crockfordBase32Encode) */
  popContext: PopContext;
  /** CAS storage for path-based navigation */
  storage: StorageProvider;
};

export type ClaimController = {
  /** Legacy single claim: POST /nodes/{key}/claim */
  claim: (c: Context<Env>) => Promise<Response>;
  /** New batch claim: POST /nodes/claim */
  batchClaim: (c: Context<Env>) => Promise<Response>;
};

// ============================================================================
// Controller Factory
// ============================================================================

export const createClaimController = (deps: ClaimControllerDeps): ClaimController => {
  const { ownershipDb, getNodeContent, popContext, storage } = deps;

  /**
   * POST /api/realm/{realmId}/nodes/{key}/claim (legacy single claim)
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

    // Convert node:XXXX to CB32 storage key (consistent with chunks controller)
    const storageKey = nodeKeyToStorageKey(nodeKey);

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
    // Root delegates (depth=0) use JWT authentication — they don't have binary
    // token bytes, so PoP verification is skipped. JWT already proves identity.
    if (auth.delegate.depth > 0 && !verifyPoP(pop, auth.tokenBytes, content, popContext)) {
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

  /**
   * POST /api/realm/{realmId}/nodes/claim (new batch claim)
   *
   * Supports two claim modes:
   * - PoP claim: { key, pop } — prove possession of node content + token bytes
   * - Path-based claim: { key, from, path } — prove reachability from authorized node
   */
  const batchClaim = async (c: Context<Env>): Promise<Response> => {
    const auth = c.get("auth") as AccessTokenAuthContext;

    if (!auth || auth.type !== "access") {
      return c.json({ error: "ACCESS_TOKEN_REQUIRED", message: "Access token required" }, 403);
    }
    if (!auth.canUpload) {
      return c.json(
        { error: "UPLOAD_NOT_ALLOWED", message: "Token does not have upload permission" },
        403
      );
    }

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

    const body = (await c.req.json()) as BatchClaimRequest;
    const delegateId = deriveDelegateId(auth);
    const chain = auth.issuerChain && auth.issuerChain.length > 0 ? auth.issuerChain : [delegateId];

    const results: BatchClaimResult[] = [];
    let anyFailed = false;
    let anySucceeded = false;

    for (const entry of body.claims) {
      const nodeKey = entry.key;
      const entryStorageKey = nodeKeyToStorageKey(nodeKey);

      try {
        // Already owned? (idempotent)
        const alreadyOwned = await ownershipDb.hasOwnership(entryStorageKey, delegateId);
        if (alreadyOwned) {
          results.push({ key: nodeKey, ok: true, alreadyOwned: true, error: null });
          anySucceeded = true;
          continue;
        }

        if ("pop" in entry) {
          // PoP claim
          const content = await getNodeContent(realmId, entryStorageKey);
          if (content === null) {
            results.push({ key: nodeKey, ok: false, alreadyOwned: false, error: "NODE_NOT_FOUND" });
            anyFailed = true;
            continue;
          }

          if (
            auth.delegate.depth > 0 &&
            !verifyPoP(entry.pop, auth.tokenBytes, content, popContext)
          ) {
            results.push({ key: nodeKey, ok: false, alreadyOwned: false, error: "INVALID_POP" });
            anyFailed = true;
            continue;
          }

          await ownershipDb.addOwnership(entryStorageKey, chain, delegateId, "", content.length);
          results.push({ key: nodeKey, ok: true, alreadyOwned: false, error: null });
          anySucceeded = true;
        } else if ("from" in entry && "path" in entry) {
          // Path-based claim
          const fromKey = entry.from;
          const fromStorageKey = nodeKeyToStorageKey(fromKey);

          // Direct Authorization Check on `from` node
          const fromAuthorized = await isDirectlyAuthorized(fromStorageKey, auth, ownershipDb);
          if (!fromAuthorized) {
            results.push({
              key: nodeKey,
              ok: false,
              alreadyOwned: false,
              error: `Not authorized to access 'from' node ${fromKey}`,
            });
            anyFailed = true;
            continue;
          }

          // Walk path from `from` to target
          const walkResult = await walkIndexPath(fromStorageKey, entry.path, storage);
          if (!walkResult.ok) {
            results.push({ key: nodeKey, ok: false, alreadyOwned: false, error: walkResult.error });
            anyFailed = true;
            continue;
          }

          // Verify the walked destination matches the claimed key
          const walkedNodeKey = storageKeyToNodeKey(walkResult.storageKey);
          if (walkedNodeKey !== nodeKey) {
            results.push({
              key: nodeKey,
              ok: false,
              alreadyOwned: false,
              error: `Path leads to ${walkedNodeKey}, not ${nodeKey}`,
            });
            anyFailed = true;
            continue;
          }

          // Get content for ownership write (need size)
          const content = await getNodeContent(realmId, entryStorageKey);
          if (content === null) {
            results.push({ key: nodeKey, ok: false, alreadyOwned: false, error: "NODE_NOT_FOUND" });
            anyFailed = true;
            continue;
          }

          await ownershipDb.addOwnership(entryStorageKey, chain, delegateId, "", content.length);
          results.push({ key: nodeKey, ok: true, alreadyOwned: false, error: null });
          anySucceeded = true;
        } else {
          results.push({
            key: nodeKey,
            ok: false,
            alreadyOwned: false,
            error: "Invalid claim entry format",
          });
          anyFailed = true;
        }
      } catch (err) {
        results.push({
          key: nodeKey,
          ok: false,
          alreadyOwned: false,
          error: err instanceof Error ? err.message : "Internal error",
        });
        anyFailed = true;
      }
    }

    const response: BatchClaimResponse = { results };
    if (!anyFailed) return c.json(response, 200);
    if (!anySucceeded) return c.json(response, 403);
    return c.json(response, 207);
  };

  return { claim, batchClaim };
};

// ============================================================================
// Internals
// ============================================================================

/**
 * Derive delegate ID from auth context.
 */
function deriveDelegateId(auth: AccessTokenAuthContext): string {
  return auth.delegateId;
}

/**
 * Direct Authorization Check (§4.1):
 * 1. Well-known nodes → always authorized
 * 2. Root delegate (depth=0) → always authorized
 * 3. Ownership check → authorized
 * 4. Scope root check → authorized
 */
async function isDirectlyAuthorized(
  storageKey: string,
  auth: AccessTokenAuthContext,
  ownershipDb: OwnershipV2Db
): Promise<boolean> {
  if (isWellKnownNode(storageKey)) return true;
  if (auth.delegate.depth === 0) return true;

  for (const id of auth.issuerChain) {
    if (await ownershipDb.hasOwnership(storageKey, id)) return true;
  }

  if (auth.delegate.scopeNodeHash && storageKey === auth.delegate.scopeNodeHash) return true;

  return false;
}

/**
 * Walk an index path (e.g. "~0/~1/~2") from a starting storage key.
 * Returns the final storage key or error.
 */
async function walkIndexPath(
  startStorageKey: string,
  pathStr: string,
  storage: StorageProvider
): Promise<{ ok: true; storageKey: string } | { ok: false; error: string }> {
  const segments = pathStr
    .split("/")
    .filter(Boolean)
    .map((s) => s.replace(/^~/, ""));

  let current = startStorageKey;

  for (const seg of segments) {
    const index = Number.parseInt(seg, 10);
    if (!Number.isInteger(index) || index < 0) {
      return { ok: false, error: `Invalid path segment: ${seg}` };
    }

    const nodeData = await storage.get(current);
    if (!nodeData) {
      return { ok: false, error: `Node not found during path walk` };
    }

    let decoded: ReturnType<typeof decodeNode>;
    try {
      decoded = decodeNode(nodeData);
    } catch {
      return { ok: false, error: `Failed to decode node during path walk` };
    }

    if (!decoded.children || index >= decoded.children.length) {
      return {
        ok: false,
        error: `Child index ${index} out of bounds (${decoded.children?.length ?? 0} children)`,
      };
    }

    const childHash = decoded.children[index]!;
    current = nodeKeyToStorageKey(hashToNodeKey(childHash));
  }

  return { ok: true, storageKey: current };
}
