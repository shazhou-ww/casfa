/**
 * Token authentication strategy (Agent Token).
 */

import type { AuthStrategy, TokenAuthState } from "../types/auth.ts";

export type TokenAuthConfig = {
  /** Agent token value (casfa_...) */
  token: string;
};

/**
 * Create a token authentication strategy using an Agent Token.
 * This is the simplest auth strategy - just uses the provided token directly.
 */
export const createTokenAuth = (config: TokenAuthConfig): AuthStrategy => {
  const { token } = config;

  const state: TokenAuthState = {
    type: "token",
    token,
  };

  const getState = (): TokenAuthState => ({ ...state });

  const getAuthHeader = async (): Promise<string> => {
    return `Agent ${state.token}`;
  };

  const initialize = async (): Promise<void> => {
    // No initialization needed for static token
  };

  const handleUnauthorized = async (): Promise<boolean> => {
    // Cannot refresh a static token
    return false;
  };

  return {
    getState,
    getAuthHeader,
    initialize,
    handleUnauthorized,
  };
};

export type TokenAuthStrategy = ReturnType<typeof createTokenAuth>;
