/**
 * Token management methods for the stateful client.
 *
 * Root delegates no longer hold RT/AT — root operations use JWT directly.
 * The `createRoot` method ensures the root delegate entity exists on the server.
 */

import type { RootTokenResponse } from "@casfa/protocol";
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
  /** Ensure root delegate exists (User JWT required). Returns delegate metadata. */
  createRoot: (realm: string) => Promise<FetchResult<StoredRootDelegate>>;
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
  };
};

// ============================================================================
// Helpers
// ============================================================================

const toStoredRootDelegate = (response: RootTokenResponse): StoredRootDelegate => ({
  delegateId: response.delegate.delegateId,
  realm: response.delegate.realm,
  depth: response.delegate.depth,
  canUpload: response.delegate.canUpload,
  canManageDepot: response.delegate.canManageDepot,
});
