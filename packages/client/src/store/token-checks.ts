/**
 * Token validity checks for the two-tier model.
 */

import type {
  StoredAccessToken,
  StoredRootDelegate,
  StoredUserToken,
  TokenState,
} from "../types/tokens.ts";

// ============================================================================
// Validity Checks
// ============================================================================

/**
 * Default buffer time before expiration (60 seconds).
 */
export const DEFAULT_EXPIRY_BUFFER_MS = 60_000;

/**
 * Check if a token is valid (not expired with buffer).
 */
export const isTokenValid = (
  token: { expiresAt: number } | null,
  bufferMs: number = DEFAULT_EXPIRY_BUFFER_MS,
): boolean => {
  if (!token) return false;
  return Date.now() + bufferMs < token.expiresAt;
};

/**
 * Check if token is expiring soon and should be refreshed proactively.
 * Used for JWT refresh scheduling.
 */
export const isTokenExpiringSoon = (
  token: { expiresAt: number } | null,
  windowMs: number = 5 * 60_000, // 5 minutes
): boolean => {
  if (!token) return false;
  return Date.now() + windowMs >= token.expiresAt;
};

/**
 * Check if user JWT is valid.
 */
export const isUserTokenValid = (
  userToken: StoredUserToken | null,
  bufferMs?: number,
): boolean => {
  return isTokenValid(userToken, bufferMs);
};

/**
 * Check if a root delegate's access token is valid.
 */
export const isAccessTokenValid = (
  rootDelegate: StoredRootDelegate | null,
  bufferMs: number = DEFAULT_EXPIRY_BUFFER_MS,
): boolean => {
  if (!rootDelegate) return false;
  return Date.now() + bufferMs < rootDelegate.accessTokenExpiresAt;
};

/**
 * Check if a StoredAccessToken (view) is valid.
 */
export const isStoredAccessTokenValid = (
  accessToken: StoredAccessToken | null,
  bufferMs?: number,
): boolean => {
  return isTokenValid(accessToken, bufferMs);
};

/**
 * Check if root delegate has a refresh token (RT never expires independently).
 */
export const hasRefreshToken = (
  rootDelegate: StoredRootDelegate | null,
): boolean => {
  return rootDelegate !== null && rootDelegate.refreshToken.length > 0;
};

// ============================================================================
// State-level Checks
// ============================================================================

/**
 * Determine if we need to obtain a root delegate.
 * Returns true if no root delegate is present.
 */
export const needsRootDelegate = (state: TokenState): boolean => {
  return state.rootDelegate === null;
};

/**
 * Determine if access token needs refresh via RT rotation.
 * Returns true if root delegate exists but AT is expired/expiring.
 */
export const shouldRefreshAccessToken = (state: TokenState): boolean => {
  const rd = state.rootDelegate;
  if (!rd) return false;
  // AT expired or expiring within buffer
  return !isAccessTokenValid(rd);
};
