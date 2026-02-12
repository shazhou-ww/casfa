/**
 * Token selector — ensures the client has valid auth for API calls.
 *
 * Two-tier model (JWT direct auth for root):
 * 1. Root operations: use user JWT directly (no AT/RT for root delegate)
 * 2. Child delegate operations: use child delegate AT (with RT refresh)
 *
 * The selector auto-ensures the root delegate entity exists and returns
 * a StoredAccessToken backed by the user's JWT for realm API calls.
 */

import type { StoredAccessToken, StoredRootDelegate } from "../types/tokens.ts";
import { isUserTokenValid, needsRootDelegate } from "./token-checks.ts";
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
   * Get an auth token for realm API calls.
   *
   * Returns a StoredAccessToken where `tokenBase64` is:
   * - The user's JWT string (root mode — default for stateful client)
   *
   * The server's unified auth middleware detects JWT vs AT automatically.
   */
  ensureAccessToken: () => Promise<StoredAccessToken | null>;

  /**
   * Ensure root delegate entity exists on server, creating one if needed.
   * Caches the delegate metadata locally (no RT/AT — root uses JWT).
   */
  ensureRootDelegate: () => Promise<StoredRootDelegate | null>;
};

// ============================================================================
// API Calls
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
};

/**
 * Ensure root delegate exists via POST /api/tokens/root.
 * Returns delegate metadata only (no RT/AT).
 */
const createRootDelegate = async (
  baseUrl: string,
  userAccessToken: string,
  realm: string
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
      console.error("[TokenSelector] Failed to create root delegate:", response.status);
      return null;
    }

    return (await response.json()) as RootTokenResponse;
  } catch (err) {
    console.error("[TokenSelector] Error creating root delegate:", err);
    return null;
  }
};

// ============================================================================
// Token Selector Factory
// ============================================================================

/**
 * Create a token selector instance.
 */
export const createTokenSelector = (config: TokenSelectorConfig): TokenSelector => {
  const { store, baseUrl, realm } = config;

  // Promise deduplication for root delegate creation
  let rootDelegatePromise: Promise<StoredRootDelegate | null> | null = null;

  const ensureRootDelegate = async (): Promise<StoredRootDelegate | null> => {
    const state = store.getState();

    // Already have root delegate metadata cached
    if (!needsRootDelegate(state)) {
      return state.rootDelegate;
    }

    // Need to create one — requires User JWT
    const userToken = state.user;
    if (!isUserTokenValid(userToken)) {
      return null;
    }

    // Deduplicate concurrent calls
    if (!rootDelegatePromise) {
      rootDelegatePromise = (async () => {
        const result = await createRootDelegate(baseUrl, userToken!.accessToken, realm);

        if (!result) return null;

        const newRootDelegate: StoredRootDelegate = {
          delegateId: result.delegate.delegateId,
          realm: result.delegate.realm,
          depth: result.delegate.depth,
          canUpload: result.delegate.canUpload,
          canManageDepot: result.delegate.canManageDepot,
        };

        store.setRootDelegate(newRootDelegate);
        return newRootDelegate;
      })().finally(() => {
        rootDelegatePromise = null;
      });
    }

    return rootDelegatePromise;
  };

  const ensureAccessToken = async (): Promise<StoredAccessToken | null> => {
    // Step 1: Ensure root delegate entity exists
    const rd = await ensureRootDelegate();
    if (!rd) return null;

    // Step 2: Ensure user JWT is valid
    const state = store.getState();
    const userToken = state.user;
    if (!isUserTokenValid(userToken)) {
      return null;
    }

    // Step 3: Return JWT-backed StoredAccessToken
    // The server's unified auth middleware detects JWT (contains '.') and
    // resolves the root delegate automatically.
    return {
      tokenBase64: userToken!.accessToken,
      tokenBytes: new Uint8Array(0), // JWT has no raw token bytes (PoP N/A for root)
      expiresAt: userToken!.expiresAt,
      canUpload: rd.canUpload,
      canManageDepot: rd.canManageDepot,
    };
  };

  return {
    ensureAccessToken,
    ensureRootDelegate,
  };
};
