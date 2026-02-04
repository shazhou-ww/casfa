/**
 * AWP Client and Agent Token management API.
 */

import type {
  AgentTokenInfo,
  AwpAuthInitResponse,
  AwpAuthPollResponse,
  AwpClientInfo,
  CreateAgentTokenResponse,
  PaginatedResponse,
} from "../types/api.ts";
import type { Fetcher, FetchResult } from "../utils/fetch.ts";

/**
 * Auth API context.
 */
export type AuthApiContext = {
  fetcher: Fetcher;
};

// =============================================================================
// AWP Client Authentication
// =============================================================================

/**
 * Initialize P256 client authentication flow.
 */
export type InitClientParams = {
  publicKey: string; // Hex-encoded public key
  name?: string;
};

export const initClient = async (
  ctx: AuthApiContext,
  params: InitClientParams
): Promise<FetchResult<AwpAuthInitResponse>> => {
  return ctx.fetcher.request<AwpAuthInitResponse>("/api/auth/clients/init", {
    method: "POST",
    body: {
      pubkey: params.publicKey,
      clientName: params.name,
    },
    skipAuth: true,
  });
};

/**
 * Poll for client authorization status.
 */
export type PollClientParams = {
  clientId: string;
};

export const pollClient = async (
  ctx: AuthApiContext,
  params: PollClientParams
): Promise<FetchResult<AwpAuthPollResponse>> => {
  return ctx.fetcher.request<AwpAuthPollResponse>(`/api/auth/clients/${params.clientId}/poll`, {
    skipAuth: true,
  });
};

/**
 * Complete client authorization (called by user).
 */
export type CompleteClientParams = {
  clientId: string;
};

export const completeClient = async (
  ctx: AuthApiContext,
  params: CompleteClientParams
): Promise<FetchResult<{ success: boolean }>> => {
  return ctx.fetcher.request<{ success: boolean }>("/api/auth/clients/complete", {
    method: "POST",
    body: { clientId: params.clientId },
  });
};

/**
 * List authorized clients.
 */
export type ListClientsParams = {
  cursor?: string;
  limit?: number;
};

export const listClients = async (
  ctx: AuthApiContext,
  params: ListClientsParams = {}
): Promise<FetchResult<PaginatedResponse<AwpClientInfo>>> => {
  const query = new URLSearchParams();
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.limit) query.set("limit", params.limit.toString());

  const queryStr = query.toString();
  const path = `/api/auth/clients${queryStr ? `?${queryStr}` : ""}`;

  return ctx.fetcher.request<PaginatedResponse<AwpClientInfo>>(path);
};

/**
 * Revoke an authorized client.
 */
export type RevokeClientParams = {
  clientId: string;
};

export const revokeClient = async (
  ctx: AuthApiContext,
  params: RevokeClientParams
): Promise<FetchResult<{ success: boolean }>> => {
  return ctx.fetcher.request<{ success: boolean }>(`/api/auth/clients/${params.clientId}`, {
    method: "DELETE",
  });
};

// =============================================================================
// Agent Token Management
// =============================================================================

/**
 * Create an agent token.
 */
export type CreateAgentTokenParams = {
  name: string;
  expiresIn?: number; // seconds
};

export const createAgentToken = async (
  ctx: AuthApiContext,
  params: CreateAgentTokenParams
): Promise<FetchResult<CreateAgentTokenResponse>> => {
  return ctx.fetcher.request<CreateAgentTokenResponse>("/api/auth/tokens", {
    method: "POST",
    body: params,
  });
};

/**
 * List agent tokens.
 */
export type ListAgentTokensParams = {
  cursor?: string;
  limit?: number;
};

export const listAgentTokens = async (
  ctx: AuthApiContext,
  params: ListAgentTokensParams = {}
): Promise<FetchResult<PaginatedResponse<AgentTokenInfo>>> => {
  const query = new URLSearchParams();
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.limit) query.set("limit", params.limit.toString());

  const queryStr = query.toString();
  const path = `/api/auth/tokens${queryStr ? `?${queryStr}` : ""}`;

  return ctx.fetcher.request<PaginatedResponse<AgentTokenInfo>>(path);
};

/**
 * Revoke an agent token.
 */
export type RevokeAgentTokenParams = {
  tokenId: string;
};

export const revokeAgentToken = async (
  ctx: AuthApiContext,
  params: RevokeAgentTokenParams
): Promise<FetchResult<{ success: boolean }>> => {
  return ctx.fetcher.request<{ success: boolean }>(`/api/auth/tokens/${params.tokenId}`, {
    method: "DELETE",
  });
};
