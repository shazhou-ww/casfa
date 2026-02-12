/**
 * @casfa/client - CASFA client library
 *
 * A stateful client that manages two-tier token hierarchy:
 * - User JWT: OAuth login token, highest authority, used for root operations
 * - Root Delegate: metadata-only entity (no RT/AT), anchor of delegate tree
 *
 * Root operations use JWT directly via the server's unified auth middleware.
 *
 * @packageDocumentation
 */

// ============================================================================
// Client
// ============================================================================

export {
  type CasfaClient,
  type ClientConfig,
  createClient,
  type DelegateMethods,
  type DepotMethods,
  type FsMethods,
  type NodeMethods,
  type OAuthMethods,
  type OnAuthRequiredCallback,
  type OnTokenChangeCallback,
  type TokenMethods,
  type TokenStorageProvider,
} from "./client/index.ts";

// ============================================================================
// Token Store
// ============================================================================

export {
  createRefreshManager,
  createTokenSelector,
  createTokenStore,
  DEFAULT_EXPIRY_BUFFER_MS,
  isStoredAccessTokenValid,
  isTokenExpiringSoon,
  isTokenValid,
  isUserTokenValid,
  needsRootDelegate,
  type RefreshManager,
  type TokenSelector,
  type TokenStore,
} from "./store/index.ts";

// ============================================================================
// Types
// ============================================================================

export type { ClientError, FetchResult } from "./types/client.ts";

export type {
  StoredAccessToken,
  StoredRootDelegate,
  StoredUserToken,
  TokenState,
} from "./types/tokens.ts";

export { emptyTokenState } from "./types/tokens.ts";

// ============================================================================
// API (for advanced usage)
// ============================================================================

export * as api from "./api/index.ts";
