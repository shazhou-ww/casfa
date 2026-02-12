/**
 * Token selector — ensures the client has valid auth for API calls.
 *
 * The server auto-creates the root delegate on first JWT request,
 * so the client just needs a valid user JWT. No explicit root delegate
 * creation step is required.
 */

import type { StoredAccessToken } from "../types/tokens.ts";
import { isUserTokenValid } from "./token-checks.ts";
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
   * Returns a StoredAccessToken where `tokenBase64` is the user's JWT.
   * The server's unified auth middleware detects JWT (contains '.') and
   * auto-creates the root delegate if needed.
   */
  ensureAccessToken: () => Promise<StoredAccessToken | null>;
};

// ============================================================================
// Token Selector Factory
// ============================================================================

/**
 * Create a token selector instance.
 */
export const createTokenSelector = (config: TokenSelectorConfig): TokenSelector => {
  const { store } = config;

  const ensureAccessToken = async (): Promise<StoredAccessToken | null> => {
    const state = store.getState();
    const userToken = state.user;
    if (!isUserTokenValid(userToken)) {
      return null;
    }

    // Use JWT directly — server auto-creates root delegate on first request
    return {
      tokenBase64: userToken!.accessToken,
      tokenBytes: new Uint8Array(0), // JWT has no raw token bytes
      expiresAt: userToken!.expiresAt,
      canUpload: true, // Root delegate always has full permissions
      canManageDepot: true,
    };
  };

  return {
    ensureAccessToken,
  };
};
