/**
 * Token management methods for the stateful client (new 2-tier model).
 */

import type { RefreshTokenResponse, RootTokenResponse } from "@casfa/protocol";
import * as api from "../api/index.ts";
import type { RefreshManager } from "../store/jwt-refresh.ts";
import type { TokenSelector } from "../store/token-selector.ts";
import type { TokenStore } from "../store/token-store.ts";
import type { FetchResult } from "../types/client.ts";
import type { StoredRootDelegate } from "../types/tokens.ts";
import { withUserToken } from "./helpers.ts";

// ============================================================================
// Types
// ============================================================================

export type TokenMethods = {
  /** Create root delegate + RT + AT (User JWT required) */
  createRoot: (realm: string) => Promise<FetchResult<StoredRootDelegate>>;
  /** Manually refresh tokens using current RT */
  refresh: () => Promise<FetchResult<StoredRootDelegate>>;
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
}: TokenDeps): TokenMethods => {
  const requireUser = withUserToken(() => refreshManager.ensureValidUserToken());

  return {
    createRoot: (targetRealm) =>
      requireUser(async (user) => {
        const result = await api.createRootToken(baseUrl, user.accessToken, targetRealm);
        if (!result.ok) return result;

        const rd = toStoredRootDelegate(result.data);

        // Auto-store if for current realm
        if (targetRealm === realm) {
          store.setRootDelegate(rd);
        }

        return { ok: true, data: rd, status: result.status };
      }),

    refresh: async () => {
      const state = store.getState();
      const rd = state.rootDelegate;
      if (!rd) {
        return {
          ok: false,
          error: {
            code: "NO_ROOT_DELEGATE",
            message: "No root delegate to refresh",
          },
        };
      }

      const result = await api.refreshToken(baseUrl, rd.refreshToken);
      if (!result.ok) return result;

      const updated = updateRootDelegate(rd, result.data);
      store.setRootDelegate(updated);
      return { ok: true, data: updated, status: result.status };
    },
  };
};

// ============================================================================
// Helpers
// ============================================================================

const toStoredRootDelegate = (response: RootTokenResponse): StoredRootDelegate => ({
  delegateId: response.delegate.delegateId,
  realm: response.delegate.realm,
  refreshToken: response.refreshToken,
  refreshTokenId: response.refreshTokenId,
  accessToken: response.accessToken,
  accessTokenId: response.accessTokenId,
  accessTokenExpiresAt: response.accessTokenExpiresAt,
  depth: response.delegate.depth,
  canUpload: response.delegate.canUpload,
  canManageDepot: response.delegate.canManageDepot,
});

const updateRootDelegate = (
  current: StoredRootDelegate,
  response: RefreshTokenResponse
): StoredRootDelegate => ({
  ...current,
  refreshToken: response.refreshToken,
  refreshTokenId: response.refreshTokenId,
  accessToken: response.accessToken,
  accessTokenId: response.accessTokenId,
  accessTokenExpiresAt: response.accessTokenExpiresAt,
});
