/**
 * Root Token Controller (token-simplification v3 → JWT direct auth)
 *
 * POST /api/tokens/root — JWT → Root Delegate metadata (no RT/AT)
 *
 * Creates (or retrieves) the root delegate for a user's realm.
 * Root delegates no longer hold AT/RT — all root operations use
 * the user's JWT directly via the unified auth middleware.
 *
 * This endpoint only ensures the root delegate entity exists and
 * returns its metadata for client-side caching.
 */

import type { Context } from "hono";
import type { DelegatesDb } from "../db/delegates.ts";
import type { Env, JwtAuthContext } from "../types.ts";
import { generateDelegateId } from "../util/token-id.ts";

// ============================================================================
// Types
// ============================================================================

export type RootTokenControllerDeps = {
  delegatesDb: DelegatesDb;
};

export type RootTokenController = {
  create: (c: Context<Env>) => Promise<Response>;
};

// ============================================================================
// Controller Factory
// ============================================================================

export const createRootTokenController = (deps: RootTokenControllerDeps): RootTokenController => {
  const { delegatesDb } = deps;

  /**
   * POST /api/tokens/root
   *
   * JWT authenticated user ensures root delegate exists.
   * Returns delegate metadata only — no RT/AT issued.
   * Root operations use JWT directly via the unified auth middleware.
   */
  const create = async (c: Context<Env>): Promise<Response> => {
    const auth = c.get("auth") as JwtAuthContext;
    const body = await c.req.json().catch(() => ({}));

    // Determine realm — user can only create root for their own realm
    const expectedRealm = auth.userId;
    const realm = body.realm ?? expectedRealm;

    if (realm !== expectedRealm) {
      return c.json(
        {
          error: "INVALID_REALM",
          message: "Cannot create root token for another user's realm",
        },
        400
      );
    }

    const rootDelegateId = generateDelegateId();

    // Get or create root delegate — no token hashes for root
    const { delegate: rootDelegate, created } = await delegatesDb.getOrCreateRoot(
      realm,
      rootDelegateId
    );

    if (rootDelegate.isRevoked) {
      return c.json(
        {
          error: "ROOT_DELEGATE_REVOKED",
          message: "Root delegate has been revoked. Contact admin.",
        },
        403
      );
    }

    return c.json(
      {
        delegate: {
          delegateId: rootDelegate.delegateId,
          realm: rootDelegate.realm,
          depth: rootDelegate.depth,
          canUpload: rootDelegate.canUpload,
          canManageDepot: rootDelegate.canManageDepot,
          createdAt: rootDelegate.createdAt,
        },
      },
      created ? 201 : 200
    );
  };

  return { create };
};
