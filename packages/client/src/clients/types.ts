/**
 * Client type definitions for the stateless, type-safe client architecture.
 *
 * Design principles:
 * - Type-safe: Only expose APIs that are valid for the current auth context
 * - Stateless: No mutable state (realmId passed per call, not stored)
 * - Composable: Each client can create "realm views" for convenience
 */

import type { ServiceInfo } from "@casfa/protocol";
import type {
  AgentTokenInfo,
  AwpAuthInitResponse,
  AwpAuthPollResponse,
  AwpClientInfo,
  CognitoConfig,
  CreateAgentTokenResponse,
  DepotDetail,
  DepotInfo,
  McpResponse,
  NodeMetadata,
  PaginatedResponse,
  PrepareNodesResult,
  RealmInfo,
  RealmUsage,
  TicketInfo,
  TicketListItem,
  TokenResponse,
  UserInfo,
  UserListItem,
  WritableConfig,
} from "../types/api.ts";
import type { HashProvider, P256KeyPair, StorageProvider } from "../types/providers.ts";
import type { FetchResult } from "../utils/fetch.ts";

// =============================================================================
// Common Types
// =============================================================================

/**
 * Base configuration for all clients.
 */
export type ClientConfig = {
  /** Base URL of the CASFA API */
  baseUrl: string;
  /** Optional storage provider for caching nodes */
  storage?: StorageProvider;
  /** Optional hash provider for computing hashes */
  hash?: HashProvider;
};

// =============================================================================
// API Parameter Types (for stateless calls)
// =============================================================================

// OAuth
export type ExchangeCodeParams = {
  code: string;
  redirectUri: string;
  codeVerifier?: string;
};

export type LoginParams = {
  email: string;
  password: string;
};

export type RefreshParams = {
  refreshToken: string;
};

export type BuildAuthUrlParams = {
  config: CognitoConfig;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
};

// AWP Client
export type InitClientParams = {
  publicKey: string;
  name?: string;
};

export type PollClientParams = {
  clientId: string;
};

export type CompleteClientParams = {
  clientId: string;
  verificationCode?: string;
};

export type ListClientsParams = {
  cursor?: string;
  limit?: number;
};

export type RevokeClientParams = {
  clientId: string;
};

// Agent Token
export type CreateAgentTokenParams = {
  name: string;
  expiresIn?: number;
};

export type ListAgentTokensParams = {
  cursor?: string;
  limit?: number;
};

export type RevokeAgentTokenParams = {
  tokenId: string;
};

// Ticket
export type CreateTicketParams = {
  input?: string[];
  purpose?: string;
  writable?: WritableConfig;
  expiresIn?: number;
};

export type ListTicketsParams = {
  cursor?: string;
  limit?: number;
  status?: "active" | "committed" | "revoked" | "expired";
};

export type CommitTicketParams = {
  output: string;
};

// Depot
export type CreateDepotParams = {
  title?: string;
  maxHistory?: number;
};

export type ListDepotsParams = {
  cursor?: string;
  limit?: number;
};

export type GetDepotParams = {
  maxHistory?: number;
};

export type UpdateDepotParams = {
  title?: string;
  maxHistory?: number;
};

export type CommitDepotParams = {
  root: string;
  message?: string;
  expectedRoot?: string;
};

// Nodes
export type PrepareNodesParams = {
  keys: string[];
};

export type PutNodeParams = {
  data: Uint8Array;
  contentMd5?: string;
  blake3Hash?: string;
};

// Admin
export type ListUsersParams = {
  cursor?: string;
  limit?: number;
  role?: "unauthorized" | "authorized" | "admin";
};

export type UpdateUserRoleParams = {
  role: "unauthorized" | "authorized" | "admin";
};

// MCP
export type CallMcpParams = {
  method: string;
  params?: Record<string, unknown>;
  id?: string | number;
};

export type CallToolParams = {
  name: string;
  arguments?: Record<string, unknown>;
};

// =============================================================================
// CasfaBaseClient - Public APIs only
// =============================================================================

/**
 * Base client with public APIs that don't require authentication.
 */
export type CasfaBaseClient = {
  readonly baseUrl: string;
  readonly storage?: StorageProvider;
  readonly hash?: HashProvider;

  /** Get service information (public) */
  getInfo: () => Promise<FetchResult<ServiceInfo>>;

  /** OAuth endpoints (mostly public) */
  oauth: {
    getConfig: () => Promise<FetchResult<CognitoConfig>>;
    exchangeCode: (params: ExchangeCodeParams) => Promise<FetchResult<TokenResponse>>;
    login: (params: LoginParams) => Promise<FetchResult<TokenResponse>>;
    refresh: (params: RefreshParams) => Promise<FetchResult<TokenResponse>>;
    buildAuthUrl: (params: BuildAuthUrlParams) => string;
  };

  /** AWP Client init/poll (public) */
  awp: {
    initClient: (params: InitClientParams) => Promise<FetchResult<AwpAuthInitResponse>>;
    pollClient: (params: PollClientParams) => Promise<FetchResult<AwpAuthPollResponse>>;
  };
};

