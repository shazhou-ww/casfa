/**
 * Depot API functions.
 *
 * Token Requirement:
 * - All depot operations require Access Token with canManageDepot permission.
 */

import type {
  CreateDepot,
  CreateDepotResponse,
  DepotCommit,
  DepotDetail,
  DepotListItem,
  ListDepotsQuery,
  UpdateDepot,
} from "@casfa/protocol";
import type { FetchResult } from "../types/client.ts";
import { fetchWithAuth } from "../utils/http.ts";

// ============================================================================
// Types
// ============================================================================

export type ListDepotsResponse = {
  depots: DepotListItem[];
  nextCursor?: string;
};

export type CommitDepotResponse = {
  depotId: string;
  root: string;
  updatedAt: number;
};

// ============================================================================
// Access Token APIs
// ============================================================================

/**
 * Create a new depot.
 * Requires Access Token with canManageDepot.
 */
export const createDepot = async (
  baseUrl: string,
  realm: string,
  accessTokenBase64: string,
  params: CreateDepot
): Promise<FetchResult<CreateDepotResponse>> => {
  return fetchWithAuth<CreateDepotResponse>(
    `${baseUrl}/api/realm/${encodeURIComponent(realm)}/depots`,
    `Bearer ${accessTokenBase64}`,
    {
      method: "POST",
      body: params,
    }
  );
};

/**
 * List depots.
 * Requires Access Token.
 */
export const listDepots = async (
  baseUrl: string,
  realm: string,
  accessTokenBase64: string,
  params?: ListDepotsQuery
): Promise<FetchResult<ListDepotsResponse>> => {
  const query = new URLSearchParams();
  if (params?.limit) query.set("limit", String(params.limit));
  if (params?.cursor) query.set("cursor", params.cursor);

  const queryString = query.toString();
  const url = `${baseUrl}/api/realm/${encodeURIComponent(realm)}/depots${queryString ? `?${queryString}` : ""}`;

  return fetchWithAuth<ListDepotsResponse>(url, `Bearer ${accessTokenBase64}`);
};

/**
 * Get depot details.
 * Requires Access Token.
 */
export const getDepot = async (
  baseUrl: string,
  realm: string,
  accessTokenBase64: string,
  depotId: string
): Promise<FetchResult<DepotDetail>> => {
  return fetchWithAuth<DepotDetail>(
    `${baseUrl}/api/realm/${encodeURIComponent(realm)}/depots/${encodeURIComponent(depotId)}`,
    `Bearer ${accessTokenBase64}`
  );
};

/**
 * Update depot metadata.
 * Requires Access Token with canManageDepot.
 */
export const updateDepot = async (
  baseUrl: string,
  realm: string,
  accessTokenBase64: string,
  depotId: string,
  params: UpdateDepot
): Promise<FetchResult<DepotDetail>> => {
  return fetchWithAuth<DepotDetail>(
    `${baseUrl}/api/realm/${encodeURIComponent(realm)}/depots/${encodeURIComponent(depotId)}`,
    `Bearer ${accessTokenBase64}`,
    {
      method: "PATCH",
      body: params,
    }
  );
};

/**
 * Delete a depot.
 * Requires Access Token with canManageDepot.
 */
export const deleteDepot = async (
  baseUrl: string,
  realm: string,
  accessTokenBase64: string,
  depotId: string
): Promise<FetchResult<void>> => {
  return fetchWithAuth<void>(
    `${baseUrl}/api/realm/${encodeURIComponent(realm)}/depots/${encodeURIComponent(depotId)}`,
    `Bearer ${accessTokenBase64}`,
    {
      method: "DELETE",
      responseType: "none",
    }
  );
};

/**
 * Commit new root to depot.
 * Requires Access Token with canManageDepot.
 */
export const commitDepot = async (
  baseUrl: string,
  realm: string,
  accessTokenBase64: string,
  depotId: string,
  params: DepotCommit
): Promise<FetchResult<CommitDepotResponse>> => {
  return fetchWithAuth<CommitDepotResponse>(
    `${baseUrl}/api/realm/${encodeURIComponent(realm)}/depots/${encodeURIComponent(depotId)}/commit`,
    `Bearer ${accessTokenBase64}`,
    {
      method: "POST",
      body: params,
    }
  );
};
