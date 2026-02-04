/**
 * CasfaClient - Main client factory for CASFA API.
 */

import type { ServiceInfo } from "@casfa/protocol";
import * as adminApi from "./api/admin.ts";
import * as authApi from "./api/auth.ts";
import * as depotsApi from "./api/depots.ts";
import * as infoApi from "./api/info.ts";
import * as mcpApi from "./api/mcp.ts";
import * as nodesApi from "./api/nodes.ts";
// API imports
import * as oauthApi from "./api/oauth.ts";
import * as realmApi from "./api/realm.ts";
import * as ticketsApi from "./api/tickets.ts";
import { type ApiName, assertAccess } from "./auth/permissions.ts";
import { createTicketAuth } from "./auth/ticket.ts";
import { createTokenAuth } from "./auth/token.ts";
import { createUserAuth } from "./auth/user.ts";
// Re-export types
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
} from "./types/api.ts";
import type { AuthConfig, AuthState, AuthStrategy } from "./types/auth.ts";
import type { HashProvider, StorageProvider } from "./types/providers.ts";
import type { FetchResult } from "./utils/fetch.ts";
import { createFetch } from "./utils/fetch.ts";

/**
 * Configuration for creating a CasfaClient.
 */
export type CasfaClientConfig = {
  /** Base URL of the CASFA API */
  baseUrl: string;
  /** Authentication configuration */
  auth: AuthConfig;
  /** Optional storage provider for caching nodes */
  storage?: StorageProvider;
  /** Optional hash provider for computing hashes */
  hash?: HashProvider;
  /** Default realm ID (for realm-scoped operations) */
  realmId?: string;
};

/**
 * CasfaClient instance type.
 */
export type CasfaClient = {
  // State management
  getAuthState: () => AuthState;
  getRealmId: () => string | null;
  setRealmId: (realmId: string) => void;

  // Public API (no auth required)
  getInfo: () => Promise<FetchResult<ServiceInfo>>;

  // OAuth API (mostly public)
  oauth: {
    getConfig: () => Promise<FetchResult<CognitoConfig>>;
    exchangeCode: (params: oauthApi.ExchangeCodeParams) => Promise<FetchResult<TokenResponse>>;
    login: (params: oauthApi.LoginParams) => Promise<FetchResult<TokenResponse>>;
    refresh: (params: oauthApi.RefreshParams) => Promise<FetchResult<TokenResponse>>;
    getMe: () => Promise<FetchResult<UserInfo>>;
    buildAuthUrl: (params: oauthApi.BuildAuthUrlParams) => string;
  };

  // AWP Client & Agent Token API
  auth: {
    initClient: (params: authApi.InitClientParams) => Promise<FetchResult<AwpAuthInitResponse>>;
    pollClient: (params: authApi.PollClientParams) => Promise<FetchResult<AwpAuthPollResponse>>;
    completeClient: (
      params: authApi.CompleteClientParams
    ) => Promise<FetchResult<{ success: boolean }>>;
    listClients: (
      params?: authApi.ListClientsParams
    ) => Promise<FetchResult<PaginatedResponse<AwpClientInfo>>>;
    revokeClient: (
      params: authApi.RevokeClientParams
    ) => Promise<FetchResult<{ success: boolean }>>;
    createAgentToken: (
      params: authApi.CreateAgentTokenParams
    ) => Promise<FetchResult<CreateAgentTokenResponse>>;
    listAgentTokens: (
      params?: authApi.ListAgentTokensParams
    ) => Promise<FetchResult<PaginatedResponse<AgentTokenInfo>>>;
    revokeAgentToken: (
      params: authApi.RevokeAgentTokenParams
    ) => Promise<FetchResult<{ success: boolean }>>;
  };

  // Admin API
  admin: {
    listUsers: (
      params?: adminApi.ListUsersParams
    ) => Promise<FetchResult<PaginatedResponse<UserListItem>>>;
    updateUserRole: (params: adminApi.UpdateUserRoleParams) => Promise<FetchResult<UserListItem>>;
  };

  // MCP API
  mcp: {
    call: (params: mcpApi.CallMcpParams) => Promise<FetchResult<McpResponse>>;
    listTools: () => Promise<FetchResult<McpResponse>>;
    callTool: (params: mcpApi.CallToolParams) => Promise<FetchResult<McpResponse>>;
  };

  // Realm API
  realm: {
    getInfo: () => Promise<FetchResult<RealmInfo>>;
    getUsage: () => Promise<FetchResult<RealmUsage>>;
  };

  // Ticket API
  tickets: {
    create: (params: ticketsApi.CreateTicketParams) => Promise<FetchResult<TicketInfo>>;
    list: (
      params?: ticketsApi.ListTicketsParams
    ) => Promise<FetchResult<PaginatedResponse<TicketListItem>>>;
    get: (params: ticketsApi.GetTicketParams) => Promise<FetchResult<TicketInfo>>;
    commit: (params: ticketsApi.CommitTicketParams) => Promise<FetchResult<TicketInfo>>;
    revoke: (params: ticketsApi.RevokeTicketParams) => Promise<FetchResult<TicketInfo>>;
    delete: (params: ticketsApi.DeleteTicketParams) => Promise<FetchResult<{ success: boolean }>>;
  };

  // Depot API
  depots: {
    create: (params: depotsApi.CreateDepotParams) => Promise<FetchResult<DepotInfo>>;
    list: (
      params?: depotsApi.ListDepotsParams
    ) => Promise<FetchResult<PaginatedResponse<DepotInfo>>>;
    get: (params: depotsApi.GetDepotParams) => Promise<FetchResult<DepotDetail>>;
    update: (params: depotsApi.UpdateDepotParams) => Promise<FetchResult<DepotInfo>>;
    commit: (params: depotsApi.CommitDepotParams) => Promise<FetchResult<DepotInfo>>;
    delete: (params: depotsApi.DeleteDepotParams) => Promise<FetchResult<{ success: boolean }>>;
  };

  // Node API
  nodes: {
    prepare: (params: nodesApi.PrepareNodesParams) => Promise<FetchResult<PrepareNodesResult>>;
    getMetadata: (params: nodesApi.GetNodeMetadataParams) => Promise<FetchResult<NodeMetadata>>;
    get: (params: nodesApi.GetNodeParams) => Promise<FetchResult<Uint8Array>>;
    put: (params: nodesApi.PutNodeParams) => Promise<FetchResult<{ key: string }>>;
    upload: (params: nodesApi.UploadNodeParams) => Promise<FetchResult<{ key: string }>>;
  };
};

