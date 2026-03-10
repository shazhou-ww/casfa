/**
 * OAuth methods for the stateful client.
 */

import * as api from "../api/index.ts";
import type { RefreshManager } from "../store/jwt-refresh.ts";
import type { TokenStore } from "../store/token-store.ts";
import type { FetchResult } from "../types/client.ts";
import { ERRORS } from "./helpers.ts";

// ============================================================================
// Types
// ============================================================================

export type OAuthMethods = {
  /** Get Cognito configuration */
  getConfig: () => Promise<FetchResult<api.CognitoConfig>>;
  /** Login with email and password */
  login: (email: string, password: string) => Promise<FetchResult<api.UserInfo>>;
  /** Exchange authorization code for tokens */
  exchangeCode: (
    code: string,
    redirectUri: string,
    codeVerifier?: string
  ) => Promise<FetchResult<api.UserInfo>>;
  /** Get current user info */
  getMe: () => Promise<FetchResult<api.UserInfo>>;
};

export type OAuthDeps = {
  baseUrl: string;
  store: TokenStore;
  refreshManager: RefreshManager;
};

// ============================================================================
// Factory
// ============================================================================

export const createOAuthMethods = ({
  baseUrl,
  store,
  refreshManager,
}: OAuthDeps): OAuthMethods => ({
  getConfig: () => api.getOAuthConfig(baseUrl),

  login: async (email, password) => {
    const result = await api.login(baseUrl, { email, password });
    if (!result.ok) return result;

    const meResult = await api.getMe(baseUrl, result.data.accessToken);
    if (!meResult.ok) return meResult;

    store.setUser(api.tokenResponseToStoredUserToken(result.data, meResult.data.userId));
    refreshManager.scheduleProactiveRefresh();
    return meResult;
  },

  exchangeCode: async (code, redirectUri, codeVerifier) => {
    const result = await api.exchangeCode(baseUrl, {
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    });
    if (!result.ok) return result;

    const meResult = await api.getMe(baseUrl, result.data.accessToken);
    if (!meResult.ok) return meResult;

    store.setUser(api.tokenResponseToStoredUserToken(result.data, meResult.data.userId));
    refreshManager.scheduleProactiveRefresh();
    return meResult;
  },

  getMe: async () => {
    const user = await refreshManager.ensureValidUserToken();
    if (!user) {
      return { ok: false, error: ERRORS.USER_REQUIRED };
    }
    return api.getMe(baseUrl, user.accessToken);
  },
});
