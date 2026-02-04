/**
 * User client implementation.
 *
 * Full user access with JWT authentication.
 * Includes all delegate capabilities plus user-specific operations
 * like client management, token management, and admin functions.
 */

import { hashToNodeKey } from "@casfa/protocol";
import type {
  AgentTokenInfo,
  AwpClientInfo,
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
  UserInfo,
  UserListItem,
} from "../types/api.ts";
import type { HashProvider, StorageProvider } from "../types/providers.ts";
import { createBaseClientApi } from "./base.ts";
import { createStatelessFetcher, type FetchResult, type StatelessFetcher } from "./fetcher.ts";
import type {
  CallMcpParams,
  CallToolParams,
  CasfaUserClient,
  CasfaUserRealmView,
  ClientConfig,
  CommitDepotParams,
  CompleteClientParams,
  CreateAgentTokenParams,
  CreateDepotParams,
  CreateTicketParams,
  GetDepotParams,
  ListAgentTokensParams,
  ListClientsParams,
  ListDepotsParams,
  ListTicketsParams,
  ListUsersParams,
  PrepareNodesParams,
  PutNodeParams,
  RevokeAgentTokenParams,
  RevokeClientParams,
  UpdateDepotParams,
  UpdateUserRoleParams,
} from "./types.ts";

// =============================================================================
// Configuration
// =============================================================================

export type UserClientConfig = ClientConfig & {
  accessToken: string;
  refreshToken?: string;
  /** Callback to refresh the token when it expires */
  onTokenRefresh?: (newToken: string) => void;
};

// =============================================================================
// Helpers
// =============================================================================

/**
 * Create node operations for a given fetcher.
 */
const createNodeOps = (
  fetcher: StatelessFetcher,
  storage?: StorageProvider,
  hash?: HashProvider
) => ({
  prepare: async (
    realmId: string,
    params: PrepareNodesParams
  ): Promise<FetchResult<PrepareNodesResult>> => {
    const keysToCheck: string[] = [];
    const cachedKeys: string[] = [];

    if (storage) {
      for (const key of params.keys) {
        const exists = await storage.has(key);
        if (exists) {
          cachedKeys.push(key);
        } else {
          keysToCheck.push(key);
        }
      }
    } else {
      keysToCheck.push(...params.keys);
    }

    if (keysToCheck.length === 0) {
      return {
        ok: true,
        data: { exists: params.keys, missing: [] },
        status: 200,
      };
    }

    const result = await fetcher.request<PrepareNodesResult>(
      `/api/realm/${realmId}/prepare-nodes`,
      {
        method: "POST",
        body: { keys: keysToCheck },
      }
    );

    if (!result.ok) return result;

    return {
      ok: true,
      data: {
        exists: [...cachedKeys, ...result.data.exists],
        missing: result.data.missing,
      },
      status: result.status,
    };
  },

  getMetadata: (realmId: string, key: string): Promise<FetchResult<NodeMetadata>> =>
    fetcher.request<NodeMetadata>(`/api/realm/${realmId}/nodes/${key}/metadata`),

  get: async (realmId: string, key: string): Promise<FetchResult<Uint8Array>> => {
    if (storage) {
      const cached = await storage.get(key);
      if (cached) {
        return { ok: true, data: cached, status: 200 };
      }
    }

    const result = await fetcher.downloadBinary(`/api/realm/${realmId}/nodes/${key}`);

    if (result.ok && storage) {
      await storage.put(key, result.data);
    }

    return result;
  },

  put: async (
    realmId: string,
    key: string,
    params: PutNodeParams
  ): Promise<FetchResult<{ key: string }>> => {
    const headers: Record<string, string> = {};

    if (params.contentMd5) {
      headers["Content-MD5"] = params.contentMd5;
    }
    if (params.blake3Hash) {
      headers["X-CAS-Blake3"] = params.blake3Hash;
    }

    const result = await fetcher.uploadBinary(`/api/realm/${realmId}/nodes/${key}`, params.data, {
      headers,
    });

    if (result.ok && storage) {
      await storage.put(key, params.data);
    }

    return result as FetchResult<{ key: string }>;
  },

  upload: async (realmId: string, data: Uint8Array): Promise<FetchResult<{ key: string }>> => {
    if (!hash?.blake3) {
      return {
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "HashProvider with blake3 required for upload",
        },
      };
    }

    // Compute BLAKE3 128-bit hash (16 bytes)
    const fullHash = await hash.blake3(data);
    const hash128 = fullHash.slice(0, 16);
    const key = hashToNodeKey(hash128);

    if (storage) {
      const exists = await storage.has(key);
      if (exists) {
        return { ok: true, data: { key }, status: 200 };
      }
    }

    const result = await fetcher.uploadBinary(`/api/realm/${realmId}/nodes/${key}`, data, {});

    if (result.ok && storage) {
      await storage.put(key, data);
    }

    return result as FetchResult<{ key: string }>;
  },
});