// =============================================================================
// CasfaAnonymousClient - Entry point with upgrade methods
// =============================================================================

/**
 * Anonymous client - entry point for creating authenticated clients.
 */
export type CasfaAnonymousClient = CasfaBaseClient & {
  /**
   * Create a ticket-authenticated client.
   * @param ticketId - The ticket ID
   * @param realmId - The realm ID (must match ticket's realm)
   */
  withTicket: (ticketId: string, realmId: string) => CasfaTicketClient;

  /**
   * Create a user-authenticated client with JWT tokens.
   * @param accessToken - OAuth access token (JWT)
   * @param refreshToken - Optional refresh token for auto-renewal
   */
  withUserToken: (accessToken: string, refreshToken?: string) => CasfaUserClient;

  /**
   * Create a delegate client with an agent token.
   * @param token - The agent token (casfa_...)
   */
  withDelegateToken: (token: string) => CasfaDelegateClient;

  /**
   * Create a delegate client with P256 key pair.
   * Requires prior authorization via AWP flow.
   * @param keyPair - The P256 key pair
   */
  withDelegateKeys: (keyPair: P256KeyPair) => CasfaDelegateClient;
};

// =============================================================================
// CasfaTicketClient - Ticket-scoped access
// =============================================================================

/**
 * Ticket-authenticated client.
 * Limited to operations allowed by the ticket's scope.
 * RealmId is fixed at creation time (tickets are realm-scoped).
 */
export type CasfaTicketClient = CasfaBaseClient & {
  readonly ticketId: string;
  readonly realmId: string;

  /** Realm info */
  realm: {
    getInfo: () => Promise<FetchResult<RealmInfo>>;
    getUsage: () => Promise<FetchResult<RealmUsage>>;
  };

  /** Ticket operations (self only) */
  ticket: {
    /** Get this ticket's info */
    get: () => Promise<FetchResult<TicketInfo>>;
    /** Commit output to this ticket */
    commit: (params: CommitTicketParams) => Promise<FetchResult<TicketInfo>>;
  };

  /** Depot operations (read-only unless ticket is writable) */
  depots: {
    list: (params?: ListDepotsParams) => Promise<FetchResult<PaginatedResponse<DepotInfo>>>;
    get: (depotId: string, params?: GetDepotParams) => Promise<FetchResult<DepotDetail>>;
  };

  /** Node operations */
  nodes: {
    prepare: (params: PrepareNodesParams) => Promise<FetchResult<PrepareNodesResult>>;
    getMetadata: (key: string) => Promise<FetchResult<NodeMetadata>>;
    get: (key: string) => Promise<FetchResult<Uint8Array>>;
    put: (key: string, params: PutNodeParams) => Promise<FetchResult<{ key: string }>>;
    /** Upload with automatic hash computation (requires hash provider) */
    upload: (data: Uint8Array) => Promise<FetchResult<{ key: string }>>;
  };
};

// =============================================================================
// CasfaDelegateClient - Agent acting on behalf of user
// =============================================================================

/**
 * Delegate client - for agents (Token or P256 authenticated).
 * All realm-scoped operations require realmId to be passed explicitly.
 */
