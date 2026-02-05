/**
 * casfa-client-v2 - CASFA client library with unified authorization strategies
 *
 * @packageDocumentation
 */

// =============================================================================
// New Stateful Client (Recommended)
// =============================================================================

export {
  type CasfaClient,
  createStatefulClient,
  type DepotMethods,
  type NodeMethods,
  type OAuthMethods,
  type TicketMethods,
  type TokenMethods,
} from "./stateful-client.ts";
// Store utilities
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
// Stateful client types
export type {
  ClientConfig,
  ClientContext,
  ClientError,
  FetchResult as StatefulFetchResult,
  OnAuthRequiredCallback,
  OnTokenChangeCallback,
  TokenStorageProvider,
} from "./types/client.ts";
export type {
  StoredAccessToken,
  StoredDelegateToken,
  StoredUserToken,
  TokenRequirement,
  TokenState,
} from "./types/tokens.ts";
export { emptyTokenState } from "./types/tokens.ts";

// =============================================================================
// Stateless Client Architecture (Previous generation)
// =============================================================================

export {
  // API parameter types
  type BuildAuthUrlParams,
  type CallMcpParams,
  type CallToolParams,
  type CasfaAnonymousClient,
  type CasfaBaseClient,
  type CasfaDelegateClient,
  type CasfaDelegateRealmView,
  type CasfaTicketClient,
  type CasfaUserClient,
  type CasfaUserRealmView,
  // Types
  type ClientConfig as StatelessClientConfig,
  type CommitDepotParams,
  type CommitTicketParams,
  type CompleteClientParams,
  type CreateAgentTokenParams,
  type CreateDepotParams,
  type CreateTicketParams,
  // Main entry point
  createCasfaClient as createStatelessClient,
  createDelegateClient,
  // Individual client factories
  createTicketClient,
  createUserClient,
  type DelegateClientConfig,
  type ExchangeCodeParams,
  type GetDepotParams,
  type InitClientParams,
  type ListAgentTokensParams,
  type ListClientsParams,
  type ListDepotsParams,
  type ListTicketsParams,
  type ListUsersParams,
  type LoginParams,
  type PollClientParams,
  type PrepareNodesParams,
  type PutNodeParams,
  type RefreshParams,
  type RevokeAgentTokenParams,
  type RevokeClientParams,
  type TicketClientConfig,
  type UpdateDepotParams,
  type UpdateUserRoleParams,
  type UserClientConfig,
} from "./clients/index.ts";

// =============================================================================
// Legacy Client (Deprecated)
// =============================================================================

export {
  type CasfaClient as LegacyCasfaClient,
  type CasfaClientConfig as LegacyCasfaClientConfig,
  /** @deprecated Use createStatefulClient instead */
  createCasfaClient as createLegacyCasfaClient,
} from "./client.ts";

// =============================================================================
// Types
// =============================================================================

// API types
export type {
  // Response types
  AgentTokenInfo,
  // Re-exports from casfa-protocol
  AwpAuthComplete,
  AwpAuthInit,
  AwpAuthInitResponse,
  AwpAuthPollResponse,
  AwpClientInfo,
  CognitoConfig,
  CreateAgentToken,
  CreateAgentTokenResponse,
  CreateDepot,
  CreateTicket,
  DepotCommit,
  DepotDetail,
  DepotHistoryEntry,
  DepotInfo,
  DictNodeMetadata,
  FileNodeMetadata,
  ListDepotsQuery,
  ListTicketsQuery,
  Login,
  McpRequest,
  McpResponse,
  NodeKind,
  NodeMetadata,
  NodeUploadResponse,
  PaginatedResponse,
  PaginationQuery,
  PrepareNodes,
  PrepareNodesResponse,
  PrepareNodesResult,
  RealmInfo,
  RealmUsage,
  Refresh,
  SuccessorNodeMetadata,
  TicketCommit,
  TicketInfo,
  TicketListItem,
  TicketStatus,
  TokenExchange,
  TokenResponse,
  UpdateDepot,
  UpdateUserRole,
  UserInfo,
  UserListItem,
  UserRole,
  WritableConfig,
} from "./types/api.ts";
// Auth types
export type {
  AuthConfig,
  AuthState,
  AuthStrategy,
  AuthType,
  P256AuthCallbacks,
  P256AuthState,
  P256PollStatus,
  TicketAuthState,
  TokenAuthState,
  UserAuthCallbacks,
  UserAuthState,
} from "./types/auth.ts";
// Provider types
export type {
  HashProvider,
  KeyPairProvider,
  P256KeyPair,
  StorageProvider,
} from "./types/providers.ts";
export { createWebCryptoHashProvider } from "./types/providers.ts";

// =============================================================================
// Auth Strategies
// =============================================================================

export {
  createP256Auth,
  type P256AuthConfig,
  type P256AuthStrategy,
} from "./auth/p256.ts";
// Permissions
export {
  type ApiName,
  assertAccess,
  canAccess,
  checkPermission,
  getRequiredAuth,
  isPublicApi,
  type PermissionCheckResult,
} from "./auth/permissions.ts";
export {
  createTicketAuth,
  type TicketAuthConfig,
  type TicketAuthStrategy,
} from "./auth/ticket.ts";
export {
  createTokenAuth,
  type TokenAuthConfig,
  type TokenAuthStrategy,
} from "./auth/token.ts";
export {
  createUserAuth,
  type UserAuthConfig,
  type UserAuthStrategy,
} from "./auth/user.ts";

// =============================================================================
// Utils
// =============================================================================

export type {
  CasfaError,
  CasfaErrorCode,
} from "./utils/errors.ts";

export {
  createError,
  isCasfaError,
} from "./utils/errors.ts";

export type { FetchResult } from "./utils/fetch.ts";
