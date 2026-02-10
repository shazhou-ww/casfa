/**
 * Root Token Controller (token-simplification v3)
 *
 * POST /api/tokens/root — JWT → Root Delegate + RT + AT
 *
 * Creates (or retrieves) the root delegate for a user's realm,
 * then issues a fresh Refresh Token + Access Token pair.
 *
 * Token hashes are stored directly on the Delegate entity
 * (no separate TokenRecord table).
 */

import type { Context } from "hono";
import type { DelegatesDb } from "../db/delegates.ts";
import type { Env, JwtAuthContext } from "../types.ts";
import { generateTokenPair } from "../util/delegate-token-utils.ts";
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
// Constants
// ============================================================================

const DEFAULT_AT_TTL_SECONDS = 3600; // 1 hour

// ============================================================================
// Controller Factory
// ============================================================================

export const createRootTokenController = (deps: RootTokenControllerDeps): RootTokenController => {
  const { delegatesDb } = deps;

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
        400
      );
    }

    // Generate RT + AT pair first (need hashes for delegate creation)
    const rootDelegateId = generateDelegateId();

    const tokenPair = generateTokenPair({
      delegateId: rootDelegateId,
      accessTokenTtlSeconds: DEFAULT_AT_TTL_SECONDS,
    });

    // Get or create root delegate — includes token hashes
    const { delegate: rootDelegate, created } = await delegatesDb.getOrCreateRoot(
      realm,
      rootDelegateId,
      {
        currentRtHash: tokenPair.refreshToken.hash,
        currentAtHash: tokenPair.accessToken.hash,
        atExpiresAt: tokenPair.accessToken.expiresAt,
      }
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

    // If root delegate already existed, we need to generate tokens for IT
    // (our pre-generated tokens used the wrong delegateId)
    if (!created) {
      const existingTokenPair = generateTokenPair({
        delegateId: rootDelegate.delegateId,
        accessTokenTtlSeconds: DEFAULT_AT_TTL_SECONDS,
      });

      // Update the delegate's token hashes via rotateTokens
      // Use the existing RT hash as the expected value
      const rotated = await delegatesDb.rotateTokens({
        delegateId: rootDelegate.delegateId,
        expectedRtHash: rootDelegate.currentRtHash,
        newRtHash: existingTokenPair.refreshToken.hash,
        newAtHash: existingTokenPair.accessToken.hash,
        newAtExpiresAt: existingTokenPair.accessToken.expiresAt,
      });

      if (!rotated) {
        // Race condition — another request beat us. Client should retry.
        return c.json(
          {
            error: "CONCURRENT_REQUEST",
            message: "Another request is processing. Please retry.",
          },
          409
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
          refreshToken: existingTokenPair.refreshToken.base64,
          accessToken: existingTokenPair.accessToken.base64,
          accessTokenExpiresAt: existingTokenPair.accessToken.expiresAt,
        },
        200
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
        refreshToken: tokenPair.refreshToken.base64,
        accessToken: tokenPair.accessToken.base64,
        accessTokenExpiresAt: tokenPair.accessToken.expiresAt,
      },
      201
    );
  };

  return { create };
};