export type CasfaDelegateClient = CasfaBaseClient & {
  readonly authType: "token" | "p256";

  /** MCP operations (not realm-scoped) */
  mcp: {
    call: (params: CallMcpParams) => Promise<FetchResult<McpResponse>>;
    listTools: () => Promise<FetchResult<McpResponse>>;
    callTool: (params: CallToolParams) => Promise<FetchResult<McpResponse>>;
  };

  /** Realm info */
  realm: {
    getInfo: (realmId: string) => Promise<FetchResult<RealmInfo>>;
    getUsage: (realmId: string) => Promise<FetchResult<RealmUsage>>;
  };

  /** Ticket management */
  tickets: {
    create: (realmId: string, params?: CreateTicketParams) => Promise<FetchResult<TicketInfo>>;
    list: (
      realmId: string,
      params?: ListTicketsParams
    ) => Promise<FetchResult<PaginatedResponse<TicketListItem>>>;
    get: (realmId: string, ticketId: string) => Promise<FetchResult<TicketInfo>>;
    revoke: (realmId: string, ticketId: string) => Promise<FetchResult<TicketInfo>>;
  };

  /** Depot management */
  depots: {
    create: (realmId: string, params?: CreateDepotParams) => Promise<FetchResult<DepotInfo>>;
    list: (
      realmId: string,
      params?: ListDepotsParams
    ) => Promise<FetchResult<PaginatedResponse<DepotInfo>>>;
    get: (
      realmId: string,
      depotId: string,
      params?: GetDepotParams
    ) => Promise<FetchResult<DepotDetail>>;
    update: (
      realmId: string,
      depotId: string,
      params: UpdateDepotParams
    ) => Promise<FetchResult<DepotInfo>>;
    commit: (
      realmId: string,
      depotId: string,
      params: CommitDepotParams
    ) => Promise<FetchResult<DepotInfo>>;
    delete: (realmId: string, depotId: string) => Promise<FetchResult<{ success: boolean }>>;
  };

  /** Node operations */
  nodes: {
    prepare: (
      realmId: string,
      params: PrepareNodesParams
    ) => Promise<FetchResult<PrepareNodesResult>>;
    getMetadata: (realmId: string, key: string) => Promise<FetchResult<NodeMetadata>>;
    get: (realmId: string, key: string) => Promise<FetchResult<Uint8Array>>;
    put: (
      realmId: string,
      key: string,
      params: PutNodeParams
    ) => Promise<FetchResult<{ key: string }>>;
    upload: (realmId: string, data: Uint8Array) => Promise<FetchResult<{ key: string }>>;
  };

  /**
   * Create a realm-bound view for convenience.
   * This is a lightweight wrapper, not a new client instance.
   */
  withRealm: (realmId: string) => CasfaDelegateRealmView;
};

/**
 * Realm-bound view of a delegate client.
 * Convenience wrapper that pre-fills realmId for all calls.
 */
export type CasfaDelegateRealmView = {
  readonly realmId: string;
  readonly client: CasfaDelegateClient;

  realm: {
    getInfo: () => Promise<FetchResult<RealmInfo>>;
    getUsage: () => Promise<FetchResult<RealmUsage>>;
  };

  tickets: {
    create: (params?: CreateTicketParams) => Promise<FetchResult<TicketInfo>>;
    list: (params?: ListTicketsParams) => Promise<FetchResult<PaginatedResponse<TicketListItem>>>;
    get: (ticketId: string) => Promise<FetchResult<TicketInfo>>;
    revoke: (ticketId: string) => Promise<FetchResult<TicketInfo>>;
  };

  depots: {
    create: (params?: CreateDepotParams) => Promise<FetchResult<DepotInfo>>;
    list: (params?: ListDepotsParams) => Promise<FetchResult<PaginatedResponse<DepotInfo>>>;
    get: (depotId: string, params?: GetDepotParams) => Promise<FetchResult<DepotDetail>>;
    update: (depotId: string, params: UpdateDepotParams) => Promise<FetchResult<DepotInfo>>;
    commit: (depotId: string, params: CommitDepotParams) => Promise<FetchResult<DepotInfo>>;
    delete: (depotId: string) => Promise<FetchResult<{ success: boolean }>>;
  };

  nodes: {
    prepare: (params: PrepareNodesParams) => Promise<FetchResult<PrepareNodesResult>>;
    getMetadata: (key: string) => Promise<FetchResult<NodeMetadata>>;
    get: (key: string) => Promise<FetchResult<Uint8Array>>;
    put: (key: string, params: PutNodeParams) => Promise<FetchResult<{ key: string }>>;
    upload: (data: Uint8Array) => Promise<FetchResult<{ key: string }>>;
  };
};

// =============================================================================
// CasfaUserClient - Full user access
// =============================================================================

/**
 * User-authenticated client with full permissions.
 * Can manage clients, tokens, and access all realm resources.
 */
