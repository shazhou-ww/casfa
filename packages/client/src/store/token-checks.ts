/**
 * Token validity and issuer consistency checks.
 */

import type {
  StoredAccessToken,
  StoredDelegateToken,
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
 * Check if delegate token is valid.
 */
export const isDelegateTokenValid = (
  delegateToken: StoredDelegateToken | null,
  bufferMs?: number
): boolean => {
  return isTokenValid(delegateToken, bufferMs);
};

/**
 * Check if access token is valid.
 */
export const isAccessTokenValid = (
  accessToken: StoredAccessToken | null,
  bufferMs?: number
): boolean => {
  return isTokenValid(accessToken, bufferMs);
};

// ============================================================================
// Issuer Consistency Checks
// ============================================================================

/**
 * Get the current max issuer ID.
 * Priority: User JWT (userId) > Delegate Token (tokenId)
 */
export const getMaxIssuerId = (state: TokenState): string | null => {
  if (state.user && isUserTokenValid(state.user)) {
    return state.user.userId;
  }
  if (state.delegate && isDelegateTokenValid(state.delegate)) {
    return state.delegate.tokenId;
  }
  return null;
};

/**
 * Check if access token is issued by the current max issuer.
 * If not, the access token should be re-issued.
 */
export const isAccessTokenFromMaxIssuer = (state: TokenState): boolean => {
  const accessToken = state.access;
  if (!accessToken || !isAccessTokenValid(accessToken)) {
    return false;
  }

  const maxIssuerId = getMaxIssuerId(state);
  if (!maxIssuerId) {
    // No valid issuer, access token is orphaned but still usable
    return true;
  }

  return accessToken.issuerId === maxIssuerId;
};

/**
 * Check if delegate token is issued by current user.
 * If user JWT exists but delegate token is from a different user,
 * we may want to re-issue the delegate token.
 */
export const isDelegateTokenFromCurrentUser = (state: TokenState): boolean => {
  const delegateToken = state.delegate;
  const userToken = state.user;

  if (!delegateToken || !isDelegateTokenValid(delegateToken)) {
    return false;
  }

  if (!userToken || !isUserTokenValid(userToken)) {
    // No user token, delegate token is the top-level authority
    return true;
  }

  return delegateToken.issuerId === userToken.userId;
};

/**
 * Determine if access token needs re-issue.
 * Returns true if:
 * - Access token is invalid/expired
 * - Access token's issuer is not the current max issuer
 */
export const shouldReissueAccessToken = (state: TokenState): boolean => {
  if (!isAccessTokenValid(state.access)) {
    return true;
  }
  if (!isAccessTokenFromMaxIssuer(state)) {
    return true;
  }
  return false;
};

/**
 * Determine if delegate token needs re-issue.
 * Returns true if:
 * - Delegate token is invalid/expired
 * - User token exists but delegate token is not from current user
 */
export const shouldReissueDelegateToken = (state: TokenState): boolean => {
  if (!isDelegateTokenValid(state.delegate)) {
    return true;
  }
  if (state.user && !isDelegateTokenFromCurrentUser(state)) {
    return true;
  }
  return false;
};
