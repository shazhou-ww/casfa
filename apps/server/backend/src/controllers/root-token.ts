/**
 * Root Token Controller
 *
 * POST /api/tokens/root — JWT → Root Delegate + RT + AT
 *
 * This endpoint creates (or retrieves) the root delegate for a user's realm,
 * then issues a fresh Refresh Token + Access Token pair.
 */

import type { Context } from "hono";
import type { DelegatesDb } from "../db/delegates.ts";
import type { TokenRecordsDb } from "../db/token-records.ts";
import type { Env, JwtAuthContext } from "../types.ts";
import {
  computeRealmHash,
  computeScopeHash,
  generateTokenPair,
} from "../util/delegate-token-utils.ts";
import { generateDelegateId } from "../util/token-id.ts";

// ============================================================================
// Types
// ============================================================================

export type RootTokenControllerDeps = {
  delegatesDb: DelegatesDb;
  tokenRecordsDb: TokenRecordsDb;
};

export type RootTokenController = {
  create: (c: Context<Env>) => Promise<Response>;
};

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_AT_TTL_SECONDS = 3600; // 1 hour

// ============================================================================
// Controller Factory
// ============================================================================

export const createRootTokenController = (
  deps: RootTokenControllerDeps,
): RootTokenController => {
  const { delegatesDb, tokenRecordsDb } = deps;

  /**
   * POST /api/tokens/root
   *
   * JWT authenticated user creates root delegate + gets RT + AT.
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
        400,
      );
    }

    // Get or create root delegate
    const rootDelegateId = generateDelegateId();
    const rootDelegate = await delegatesDb.getOrCreateRoot(realm, rootDelegateId);

    if (rootDelegate.isRevoked) {
      return c.json(
        {
          error: "ROOT_DELEGATE_REVOKED",
          message: "Root delegate has been revoked. Contact admin.",
        },
        403,
      );
    }

    // Generate RT + AT pair
    const realmHash = computeRealmHash(realm);
    // Root delegate has empty scope (all-access)
    const scopeHash = computeScopeHash([]);

    const tokenPair = await generateTokenPair({
      delegateId: rootDelegate.delegateId,
      realmHash,
      scopeHash,
      depth: 0,
      canUpload: rootDelegate.canUpload,
      canManageDepot: rootDelegate.canManageDepot,
      accessTokenTtlSeconds: DEFAULT_AT_TTL_SECONDS,
    });

    // Store token records for RT rotation
    await tokenRecordsDb.create({
      tokenId: tokenPair.refreshToken.id,
      tokenType: "refresh",
      delegateId: rootDelegate.delegateId,
      realm,
      expiresAt: 0,
    });
    await tokenRecordsDb.create({
      tokenId: tokenPair.accessToken.id,
      tokenType: "access",
      delegateId: rootDelegate.delegateId,
      realm,
      expiresAt: tokenPair.accessToken.expiresAt,
    });

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
        refreshToken: tokenPair.refreshToken.base64,
        accessToken: tokenPair.accessToken.base64,
        refreshTokenId: tokenPair.refreshToken.id,
        accessTokenId: tokenPair.accessToken.id,
        accessTokenExpiresAt: tokenPair.accessToken.expiresAt,
      },
      201,
    );
  };

  return { create };
};
