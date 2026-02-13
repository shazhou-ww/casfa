/**
 * JWT refresh management with promise deduplication.
 */

import type { OnAuthRequiredCallback } from "../types/client.ts";
import type { StoredUserToken } from "../types/tokens.ts";
import { isUserTokenValid } from "./token-checks.ts";
import type { TokenStore } from "./token-store.ts";

// ============================================================================
// Types
// ============================================================================

export type RefreshManager = {
  /**
   * Ensure user token is valid, refreshing if needed.
   * Returns the valid user token or null if refresh failed.
   */
  ensureValidUserToken: () => Promise<StoredUserToken | null>;

  /**
   * Schedule proactive refresh before expiration.
   */
  scheduleProactiveRefresh: () => void;

  /**
   * Cancel any scheduled refresh.
   */
  cancelScheduledRefresh: () => void;
};

export type RefreshManagerConfig = {
  store: TokenStore;
  baseUrl: string;
  onAuthRequired?: OnAuthRequiredCallback;
};

// ============================================================================
// Refresh API Call
// ============================================================================

type RefreshResponse = {
  accessToken: string;
  idToken?: string;
  refreshToken?: string;
  expiresIn: number;
};

const callRefreshApi = async (
  baseUrl: string,
  refreshToken: string
): Promise<RefreshResponse | null> => {
  try {
    const response = await fetch(`${baseUrl}/api/oauth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as RefreshResponse;
  } catch {
    return null;
  }
};

// ============================================================================
// Refresh Manager Factory
// ============================================================================

/**
 * Create a refresh manager for JWT token refresh.
 */
export const createRefreshManager = (config: RefreshManagerConfig): RefreshManager => {
  const { store, baseUrl, onAuthRequired } = config;

  // Promise deduplication: only one refresh in flight at a time
  let refreshPromise: Promise<StoredUserToken | null> | null = null;

  // Scheduled refresh timer
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;

  const doRefresh = async (): Promise<StoredUserToken | null> => {
    const state = store.getState();
    const userToken = state.user;

    if (!userToken?.refreshToken) {
      onAuthRequired?.();
      return null;
    }

    const result = await callRefreshApi(baseUrl, userToken.refreshToken);

    if (!result) {
      // Refresh failed, require re-auth
      store.setUser(null);
      onAuthRequired?.();
      return null;
    }

    const newUserToken: StoredUserToken = {
      accessToken: result.idToken ?? result.accessToken,
      refreshToken: result.refreshToken ?? userToken.refreshToken,
      userId: userToken.userId,
      expiresAt: Date.now() + result.expiresIn * 1000,
    };

    store.setUser(newUserToken);
    return newUserToken;
  };

  const ensureValidUserToken = async (): Promise<StoredUserToken | null> => {
    const state = store.getState();
    const userToken = state.user;

    // Check if current token is valid
    if (isUserTokenValid(userToken)) {
      return userToken;
    }

    // No user token at all
    if (!userToken) {
      return null;
    }

    // Need to refresh - use deduplication
    if (!refreshPromise) {
      refreshPromise = doRefresh().finally(() => {
        refreshPromise = null;
      });
    }

    return refreshPromise;
  };

  const scheduleProactiveRefresh = () => {
    cancelScheduledRefresh();

    const state = store.getState();
    const userToken = state.user;

    if (!userToken) return;

    // Schedule refresh 5 minutes before expiration
    const refreshTime = userToken.expiresAt - Date.now() - 5 * 60_000;

    if (refreshTime <= 0) {
      // Already expiring soon, refresh immediately
      ensureValidUserToken();
      return;
    }

    refreshTimer = setTimeout(() => {
      ensureValidUserToken().then((newToken) => {
        if (newToken) {
          // Schedule next refresh
          scheduleProactiveRefresh();
        }
      });
    }, refreshTime);
  };

  const cancelScheduledRefresh = () => {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
  };

  return {
    ensureValidUserToken,
    scheduleProactiveRefresh,
    cancelScheduledRefresh,
  };
};
