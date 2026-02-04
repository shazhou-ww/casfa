/**
 * Depot API functions.
 */

import type {
  CreateDepot,
  DepotDetail,
  DepotInfo,
  PaginatedResponse,
  UpdateDepot,
} from "../types/api.ts";
import type { Fetcher, FetchResult } from "../utils/fetch.ts";

/**
 * Depot API context.
 */
export type DepotApiContext = {
  fetcher: Fetcher;
  realmId: string;
};

/**
 * Create a new depot.
 */
export type CreateDepotParams = {
  title?: string;
  maxHistory?: number;
};

export const createDepot = async (
  ctx: DepotApiContext,
  params: CreateDepotParams = {}
): Promise<FetchResult<DepotInfo>> => {
  const body: Partial<CreateDepot> = {};
  if (params.title !== undefined) body.title = params.title;
  if (params.maxHistory !== undefined) body.maxHistory = params.maxHistory;

  return ctx.fetcher.request<DepotInfo>(`/api/realm/${ctx.realmId}/depots`, {
    method: "POST",
    body,
  });
};

/**
 * List depots.
 */
export type ListDepotsParams = {
  cursor?: string;
  limit?: number;
};

export const listDepots = async (
  ctx: DepotApiContext,
  params: ListDepotsParams = {}
): Promise<FetchResult<PaginatedResponse<DepotInfo>>> => {
  const query = new URLSearchParams();
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.limit) query.set("limit", params.limit.toString());

  const queryStr = query.toString();
  const path = `/api/realm/${ctx.realmId}/depots${queryStr ? `?${queryStr}` : ""}`;

  return ctx.fetcher.request<PaginatedResponse<DepotInfo>>(path);
};

/**
 * Get depot details with history.
 */
export type GetDepotParams = {
  depotId: string;
  maxHistory?: number;
};

export const getDepot = async (
  ctx: DepotApiContext,
  params: GetDepotParams
): Promise<FetchResult<DepotDetail>> => {
  const query = new URLSearchParams();
  if (params.maxHistory) query.set("maxHistory", params.maxHistory.toString());

  const queryStr = query.toString();
  const path = `/api/realm/${ctx.realmId}/depots/${params.depotId}${queryStr ? `?${queryStr}` : ""}`;

  return ctx.fetcher.request<DepotDetail>(path);
};

/**
 * Update depot metadata.
 */
export type UpdateDepotParams = {
  depotId: string;
  title?: string;
  maxHistory?: number;
};

export const updateDepot = async (
  ctx: DepotApiContext,
  params: UpdateDepotParams
): Promise<FetchResult<DepotInfo>> => {
  const body: UpdateDepot = {};
  if (params.title !== undefined) body.title = params.title;
  if (params.maxHistory !== undefined) body.maxHistory = params.maxHistory;

  return ctx.fetcher.request<DepotInfo>(`/api/realm/${ctx.realmId}/depots/${params.depotId}`, {
    method: "PATCH",
    body,
  });
};

/**
 * Commit new root to depot.
 */
export type CommitDepotParams = {
  depotId: string;
  root: string;
  message?: string;
  expectedRoot?: string; // For optimistic locking
};

export const commitDepot = async (
  ctx: DepotApiContext,
  params: CommitDepotParams
): Promise<FetchResult<DepotInfo>> => {
  return ctx.fetcher.request<DepotInfo>(
    `/api/realm/${ctx.realmId}/depots/${params.depotId}/commit`,
    {
      method: "POST",
      body: {
        root: params.root,
        message: params.message,
        expectedRoot: params.expectedRoot,
      },
    }
  );
};

/**
 * Delete a depot.
 */
export type DeleteDepotParams = {
  depotId: string;
};

export const deleteDepot = async (
  ctx: DepotApiContext,
  params: DeleteDepotParams
): Promise<FetchResult<{ success: boolean }>> => {
  return ctx.fetcher.request<{ success: boolean }>(
    `/api/realm/${ctx.realmId}/depots/${params.depotId}`,
    { method: "DELETE" }
  );
};
