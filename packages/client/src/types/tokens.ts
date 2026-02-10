/**
 * Token types for the stateful client.
 *
 * Two-tier token hierarchy:
 * - User JWT: OAuth login token, highest authority
 * - Root Delegate: RT + AT pair for realm operations (auto-refreshed)
 *
 * The client holds at most one User JWT and one Root Delegate at a time.
 * Child delegates are created via the Delegate API and returned to callers
 * (not stored in the client's token state).
 */

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
 * Root Delegate with Refresh Token + Access Token pair.
 *
 * Created via POST /api/tokens/root (JWT → Root Delegate + RT + AT).
 * The RT is used to rotate AT when it expires (POST /api/tokens/refresh).
 */
export type StoredRootDelegate = {
  /** Delegate entity ID */
  delegateId: string;
  /** Realm this delegate belongs to */
  realm: string;
  /** Refresh Token (base64-encoded 128-byte binary) */
  refreshToken: string;
  /** Refresh Token ID */
  refreshTokenId: string;
  /** Access Token (base64-encoded 128-byte binary) */
  accessToken: string;
  /** Access Token ID */
  accessTokenId: string;
  /** Access Token expiration time (epoch ms) */
  accessTokenExpiresAt: number;
  /** Delegate depth (0 = root) */
  depth: number;
  /** Whether the delegate can upload nodes */
  canUpload: boolean;
  /** Whether the delegate can manage depots */
  canManageDepot: boolean;
};

/**
 * Complete token state held by the client.
 */
export type TokenState = {
  /** User JWT (optional) */
  user: StoredUserToken | null;
  /** Root Delegate with RT + AT (optional) */
  rootDelegate: StoredRootDelegate | null;
};

/**
 * Empty token state.
 */
export const emptyTokenState = (): TokenState => ({
  user: null,
  rootDelegate: null,
});

// ============================================================================
// Token Requirement Types
// ============================================================================

/**
 * Token requirement for API calls.
 */
export type TokenRequirement = "none" | "user" | "access";

/**
 * Auth header format.
 */
export type AuthHeader = {
  Authorization: string;
};

// ============================================================================
// Compatibility Types (kept for helpers/client API surface)
// ============================================================================

/**
 * Stored Access Token — a view onto the root delegate's AT.
 * Used by client methods that need an access token for API calls.
 */
export type StoredAccessToken = {
  /** Access Token (base64-encoded) */
  tokenBase64: string;
  /** Raw 128-byte access token (for PoP computation) */
  tokenBytes: Uint8Array;
  /** Access Token ID */
  tokenId: string;
  /** Access Token expiration time (epoch ms) */
  expiresAt: number;
  /** Whether the delegate can upload nodes */
  canUpload: boolean;
  /** Whether the delegate can manage depots */
  canManageDepot: boolean;
};

/**
 * Extract a StoredAccessToken view from a StoredRootDelegate.
 */
/**
 * Decode a base64-encoded token string to raw bytes.
 * Works in both Node.js (Buffer) and browser (atob) environments.
 */
const decodeBase64 = (base64: string): Uint8Array => {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(base64, "base64"));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

export const rootDelegateToAccessToken = (rd: StoredRootDelegate): StoredAccessToken => ({
  tokenBase64: rd.accessToken,
  tokenBytes: decodeBase64(rd.accessToken),
  tokenId: rd.accessTokenId,
  expiresAt: rd.accessTokenExpiresAt,
  canUpload: rd.canUpload,
  canManageDepot: rd.canManageDepot,
});

/**
 * Check if root delegate has a valid (non-expired) access token.
 */
export const hasValidAccessToken = (state: TokenState): boolean => {
  if (!state.rootDelegate) return false;
  return state.rootDelegate.accessTokenExpiresAt > Date.now();
};