// =============================================================================
// Realm View (convenience wrapper)
// =============================================================================

const createRealmView = (client: CasfaUserClient, realmId: string): CasfaUserRealmView => ({
  realmId,
  client,

  realm: {
    getInfo: () => client.realm.getInfo(realmId),
    getUsage: () => client.realm.getUsage(realmId),
  },

  tickets: {
    create: (params) => client.tickets.create(realmId, params),
    list: (params) => client.tickets.list(realmId, params),
    get: (ticketId) => client.tickets.get(realmId, ticketId),
    revoke: (ticketId) => client.tickets.revoke(realmId, ticketId),
    delete: (ticketId) => client.tickets.delete(realmId, ticketId),
  },

  depots: {
    create: (params) => client.depots.create(realmId, params),
    list: (params) => client.depots.list(realmId, params),
    get: (depotId, params) => client.depots.get(realmId, depotId, params),
    update: (depotId, params) => client.depots.update(realmId, depotId, params),
    commit: (depotId, params) => client.depots.commit(realmId, depotId, params),
    delete: (depotId) => client.depots.delete(realmId, depotId),
  },

  nodes: {
    prepare: (params) => client.nodes.prepare(realmId, params),
    getMetadata: (key) => client.nodes.getMetadata(realmId, key),
    get: (key) => client.nodes.get(realmId, key),
    put: (key, params) => client.nodes.put(realmId, key, params),
    upload: (data) => client.nodes.upload(realmId, data),
  },
});

// =============================================================================
// User Client Factory
// =============================================================================

/**
 * Create a user-authenticated client.
 */
