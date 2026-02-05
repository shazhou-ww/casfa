/**
 * Token types for the stateful client.
 *
 * Three-tier token hierarchy:
 * - User JWT: OAuth login token, highest authority
 * - Delegate Token: Re-delegation token, can issue child tokens
 * - Access Token: Data access token, used for CAS operations
 */

import type { TokenType } from "@casfa/protocol";

// ============================================================================
// Stored Token Types
// ============================================================================

/**
 * User JWT token with refresh capability.
 */
export type StoredUserToken = {
  /** JWT access token */
  accessToken: string;
  /** Refresh token for token renewal */
  refreshToken: string;
  /** User ID (usr_xxx format) */
  userId: string;
  /** Token expiration time (epoch ms) */
  expiresAt: number;
};

/**
 * Delegate Token (re-delegation token).
 */
export type StoredDelegateToken = {
  /** Token ID (dlt1_xxx format) */
  tokenId: string;
  /** Token binary as Base64 */
  tokenBase64: string;
  /** Token type: always "delegate" */
  type: "delegate";
  /** Issuer ID (usr_xxx or dlt1_xxx) */
  issuerId: string;
  /** Token expiration time (epoch ms) */
  expiresAt: number;
  /** Whether the token can upload nodes */
  canUpload: boolean;
  /** Whether the token can manage depots */
  canManageDepot: boolean;
};

/**
 * Access Token (data access token).
 */
export type StoredAccessToken = {
  /** Token ID (dlt1_xxx format) */
  tokenId: string;
  /** Token binary as Base64 */
  tokenBase64: string;
  /** Token type: always "access" */
  type: "access";
  /** Issuer ID (usr_xxx or dlt1_xxx) */
  issuerId: string;
  /** Token expiration time (epoch ms) */
  expiresAt: number;
  /** Whether the token can upload nodes */
  canUpload: boolean;
  /** Whether the token can manage depots */
  canManageDepot: boolean;
};

/**
 * Complete token state held by the client.
 */
export type TokenState = {
  /** User JWT (optional) */
  user: StoredUserToken | null;
  /** Delegate Token (optional) */
  delegate: StoredDelegateToken | null;
  /** Access Token (optional) */
  access: StoredAccessToken | null;
};

/**
 * Empty token state.
 */
export const emptyTokenState = (): TokenState => ({
  user: null,
  delegate: null,
  access: null,
});

// ============================================================================
// Token Requirement Types
// ============================================================================

/**
 * Token requirement for API calls.
 */
export type TokenRequirement = "none" | "user" | "delegate" | "access";

/**
 * Auth header format.
 */
export type AuthHeader = {
  Authorization: string;
};

/**
 * Get issuer ID from current state (for signing new tokens).
 * Priority: User JWT > Delegate Token
 */
export const getMaxIssuerId = (state: TokenState): string | null => {
  if (state.user) {
    return state.user.userId;
  }
  if (state.delegate) {
    return state.delegate.tokenId;
  }
  return null;
};

/**
 * Check if Access Token was issued by the current max issuer.
 */
export const isAccessTokenFromMaxIssuer = (state: TokenState): boolean => {
  if (!state.access) return false;

  const maxIssuerId = getMaxIssuerId(state);
  if (!maxIssuerId) return false;

  return state.access.issuerId === maxIssuerId;
};

/**
 * Check if Delegate Token was issued by current user.
 */
export const isDelegateTokenFromCurrentUser = (state: TokenState): boolean => {
  if (!state.delegate || !state.user) return false;
  return state.delegate.issuerId === state.user.userId;
};
