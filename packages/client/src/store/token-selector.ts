/**
 * Token selector — ensures the client has valid tokens for API calls.
 *
 * Two-tier model:
 * 1. Root Delegate: obtained via POST /api/tokens/root (requires JWT)
 * 2. Access Token: obtained via RT rotation POST /api/tokens/refresh
 *
 * The selector auto-issues/refreshes tokens as needed.
 */

import type { StoredAccessToken, StoredRootDelegate } from "../types/tokens.ts";
import { rootDelegateToAccessToken } from "../types/tokens.ts";
import {
  isAccessTokenValid,
  isUserTokenValid,
  needsRootDelegate,
} from "./token-checks.ts";
import type { TokenStore } from "./token-store.ts";

// ============================================================================
// Types
// ============================================================================

export type TokenSelectorConfig = {
  store: TokenStore;
  baseUrl: string;
  realm: string;
};

export type TokenSelector = {
  /**
   * Get or refresh an Access Token.
   * - If valid AT exists in root delegate, return it
   * - If AT expired but RT exists, refresh via /api/tokens/refresh
   * - If no root delegate, issue one via /api/tokens/root (requires JWT)
   */
  ensureAccessToken: () => Promise<StoredAccessToken | null>;

  /**
   * Ensure root delegate exists, creating one if needed.
   */
  ensureRootDelegate: () => Promise<StoredRootDelegate | null>;
};

// ============================================================================
// API Calls for Token Issuance
// ============================================================================

type RootTokenResponse = {
  delegate: {
    delegateId: string;
    realm: string;
    depth: number;
    canUpload: boolean;
    canManageDepot: boolean;
    createdAt: number;
  };
  refreshToken: string;
  accessToken: string;
  refreshTokenId: string;
  accessTokenId: string;
  accessTokenExpiresAt: number;
};

type RefreshTokenResponse = {
  refreshToken: string;
  accessToken: string;
  refreshTokenId: string;
  accessTokenId: string;
  accessTokenExpiresAt: number;
  delegateId: string;
};

/**
 * Create root delegate via POST /api/tokens/root.
 * Requires User JWT.
 */
const createRootToken = async (
  baseUrl: string,
  userAccessToken: string,
  realm: string,
): Promise<RootTokenResponse | null> => {
  try {
    const response = await fetch(`${baseUrl}/api/tokens/root`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userAccessToken}`,
      },
      body: JSON.stringify({ realm }),
    });

    if (!response.ok) {
      console.error(
        "[TokenSelector] Failed to create root token:",
        response.status,
      );
      return null;
    }

    return (await response.json()) as RootTokenResponse;
  } catch (err) {
    console.error("[TokenSelector] Error creating root token:", err);
    return null;
  }
};

/**
 * Refresh tokens via POST /api/tokens/refresh.
 * Uses RT as Bearer token.
 */
const refreshTokens = async (
  baseUrl: string,
  refreshTokenBase64: string,
): Promise<RefreshTokenResponse | null> => {
  try {
    const response = await fetch(`${baseUrl}/api/tokens/refresh`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${refreshTokenBase64}`,
      },
    });

    if (!response.ok) {
      console.error(
        "[TokenSelector] Failed to refresh tokens:",
        response.status,
      );
      return null;
    }

    return (await response.json()) as RefreshTokenResponse;
  } catch (err) {
    console.error("[TokenSelector] Error refreshing tokens:", err);
    return null;
  }
};

// ============================================================================
// Token Selector Factory
// ============================================================================

/**
 * Create a token selector instance.
 */
export const createTokenSelector = (
  config: TokenSelectorConfig,
): TokenSelector => {
  const { store, baseUrl, realm } = config;

  // Promise deduplication for root token creation
  let rootTokenPromise: Promise<StoredRootDelegate | null> | null = null;
  // Promise deduplication for refresh
  let refreshPromise: Promise<StoredRootDelegate | null> | null = null;

  const ensureRootDelegate = async (): Promise<StoredRootDelegate | null> => {
    const state = store.getState();

    // Already have a root delegate
    if (!needsRootDelegate(state)) {
      return state.rootDelegate;
    }

    // Need to create one — requires User JWT
    const userToken = state.user;
    if (!isUserTokenValid(userToken)) {
      return null;
    }

    // Deduplicate concurrent calls
    if (!rootTokenPromise) {
      rootTokenPromise = (async () => {
        const result = await createRootToken(
          baseUrl,
          userToken!.accessToken,
          realm,
        );

        if (!result) return null;

        const newRootDelegate: StoredRootDelegate = {
          delegateId: result.delegate.delegateId,
          realm: result.delegate.realm,
          refreshToken: result.refreshToken,
          refreshTokenId: result.refreshTokenId,
          accessToken: result.accessToken,
          accessTokenId: result.accessTokenId,
          accessTokenExpiresAt: result.accessTokenExpiresAt,
          depth: result.delegate.depth,
          canUpload: result.delegate.canUpload,
          canManageDepot: result.delegate.canManageDepot,
        };

        store.setRootDelegate(newRootDelegate);
        return newRootDelegate;
      })().finally(() => {
        rootTokenPromise = null;
      });
    }

    return rootTokenPromise;
  };

  const doRefresh = async (
    currentRd: StoredRootDelegate,
  ): Promise<StoredRootDelegate | null> => {
    const result = await refreshTokens(baseUrl, currentRd.refreshToken);

    if (!result) {
      // Refresh failed — clear root delegate, require re-auth
      store.setRootDelegate(null);
      return null;
    }

    const updatedRd: StoredRootDelegate = {
      ...currentRd,
      refreshToken: result.refreshToken,
      refreshTokenId: result.refreshTokenId,
      accessToken: result.accessToken,
      accessTokenId: result.accessTokenId,
      accessTokenExpiresAt: result.accessTokenExpiresAt,
    };

    store.setRootDelegate(updatedRd);
    return updatedRd;
  };

  const ensureAccessToken = async (): Promise<StoredAccessToken | null> => {
    // Step 1: Ensure we have a root delegate
    let rd = await ensureRootDelegate();
    if (!rd) return null;

    // Step 2: Check if AT is still valid
    if (isAccessTokenValid(rd)) {
      return rootDelegateToAccessToken(rd);
    }

    // Step 3: AT expired — refresh via RT rotation
    if (!refreshPromise) {
      refreshPromise = doRefresh(rd).finally(() => {
        refreshPromise = null;
      });
    }

    rd = await refreshPromise;
    if (!rd) return null;

    return rootDelegateToAccessToken(rd);
  };

  return {
    ensureAccessToken,
    ensureRootDelegate,
  };
};