export const createUserClient = (config: UserClientConfig): CasfaUserClient => {
  const { baseUrl, storage, hash, accessToken } = config;

  const fetcher = createStatelessFetcher({
    baseUrl,
    getAuthHeader: async () => `Bearer ${accessToken}`,
  });

  const baseClient = createBaseClientApi({
    baseUrl,
    storage,
    hash,
    fetcher,
  });

  const nodeOps = createNodeOps(fetcher, storage, hash);

  const client: CasfaUserClient = {
    ...baseClient,

    getMe: () => fetcher.request<UserInfo>("/api/oauth/me"),

    mcp: {
      call: (params: CallMcpParams) =>
        fetcher.request<McpResponse>("/api/mcp", {
          method: "POST",
          body: {
            jsonrpc: "2.0",
            id: params.id ?? Date.now(),
            method: params.method,
            params: params.params,
          },
        }),

      listTools: () =>
        fetcher.request<McpResponse>("/api/mcp", {
          method: "POST",
          body: {
            jsonrpc: "2.0",
            id: Date.now(),
            method: "tools/list",
          },
        }),

      callTool: (params: CallToolParams) =>
        fetcher.request<McpResponse>("/api/mcp", {
          method: "POST",
          body: {
            jsonrpc: "2.0",
            id: Date.now(),
            method: "tools/call",
            params: {
              name: params.name,
              arguments: params.arguments,
            },
          },
        }),
    },

    clients: {
      complete: (params: CompleteClientParams) =>
        fetcher.request<{ success: boolean }>("/api/auth/clients/complete", {
          method: "POST",
          body: {
            clientId: params.clientId,
            verificationCode: params.verificationCode,
          },
        }),

      list: (params?: ListClientsParams) => {
        const query = new URLSearchParams();
        if (params?.cursor) query.set("cursor", params.cursor);
        if (params?.limit) query.set("limit", params.limit.toString());

        const queryStr = query.toString();
        return fetcher.request<PaginatedResponse<AwpClientInfo>>(
          `/api/auth/clients${queryStr ? `?${queryStr}` : ""}`
        );
      },

      revoke: (params: RevokeClientParams) =>
        fetcher.request<{ success: boolean }>(`/api/auth/clients/${params.clientId}`, {
          method: "DELETE",
        }),
    },

    agentTokens: {
      create: (params: CreateAgentTokenParams) =>
        fetcher.request<CreateAgentTokenResponse>("/api/auth/tokens", {
          method: "POST",
          body: params,
        }),

      list: (params?: ListAgentTokensParams) => {
        const query = new URLSearchParams();
        if (params?.cursor) query.set("cursor", params.cursor);
        if (params?.limit) query.set("limit", params.limit.toString());

        const queryStr = query.toString();
        return fetcher.request<PaginatedResponse<AgentTokenInfo>>(
          `/api/auth/tokens${queryStr ? `?${queryStr}` : ""}`
        );
      },

      revoke: (params: RevokeAgentTokenParams) =>
        fetcher.request<{ success: boolean }>(`/api/auth/tokens/${params.tokenId}`, {
          method: "DELETE",
        }),
    },

    admin: {
      listUsers: (params?: ListUsersParams) => {
        const query = new URLSearchParams();
        if (params?.cursor) query.set("cursor", params.cursor);
        if (params?.limit) query.set("limit", params.limit.toString());
        if (params?.role) query.set("role", params.role);

        const queryStr = query.toString();
        return fetcher.request<PaginatedResponse<UserListItem>>(
          `/api/admin/users${queryStr ? `?${queryStr}` : ""}`
        );
      },

      updateUserRole: (userId: string, params: UpdateUserRoleParams) =>
        fetcher.request<UserListItem>(`/api/admin/users/${userId}`, {
          method: "PATCH",
          body: { role: params.role },
        }),
    },

    realm: {
      getInfo: (realmId: string) => fetcher.request<RealmInfo>(`/api/realm/${realmId}`),
      getUsage: (realmId: string) => fetcher.request<RealmUsage>(`/api/realm/${realmId}/usage`),
    },

    tickets: {
      create: (realmId: string, params?: CreateTicketParams) =>
        fetcher.request<TicketInfo>(`/api/realm/${realmId}/tickets`, {
          method: "POST",
          body: params ?? {},
        }),

      list: (realmId: string, params?: ListTicketsParams) => {
        const query = new URLSearchParams();
        if (params?.cursor) query.set("cursor", params.cursor);
        if (params?.limit) query.set("limit", params.limit.toString());
        if (params?.status) query.set("status", params.status);

        const queryStr = query.toString();
        return fetcher.request<PaginatedResponse<TicketListItem>>(
          `/api/realm/${realmId}/tickets${queryStr ? `?${queryStr}` : ""}`
        );
      },

      get: (realmId: string, ticketId: string) =>
        fetcher.request<TicketInfo>(`/api/realm/${realmId}/tickets/${ticketId}`),

      revoke: (realmId: string, ticketId: string) =>
        fetcher.request<TicketInfo>(`/api/realm/${realmId}/tickets/${ticketId}/revoke`, {
          method: "POST",
        }),

      delete: (realmId: string, ticketId: string) =>
        fetcher.request<{ success: boolean }>(`/api/realm/${realmId}/tickets/${ticketId}`, {
          method: "DELETE",
        }),
    },

    depots: {
      create: (realmId: string, params?: CreateDepotParams) =>
        fetcher.request<DepotInfo>(`/api/realm/${realmId}/depots`, {
          method: "POST",
          body: params ?? {},
        }),

      list: (realmId: string, params?: ListDepotsParams) => {
        const query = new URLSearchParams();
        if (params?.cursor) query.set("cursor", params.cursor);
        if (params?.limit) query.set("limit", params.limit.toString());

        const queryStr = query.toString();
        return fetcher.request<PaginatedResponse<DepotInfo>>(
          `/api/realm/${realmId}/depots${queryStr ? `?${queryStr}` : ""}`
        );
      },

      get: (realmId: string, depotId: string, params?: GetDepotParams) => {
        const query = new URLSearchParams();
        if (params?.maxHistory) query.set("maxHistory", params.maxHistory.toString());

        const queryStr = query.toString();
        return fetcher.request<DepotDetail>(
          `/api/realm/${realmId}/depots/${depotId}${queryStr ? `?${queryStr}` : ""}`
        );
      },

      update: (realmId: string, depotId: string, params: UpdateDepotParams) =>
        fetcher.request<DepotInfo>(`/api/realm/${realmId}/depots/${depotId}`, {
          method: "PATCH",
          body: params,
        }),

      commit: (realmId: string, depotId: string, params: CommitDepotParams) =>
        fetcher.request<DepotInfo>(`/api/realm/${realmId}/depots/${depotId}/commit`, {
          method: "POST",
          body: params,
        }),

      delete: (realmId: string, depotId: string) =>
        fetcher.request<{ success: boolean }>(`/api/realm/${realmId}/depots/${depotId}`, {
          method: "DELETE",
        }),
    },

    nodes: nodeOps,

    withRealm: (realmId: string) => createRealmView(client, realmId),
  };

  return client;
};
