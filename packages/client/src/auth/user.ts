/**
 * User authentication strategy (OAuth).
 */

import type { AuthStrategy, UserAuthCallbacks, UserAuthState } from "../types/auth.ts";

export type UserAuthConfig = {
  callbacks: UserAuthCallbacks;
  /** Initial access token if already authenticated */
  initialToken?: string;
  /** Initial refresh token */
  initialRefreshToken?: string;
  /** Token expiration time (ms since epoch) */
  expiresAt?: number;
};

/**
 * Create a user authentication strategy using OAuth flow.
 */
export const createUserAuth = (config: UserAuthConfig): AuthStrategy => {
  const { callbacks, initialToken, initialRefreshToken, expiresAt } = config;

  // Internal state
  const state: UserAuthState = {
    type: "user",
    accessToken: initialToken ?? null,
    refreshToken: initialRefreshToken ?? null,
    expiresAt: expiresAt ?? null,
  };

  // Track retry state
  let isRefreshing = false;

  const getState = (): UserAuthState => ({ ...state });

  const getAuthHeader = async (): Promise<string | null> => {
    if (!state.accessToken) {
      return null;
    }
    return `Bearer ${state.accessToken}`;
  };

  const initialize = async (): Promise<void> => {
    // If we have a token and it's not expired, we're done
    if (state.accessToken && state.expiresAt) {
      const now = Date.now();
      if (now < state.expiresAt - 60000) {
        // 1 minute buffer
        return;
      }
    }

    // Try silent refresh first
    if (callbacks.onSilentRefresh) {
      const newToken = await callbacks.onSilentRefresh();
      if (newToken) {
        state.accessToken = newToken;
        return;
      }
    }

    // Fall back to interactive auth - this would be handled by handleUnauthorized
  };

  const handleUnauthorized = async (): Promise<boolean> => {
    if (isRefreshing) {
      return false;
    }
    isRefreshing = true;

    try {
      // Try silent refresh first
      if (callbacks.onSilentRefresh) {
        const newToken = await callbacks.onSilentRefresh();
        if (newToken) {
          state.accessToken = newToken;
          isRefreshing = false;
          return true;
        }
      }

      // Call onRefreshFailed to determine retry strategy
      const retryInterval = callbacks.onRefreshFailed(new Error("Token refresh failed"));

      if (retryInterval === null) {
        // No retry, need interactive auth
        // Note: The actual auth flow would be initiated by the application
        isRefreshing = false;
        return false;
      }

      // Wait and retry
      await new Promise((resolve) => setTimeout(resolve, retryInterval));

      // Try silent refresh again after waiting
      if (callbacks.onSilentRefresh) {
        const newToken = await callbacks.onSilentRefresh();
        if (newToken) {
          state.accessToken = newToken;
          isRefreshing = false;
          return true;
        }
      }

      isRefreshing = false;
      return false;
    } catch {
      isRefreshing = false;
      return false;
    }
  };

  /**
   * Update tokens after successful authentication.
   */
  const updateTokens = (accessToken: string, refreshToken?: string, newExpiresAt?: number) => {
    state.accessToken = accessToken;
    if (refreshToken) {
      state.refreshToken = refreshToken;
    }
    if (newExpiresAt) {
      state.expiresAt = newExpiresAt;
    }
  };

  return {
    getState,
    getAuthHeader,
    initialize,
    handleUnauthorized,
    // Expose updateTokens for external token management
    updateTokens,
  } as AuthStrategy & {
    updateTokens: typeof updateTokens;
  };
};

export type UserAuthStrategy = ReturnType<typeof createUserAuth>;
