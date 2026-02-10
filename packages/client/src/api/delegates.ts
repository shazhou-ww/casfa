/**
 * Delegate management API functions.
 *
 * Token Requirement:
 * - All delegate operations require Access Token.
 *
 * Routes:
 * - POST /api/realm/{realmId}/delegates — create child delegate
 * - GET /api/realm/{realmId}/delegates — list delegates
 * - GET /api/realm/{realmId}/delegates/:delegateId — get delegate detail
 * - POST /api/realm/{realmId}/delegates/:delegateId/revoke — revoke delegate
 */

import type {
  CreateDelegateRequest,
  CreateDelegateResponse,
  DelegateDetail,
  DelegateListItem,
  ListDelegatesQuery,
  RevokeDelegateResponse,
} from "@casfa/protocol";
import type { FetchResult } from "../types/client.ts";
import { fetchWithAuth } from "../utils/http.ts";

// ============================================================================
// Types
// ============================================================================

export type ListDelegatesResponse = {
  delegates: DelegateListItem[];
  nextCursor?: string;
};

// ============================================================================
// Access Token APIs
// ============================================================================

/**
 * Create a child delegate.
 * Requires Access Token from parent delegate.
 */
export const createDelegate = async (
  baseUrl: string,
  realm: string,
  accessTokenBase64: string,
  params: CreateDelegateRequest
): Promise<FetchResult<CreateDelegateResponse>> => {
  return fetchWithAuth<CreateDelegateResponse>(
    `${baseUrl}/api/realm/${encodeURIComponent(realm)}/delegates`,
    `Bearer ${accessTokenBase64}`,
    {
      method: "POST",
      body: params,
    }
  );
};

/**
 * List child delegates.
 * Requires Access Token.
 */
export const listDelegates = async (
  baseUrl: string,
  realm: string,
  accessTokenBase64: string,
  params?: ListDelegatesQuery
): Promise<FetchResult<ListDelegatesResponse>> => {
  const query = new URLSearchParams();
  if (params?.limit) query.set("limit", String(params.limit));
  if (params?.cursor) query.set("cursor", params.cursor);
  if (params?.includeRevoked) query.set("includeRevoked", "true");

  const queryString = query.toString();
  const url = `${baseUrl}/api/realm/${encodeURIComponent(realm)}/delegates${queryString ? `?${queryString}` : ""}`;

  return fetchWithAuth<ListDelegatesResponse>(url, `Bearer ${accessTokenBase64}`);
};

/**
 * Get delegate details.
 * Requires Access Token.
 */
export const getDelegate = async (
  baseUrl: string,
  realm: string,
  accessTokenBase64: string,
  delegateId: string
): Promise<FetchResult<DelegateDetail>> => {
  return fetchWithAuth<DelegateDetail>(
    `${baseUrl}/api/realm/${encodeURIComponent(realm)}/delegates/${encodeURIComponent(delegateId)}`,
    `Bearer ${accessTokenBase64}`
  );
};

/**
 * Revoke a delegate.
 * Requires Access Token.
 */
export const revokeDelegate = async (
  baseUrl: string,
  realm: string,
  accessTokenBase64: string,
  delegateId: string
): Promise<FetchResult<RevokeDelegateResponse>> => {
  return fetchWithAuth<RevokeDelegateResponse>(
    `${baseUrl}/api/realm/${encodeURIComponent(realm)}/delegates/${encodeURIComponent(delegateId)}/revoke`,
    `Bearer ${accessTokenBase64}`,
    {
      method: "POST",
    }
  );
};
