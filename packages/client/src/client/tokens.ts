/**
 * Token management methods for the stateful client.
 *
 * Root delegates are auto-created by the server's auth middleware on
 * first JWT request. This module provides token refresh operations.
 */

import type { RefreshManager } from "../store/jwt-refresh.ts";
import type { TokenSelector } from "../store/token-selector.ts";
import type { TokenStore } from "../store/token-store.ts";
import type { FetchResult } from "../types/client.ts";

// ============================================================================
// Types
// ============================================================================

export type TokenMethods = {
  /** Refresh the user's JWT (OAuth token refresh). */
  refresh: () => Promise<FetchResult<void>>;
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
  refreshManager,
}: TokenDeps): TokenMethods => {
  return {
    refresh: async () => {
      try {
        await refreshManager.ensureValidUserToken();
        return { ok: true, data: undefined, status: 200 };
      } catch (err) {
        return {
          ok: false,
          error: {
            message: (err as Error).message,
            code: "REFRESH_FAILED",
          },
          status: 0,
        };
      }
    },
  };
};
