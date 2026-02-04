/**
 * Ticket client implementation.
 *
 * Provides access to resources within a ticket's scope.
 * The ticket is bound to a specific realm at creation time.
 */

import { hashToNodeKey } from "@casfa/protocol";
import type {
  DepotDetail,
  DepotInfo,
  NodeMetadata,
  PaginatedResponse,
  PrepareNodesResult,
  RealmInfo,
  RealmUsage,
  TicketInfo,
} from "../types/api.ts";
import type { HashProvider, StorageProvider } from "../types/providers.ts";
import { createBaseClientApi } from "./base.ts";
import { createStatelessFetcher, type FetchResult, type StatelessFetcher } from "./fetcher.ts";
import type {
  CasfaTicketClient,
  ClientConfig,
  CommitTicketParams,
  GetDepotParams,
  ListDepotsParams,
  PrepareNodesParams,
  PutNodeParams,
} from "./types.ts";

/**
 * Configuration for creating a ticket client.
 */
export type TicketClientConfig = ClientConfig & {
  ticketId: string;
  realmId: string;
};

/**
 * Create node operations for a given context.
 */
const createNodeOps = (
  fetcher: StatelessFetcher,
  realmId: string,
  storage?: StorageProvider,
  hash?: HashProvider
) => ({
  prepare: async (params: PrepareNodesParams): Promise<FetchResult<PrepareNodesResult>> => {
    // Check local cache first
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

  getMetadata: (key: string): Promise<FetchResult<NodeMetadata>> =>
    fetcher.request<NodeMetadata>(`/api/realm/${realmId}/nodes/${key}/metadata`),

  get: async (key: string): Promise<FetchResult<Uint8Array>> => {
    // Check local cache first
    if (storage) {
      const cached = await storage.get(key);
      if (cached) {
        return { ok: true, data: cached, status: 200 };
      }
    }

    const result = await fetcher.downloadBinary(`/api/realm/${realmId}/nodes/${key}`);

    // Cache the result
    if (result.ok && storage) {
      await storage.put(key, result.data);
    }

    return result;
  },

  put: async (key: string, params: PutNodeParams): Promise<FetchResult<{ key: string }>> => {
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

  upload: async (data: Uint8Array): Promise<FetchResult<{ key: string }>> => {
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

    // Check if already exists
    if (storage) {
      const exists = await storage.has(key);
      if (exists) {
        return { ok: true, data: { key }, status: 200 };
      }
    }

    const headers: Record<string, string> = {};
    const result = await fetcher.uploadBinary(`/api/realm/${realmId}/nodes/${key}`, data, {
      headers,
    });

    if (result.ok && storage) {
      await storage.put(key, data);
    }

    return result as FetchResult<{ key: string }>;
  },
});

/**
 * Create a ticket-authenticated client.
 */
export const createTicketClient = (config: TicketClientConfig): CasfaTicketClient => {
  const { baseUrl, storage, hash, ticketId, realmId } = config;

  // Create fetcher with ticket auth
  const fetcher = createStatelessFetcher({
    baseUrl,
    getAuthHeader: async () => `Ticket ${ticketId}`,
  });

  // Get base client (for public APIs)
  const baseClient = createBaseClientApi({
    baseUrl,
    storage,
    hash,
    fetcher,
  });

  const nodeOps = createNodeOps(fetcher, realmId, storage, hash);

  return {
    ...baseClient,
    ticketId,
    realmId,

    realm: {
      getInfo: () => fetcher.request<RealmInfo>(`/api/realm/${realmId}`),
      getUsage: () => fetcher.request<RealmUsage>(`/api/realm/${realmId}/usage`),
    },

    ticket: {
      get: () => fetcher.request<TicketInfo>(`/api/realm/${realmId}/tickets/${ticketId}`),
      commit: (params: CommitTicketParams) =>
        fetcher.request<TicketInfo>(`/api/realm/${realmId}/tickets/${ticketId}/commit`, {
          method: "POST",
          body: { output: params.output },
        }),
    },

    depots: {
      list: (params?: ListDepotsParams) => {
        const query = new URLSearchParams();
        if (params?.cursor) query.set("cursor", params.cursor);
        if (params?.limit) query.set("limit", params.limit.toString());

        const queryStr = query.toString();
        const path = `/api/realm/${realmId}/depots${queryStr ? `?${queryStr}` : ""}`;

        return fetcher.request<PaginatedResponse<DepotInfo>>(path);
      },

      get: (depotId: string, params?: GetDepotParams) => {
        const query = new URLSearchParams();
        if (params?.maxHistory) query.set("maxHistory", params.maxHistory.toString());

        const queryStr = query.toString();
        const path = `/api/realm/${realmId}/depots/${depotId}${queryStr ? `?${queryStr}` : ""}`;

        return fetcher.request<DepotDetail>(path);
      },
    },

    nodes: nodeOps,
  };
};
