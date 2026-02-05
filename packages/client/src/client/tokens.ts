/**
 * Token management methods for the stateful client.
 */

import type { CreateToken, CreateTokenResponse } from "@casfa/protocol";
import * as api from "../api/index.ts";
import type { RefreshManager } from "../store/jwt-refresh.ts";
import type { TokenSelector } from "../store/token-selector.ts";
import type { TokenStore } from "../store/token-store.ts";
import type { FetchResult } from "../types/client.ts";
import type { StoredAccessToken, StoredDelegateToken } from "../types/tokens.ts";
import { withDelegateToken, withUserToken } from "./helpers.ts";

// ============================================================================
// Types
// ============================================================================

export type TokenMethods = {
  /** Create a new token (User JWT required) */
  create: (params: CreateToken) => Promise<FetchResult<StoredDelegateToken | StoredAccessToken>>;
  /** List tokens (User JWT required) */
  list: (params?: api.ListTokensParams) => Promise<FetchResult<api.ListTokensResponse>>;
  /** Revoke a token (User JWT required) */
  revoke: (tokenId: string) => Promise<FetchResult<void>>;
  /** Delegate a token using current Delegate Token */
  delegate: (
    params: api.DelegateTokenParams
  ) => Promise<FetchResult<StoredDelegateToken | StoredAccessToken>>;
};

export type TokenDeps = {
  baseUrl: string;
  realm: string;
  store: TokenStore;
  refreshManager: RefreshManager;
  tokenSelector: TokenSelector;
};

// ============================================================================
// Factory
// ============================================================================

export const createTokenMethods = ({
  baseUrl,
  realm,
  store,
  refreshManager,
  tokenSelector,
}: TokenDeps): TokenMethods => {
  const requireUser = withUserToken(() => refreshManager.ensureValidUserToken());
  const requireDelegate = withDelegateToken(() => tokenSelector.ensureDelegateToken());

  return {
    create: (params) =>
      requireUser(async (user) => {
        const result = await api.createToken(baseUrl, user.accessToken, params);
        if (!result.ok) return result;

        const newToken = toStoredToken(result.data);

        // Auto-store if for current realm
        if (params.realm === realm) {
          if (params.type === "delegate") {
            store.setDelegate(newToken as StoredDelegateToken);
          } else {
            store.setAccess(newToken as StoredAccessToken);
          }
        }

        return { ok: true, data: newToken, status: result.status };
      }),

    list: (params) => requireUser((user) => api.listTokens(baseUrl, user.accessToken, params)),

    revoke: (tokenId) =>
      requireUser(async (user) => {
        const result = await api.revokeToken(baseUrl, user.accessToken, tokenId);
        if (!result.ok) return { ok: false, error: result.error };

        // Clear local token if it matches
        const state = store.getState();
        if (state.delegate?.tokenId === tokenId) store.setDelegate(null);
        if (state.access?.tokenId === tokenId) store.setAccess(null);

        return { ok: true, data: undefined, status: result.status };
      }),

    delegate: (params) =>
      requireDelegate(async (delegate) => {
        const result = await api.delegateToken(baseUrl, delegate.tokenBase64, params);
        if (!result.ok) return result;
        return { ok: true, data: toStoredToken(result.data), status: result.status };
      }),
  };
};

// ============================================================================
// Helpers
// ============================================================================

const toStoredToken = (response: CreateTokenResponse): StoredDelegateToken | StoredAccessToken => ({
  tokenId: response.tokenId,
  tokenBase64: response.tokenBase64,
  type: (response as { type?: "delegate" | "access" }).type ?? "delegate",
  issuerId: (response as { issuerId?: string }).issuerId ?? "",
  expiresAt: response.expiresAt,
  canUpload: (response as { canUpload?: boolean }).canUpload ?? false,
  canManageDepot: (response as { canManageDepot?: boolean }).canManageDepot ?? false,
});
