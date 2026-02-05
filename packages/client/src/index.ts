/**
 * @casfa/client - CASFA client library
 *
 * A stateful client that manages three-tier token hierarchy:
 * - User JWT: OAuth login token, highest authority
 * - Delegate Token: Re-delegation token, can issue child tokens
 * - Access Token: Data access token, used for CAS operations
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
  type DepotMethods,
  type NodeMethods,
  type OAuthMethods,
  type OnAuthRequiredCallback,
  type OnTokenChangeCallback,
  type TicketMethods,
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
  getMaxIssuerId,
  isAccessTokenFromMaxIssuer,
  isAccessTokenValid,
  isDelegateTokenFromCurrentUser,
  isDelegateTokenValid,
  isTokenExpiringSoon,
  isTokenValid,
  isUserTokenValid,
  type RefreshManager,
  shouldReissueAccessToken,
  shouldReissueDelegateToken,
  type TokenSelector,
  type TokenStore,
} from "./store/index.ts";

// ============================================================================
// Types
// ============================================================================

export type {
  ClientError,
  FetchResult,
} from "./types/client.ts";

export type {
  StoredAccessToken,
  StoredDelegateToken,
  StoredUserToken,
  TokenState,
} from "./types/tokens.ts";

export { emptyTokenState } from "./types/tokens.ts";

// ============================================================================
// API (for advanced usage)
// ============================================================================

export * as api from "./api/index.ts";
