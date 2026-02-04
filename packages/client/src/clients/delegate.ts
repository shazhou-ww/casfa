/**
 * Delegate client implementation.
 *
 * For agents acting on behalf of users, using either:
 * - Agent Token (casfa_...)
 * - P256 key pair (AWP client)
 *
 * This client is stateless - realmId is passed to each call.
 */

import { hashToNodeKey } from "@casfa/protocol";
import type {
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
} from "../types/api.ts";
import type { HashProvider, P256KeyPair, StorageProvider } from "../types/providers.ts";
import { createBaseClientApi } from "./base.ts";
import { createStatelessFetcher, type FetchResult, type StatelessFetcher } from "./fetcher.ts";
import type {
  CallMcpParams,
  CallToolParams,
  CasfaDelegateClient,
  CasfaDelegateRealmView,
  ClientConfig,
  CommitDepotParams,
  CreateDepotParams,
  CreateTicketParams,
  GetDepotParams,
  ListDepotsParams,
  ListTicketsParams,
  PrepareNodesParams,
  PutNodeParams,
  UpdateDepotParams,
} from "./types.ts";

// =============================================================================
// Configuration
// =============================================================================

export type DelegateClientConfig = ClientConfig &
  ({ authType: "token"; token: string } | { authType: "p256"; keyPair: P256KeyPair });

// =============================================================================
// Helpers
// =============================================================================

const bytesToHex = (bytes: Uint8Array): string => {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

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

const createRealmView = (client: CasfaDelegateClient, realmId: string): CasfaDelegateRealmView => ({
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
// Delegate Client Factory
// =============================================================================

/**
 * Create a delegate client (for agents).
 */
export const createDelegateClient = (config: DelegateClientConfig): CasfaDelegateClient => {
  const { baseUrl, storage, hash } = config;

  // Determine auth type and create fetcher
  const authType = config.authType;
  let getAuthHeader: () => Promise<string>;

  if (config.authType === "token") {
    getAuthHeader = async () => `Agent ${config.token}`;
  } else {
    // P256 auth - for now just use the public key as client ID
    // In a real implementation, you'd need to sign requests
    const publicKeyHex = bytesToHex(config.keyPair.publicKey);
    getAuthHeader = async () => `P256 ${publicKeyHex}`;
    // Note: P256 auth typically requires request signing, which would need
    // additional implementation. For now, this is a placeholder.
  }

  const fetcher = createStatelessFetcher({
    baseUrl,
    getAuthHeader,
  });

  const baseClient = createBaseClientApi({
    baseUrl,
    storage,
    hash,
    fetcher,
  });

  const nodeOps = createNodeOps(fetcher, storage, hash);

  const client: CasfaDelegateClient = {
    ...baseClient,
    authType,

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