/**
 * Create auth strategy from config.
 */
const createAuthStrategy = (config: AuthConfig): AuthStrategy => {
  switch (config.type) {
    case "user":
      return createUserAuth({ callbacks: config.callbacks });
    case "token":
      return createTokenAuth({ token: config.token });
    case "p256":
      throw new Error("P256 auth requires keyPairProvider - use createCasfaClientWithP256 instead");
    case "ticket":
      return createTicketAuth({
        ticketId: config.ticketId,
        realmId: config.realmId,
      });
  }
};

/**
 * Create a CasfaClient instance.
 */
export const createCasfaClient = (config: CasfaClientConfig): CasfaClient => {
  const { baseUrl, auth: authConfig, storage, hash, realmId } = config;

  // Create auth strategy
  const auth = createAuthStrategy(authConfig);

  // Create fetcher
  const fetcher = createFetch({ baseUrl, auth });

  // Mutable state
  let currentRealmId = realmId ?? null;

  // Helper to check permission before API call
  const withPermission = <T>(
    apiName: ApiName,
    fn: () => Promise<FetchResult<T>>
  ): Promise<FetchResult<T>> => {
    assertAccess(auth.getState(), apiName);
    return fn();
  };

  // Helper to ensure realm is set
  const requireRealm = (): string => {
    if (!currentRealmId) {
      throw new Error("Realm ID is required for this operation");
    }
    return currentRealmId;
  };

  // API contexts
  const oauthCtx: oauthApi.OAuthApiContext = { fetcher };
  const authCtx: authApi.AuthApiContext = { fetcher };
  const adminCtx: adminApi.AdminApiContext = { fetcher };
  const mcpCtx: mcpApi.McpApiContext = { fetcher };
  const infoCtx: infoApi.InfoApiContext = { fetcher };

  const getRealmCtx = (): realmApi.RealmApiContext => ({
    fetcher,
    realmId: requireRealm(),
  });

  const getTicketCtx = (): ticketsApi.TicketApiContext => ({
    fetcher,
    realmId: requireRealm(),
  });

  const getDepotCtx = (): depotsApi.DepotApiContext => ({
    fetcher,
    realmId: requireRealm(),
  });

  const getNodeCtx = (): nodesApi.NodeApiContext => ({
    fetcher,
    realmId: requireRealm(),
    storage,
    hash,
  });

  return {
    // State management
    getAuthState: () => auth.getState(),
    getRealmId: () => currentRealmId,
    setRealmId: (id: string) => {
      currentRealmId = id;
    },

    // Public API (no auth required)
    getInfo: () => infoApi.getInfo(infoCtx),

    // OAuth API
    oauth: {
      getConfig: () => withPermission("oauth.getConfig", () => oauthApi.getConfig(oauthCtx)),
      exchangeCode: (params) =>
        withPermission("oauth.exchangeCode", () => oauthApi.exchangeCode(oauthCtx, params)),
      login: (params) => withPermission("oauth.login", () => oauthApi.login(oauthCtx, params)),
      refresh: (params) =>
        withPermission("oauth.refresh", () => oauthApi.refresh(oauthCtx, params)),
      getMe: () => withPermission("oauth.getMe", () => oauthApi.getMe(oauthCtx)),
      buildAuthUrl: (params) => oauthApi.buildAuthUrl(params),
    },

    // Auth API
    auth: {
      initClient: (params) =>
        withPermission("auth.initClient", () => authApi.initClient(authCtx, params)),
      pollClient: (params) =>
        withPermission("auth.pollClient", () => authApi.pollClient(authCtx, params)),
      completeClient: (params) =>
        withPermission("auth.completeClient", () => authApi.completeClient(authCtx, params)),
      listClients: (params) =>
        withPermission("auth.listClients", () => authApi.listClients(authCtx, params)),
      revokeClient: (params) =>
        withPermission("auth.revokeClient", () => authApi.revokeClient(authCtx, params)),
      createAgentToken: (params) =>
        withPermission("auth.createAgentToken", () => authApi.createAgentToken(authCtx, params)),
      listAgentTokens: (params) =>
        withPermission("auth.listAgentTokens", () => authApi.listAgentTokens(authCtx, params)),
      revokeAgentToken: (params) =>
        withPermission("auth.revokeAgentToken", () => authApi.revokeAgentToken(authCtx, params)),
    },

    // Admin API
    admin: {
      listUsers: (params) =>
        withPermission("admin.listUsers", () => adminApi.listUsers(adminCtx, params)),
      updateUserRole: (params) =>
        withPermission("admin.updateUserRole", () => adminApi.updateUserRole(adminCtx, params)),
    },

    // MCP API
    mcp: {
      call: (params) => withPermission("mcp.call", () => mcpApi.callMcp(mcpCtx, params)),
      listTools: () => withPermission("mcp.call", () => mcpApi.listTools(mcpCtx)),
      callTool: (params) => withPermission("mcp.call", () => mcpApi.callTool(mcpCtx, params)),
    },

    // Realm API
    realm: {
      getInfo: () => withPermission("realm.getInfo", () => realmApi.getRealmInfo(getRealmCtx())),
      getUsage: () => withPermission("realm.getUsage", () => realmApi.getRealmUsage(getRealmCtx())),
    },

    // Ticket API
    tickets: {
      create: (params) =>
        withPermission("tickets.create", () => ticketsApi.createTicket(getTicketCtx(), params)),
      list: (params) =>
        withPermission("tickets.list", () => ticketsApi.listTickets(getTicketCtx(), params)),
      get: (params) =>
        withPermission("tickets.get", () => ticketsApi.getTicket(getTicketCtx(), params)),
      commit: (params) =>
        withPermission("tickets.commit", () => ticketsApi.commitTicket(getTicketCtx(), params)),
      revoke: (params) =>
        withPermission("tickets.revoke", () => ticketsApi.revokeTicket(getTicketCtx(), params)),
      delete: (params) =>
        withPermission("tickets.delete", () => ticketsApi.deleteTicket(getTicketCtx(), params)),
    },

    // Depot API
    depots: {
      create: (params) =>
        withPermission("depots.create", () => depotsApi.createDepot(getDepotCtx(), params)),
      list: (params) =>
        withPermission("depots.list", () => depotsApi.listDepots(getDepotCtx(), params)),
      get: (params) =>
        withPermission("depots.get", () => depotsApi.getDepot(getDepotCtx(), params)),
      update: (params) =>
        withPermission("depots.update", () => depotsApi.updateDepot(getDepotCtx(), params)),
      commit: (params) =>
        withPermission("depots.commit", () => depotsApi.commitDepot(getDepotCtx(), params)),
      delete: (params) =>
        withPermission("depots.delete", () => depotsApi.deleteDepot(getDepotCtx(), params)),
    },

    // Node API
    nodes: {
      prepare: (params) =>
        withPermission("nodes.prepare", () => nodesApi.prepareNodes(getNodeCtx(), params)),
      getMetadata: (params) =>
        withPermission("nodes.getMetadata", () => nodesApi.getNodeMetadata(getNodeCtx(), params)),
      get: (params) => withPermission("nodes.get", () => nodesApi.getNode(getNodeCtx(), params)),
      put: (params) => withPermission("nodes.put", () => nodesApi.putNode(getNodeCtx(), params)),
      upload: (params) =>
        withPermission("nodes.put", () => nodesApi.uploadNode(getNodeCtx(), params)),
    },
  };
};
