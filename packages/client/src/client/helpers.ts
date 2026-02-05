/**
 * Client helper functions for reducing boilerplate.
 */

import type { FetchResult } from "../types/client.ts";
import type { StoredAccessToken, StoredDelegateToken, StoredUserToken } from "../types/tokens.ts";

// ============================================================================
// Error Constants
// ============================================================================

export const ERRORS = {
  USER_REQUIRED: { code: "UNAUTHORIZED", message: "User login required" },
  DELEGATE_REQUIRED: { code: "FORBIDDEN", message: "Delegate token required" },
  ACCESS_REQUIRED: { code: "FORBIDDEN", message: "Access token required" },
} as const;

// ============================================================================
// Token Guards
// ============================================================================

export type TokenGetter<T> = () => Promise<T | null>;

/**
 * Higher-order function for token-required operations.
 * Reduces repetitive null checks and error returns.
 */
export const withToken = <T>(
  getToken: TokenGetter<T>,
  error: { code: string; message: string }
) => {
  return <R>(fn: (token: T) => Promise<FetchResult<R>>): Promise<FetchResult<R>> =>
    getToken().then((token) =>
      token ? fn(token) : Promise.resolve({ ok: false as const, error })
    );
};

export const withUserToken = (getToken: TokenGetter<StoredUserToken>) =>
  withToken(getToken, ERRORS.USER_REQUIRED);

export const withDelegateToken = (getToken: TokenGetter<StoredDelegateToken>) =>
  withToken(getToken, ERRORS.DELEGATE_REQUIRED);

export const withAccessToken = (getToken: TokenGetter<StoredAccessToken>) =>
  withToken(getToken, ERRORS.ACCESS_REQUIRED);