export type CasfaUserClient = CasfaBaseClient & {
  /** Get current user info */
  getMe: () => Promise<FetchResult<UserInfo>>;

  /** MCP operations */
  mcp: {
    call: (params: CallMcpParams) => Promise<FetchResult<McpResponse>>;
    listTools: () => Promise<FetchResult<McpResponse>>;
    callTool: (params: CallToolParams) => Promise<FetchResult<McpResponse>>;
  };

  /** AWP client management */
  clients: {
    complete: (params: CompleteClientParams) => Promise<FetchResult<{ success: boolean }>>;
    list: (params?: ListClientsParams) => Promise<FetchResult<PaginatedResponse<AwpClientInfo>>>;
    revoke: (params: RevokeClientParams) => Promise<FetchResult<{ success: boolean }>>;
  };

  /** Agent token management */
  agentTokens: {
    create: (params: CreateAgentTokenParams) => Promise<FetchResult<CreateAgentTokenResponse>>;
    list: (
      params?: ListAgentTokensParams
    ) => Promise<FetchResult<PaginatedResponse<AgentTokenInfo>>>;
    revoke: (params: RevokeAgentTokenParams) => Promise<FetchResult<{ success: boolean }>>;
  };

  /** Admin operations (may fail with 403 if not admin) */
  admin: {
    listUsers: (params?: ListUsersParams) => Promise<FetchResult<PaginatedResponse<UserListItem>>>;
    updateUserRole: (
      userId: string,
      params: UpdateUserRoleParams
    ) => Promise<FetchResult<UserListItem>>;
  };

  /** Realm info */
  realm: {
    getInfo: (realmId: string) => Promise<FetchResult<RealmInfo>>;
    getUsage: (realmId: string) => Promise<FetchResult<RealmUsage>>;
  };

  /** Ticket management (user has additional permissions like delete) */
  tickets: {
    create: (realmId: string, params?: CreateTicketParams) => Promise<FetchResult<TicketInfo>>;
    list: (
      realmId: string,
      params?: ListTicketsParams
    ) => Promise<FetchResult<PaginatedResponse<TicketListItem>>>;
    get: (realmId: string, ticketId: string) => Promise<FetchResult<TicketInfo>>;
    revoke: (realmId: string, ticketId: string) => Promise<FetchResult<TicketInfo>>;
    delete: (realmId: string, ticketId: string) => Promise<FetchResult<{ success: boolean }>>;
  };

  /** Depot management */
  depots: {
    create: (realmId: string, params?: CreateDepotParams) => Promise<FetchResult<DepotInfo>>;
    list: (
      realmId: string,
      params?: ListDepotsParams
    ) => Promise<FetchResult<PaginatedResponse<DepotInfo>>>;
    get: (
      realmId: string,
      depotId: string,
      params?: GetDepotParams
    ) => Promise<FetchResult<DepotDetail>>;
    update: (
      realmId: string,
      depotId: string,
      params: UpdateDepotParams
    ) => Promise<FetchResult<DepotInfo>>;
    commit: (
      realmId: string,
      depotId: string,
      params: CommitDepotParams
    ) => Promise<FetchResult<DepotInfo>>;
    delete: (realmId: string, depotId: string) => Promise<FetchResult<{ success: boolean }>>;
  };

  /** Node operations */
  nodes: {
    prepare: (
      realmId: string,
      params: PrepareNodesParams
    ) => Promise<FetchResult<PrepareNodesResult>>;
    getMetadata: (realmId: string, key: string) => Promise<FetchResult<NodeMetadata>>;
    get: (realmId: string, key: string) => Promise<FetchResult<Uint8Array>>;
    put: (
      realmId: string,
      key: string,
      params: PutNodeParams
    ) => Promise<FetchResult<{ key: string }>>;
    upload: (realmId: string, data: Uint8Array) => Promise<FetchResult<{ key: string }>>;
  };

  /**
   * Create a realm-bound view for convenience.
   */
  withRealm: (realmId: string) => CasfaUserRealmView;
};

/**
 * Realm-bound view of a user client.
 */
export type CasfaUserRealmView = {
  readonly realmId: string;
  readonly client: CasfaUserClient;

  realm: {
    getInfo: () => Promise<FetchResult<RealmInfo>>;
    getUsage: () => Promise<FetchResult<RealmUsage>>;
  };

  tickets: {
    create: (params?: CreateTicketParams) => Promise<FetchResult<TicketInfo>>;
    list: (params?: ListTicketsParams) => Promise<FetchResult<PaginatedResponse<TicketListItem>>>;
    get: (ticketId: string) => Promise<FetchResult<TicketInfo>>;
    revoke: (ticketId: string) => Promise<FetchResult<TicketInfo>>;
    delete: (ticketId: string) => Promise<FetchResult<{ success: boolean }>>;
  };

  depots: {
    create: (params?: CreateDepotParams) => Promise<FetchResult<DepotInfo>>;
    list: (params?: ListDepotsParams) => Promise<FetchResult<PaginatedResponse<DepotInfo>>>;
    get: (depotId: string, params?: GetDepotParams) => Promise<FetchResult<DepotDetail>>;
    update: (depotId: string, params: UpdateDepotParams) => Promise<FetchResult<DepotInfo>>;
    commit: (depotId: string, params: CommitDepotParams) => Promise<FetchResult<DepotInfo>>;
    delete: (depotId: string) => Promise<FetchResult<{ success: boolean }>>;
  };

  nodes: {
    prepare: (params: PrepareNodesParams) => Promise<FetchResult<PrepareNodesResult>>;
    getMetadata: (key: string) => Promise<FetchResult<NodeMetadata>>;
    get: (key: string) => Promise<FetchResult<Uint8Array>>;
    put: (key: string, params: PutNodeParams) => Promise<FetchResult<{ key: string }>>;
    upload: (data: Uint8Array) => Promise<FetchResult<{ key: string }>>;
  };
};
