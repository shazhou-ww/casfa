/**
 * Token validity checks for the two-tier model.
 *
 * Root delegates use JWT directly (no AT/RT), so root-specific
 * AT validity checks have been removed.
 */

import type { StoredAccessToken, StoredUserToken, TokenState } from "../types/tokens.ts";

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
  bufferMs: number = DEFAULT_EXPIRY_BUFFER_MS
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
  windowMs: number = 5 * 60_000 // 5 minutes
): boolean => {
  if (!token) return false;
  return Date.now() + windowMs >= token.expiresAt;
};

/**
 * Check if user JWT is valid.
 */
export const isUserTokenValid = (userToken: StoredUserToken | null, bufferMs?: number): boolean => {
  return isTokenValid(userToken, bufferMs);
};

/**
 * Check if a StoredAccessToken (view) is valid.
 */
export const isStoredAccessTokenValid = (
  accessToken: StoredAccessToken | null,
  bufferMs?: number
): boolean => {
  return isTokenValid(accessToken, bufferMs);
};

// ============================================================================
// State-level Checks
// ============================================================================

/**
 * Determine if we need to obtain a root delegate.
 * Returns true if no root delegate metadata is cached.
 */
export const needsRootDelegate = (state: TokenState): boolean => {
  return state.rootDelegate === null;
};
