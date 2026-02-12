/**
 * Token types for the stateful client.
 *
 * Two-tier hierarchy:
 * - User JWT: OAuth login token, highest authority, used for all root operations
 * - Root Delegate: metadata-only entity (no RT/AT), anchor of the delegate tree
 *
 * Root operations use JWT directly via the server's unified auth middleware.
 * Child delegates (created via Delegate API) use their own AT/RT pairs.
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
 * Root Delegate metadata (no RT/AT — root uses JWT directly).
 *
 * Created via POST /api/tokens/root (ensures delegate entity exists).
 * All root realm operations use the user's JWT as the Bearer token;
 * the server's unified auth middleware resolves the root delegate automatically.
 */
export type StoredRootDelegate = {
  /** Delegate entity ID */
  delegateId: string;
  /** Realm this delegate belongs to */
  realm: string;
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
  /** Root Delegate metadata (optional) */
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
// Access Token View (for client module API surface)
// ============================================================================

/**
 * Stored Access Token — used by client methods for API calls.
 *
 * In root mode: `tokenBase64` is the user's JWT string, `tokenBytes` is empty.
 * In child delegate mode: `tokenBase64` is AT base64, `tokenBytes` is raw AT bytes.
 *
 * The server's unified auth middleware detects JWT vs AT automatically.
 */
export type StoredAccessToken = {
  /** Token string (JWT or AT base64) to use in Authorization: Bearer header */
  tokenBase64: string;
  /** Raw token bytes (empty for JWT mode, 32 bytes for AT mode) */
  tokenBytes: Uint8Array;
  /** Token expiration time (epoch ms) */
  expiresAt: number;
  /** Whether the delegate can upload nodes */
  canUpload: boolean;
  /** Whether the delegate can manage depots */
  canManageDepot: boolean;
};
