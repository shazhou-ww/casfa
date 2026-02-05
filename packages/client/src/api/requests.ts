/**
 * Client Authorization Request API functions.
 *
 * For CLI/desktop apps to request tokens through user approval.
 */

import type {
  ApproveRequest,
  ApproveRequestResponse,
  CreateAuthRequest,
  CreateAuthRequestResponse,
  DenyRequest,
  DenyRequestResponse,
  PollRequestResponse,
} from "@casfa/protocol";
import type { FetchResult } from "../types/client.ts";
import { fetchApi, fetchWithAuth } from "../utils/http.ts";

// ============================================================================
// Public APIs (No auth required)
// ============================================================================

/**
 * Create an authorization request.
 * No auth required - called by CLI/desktop clients.
 */
export const createAuthRequest = async (
  baseUrl: string,
  params: CreateAuthRequest
): Promise<FetchResult<CreateAuthRequestResponse>> => {
  return fetchApi<CreateAuthRequestResponse>(`${baseUrl}/api/tokens/requests`, {
    method: "POST",
    body: params,
  });
};

/**
 * Poll authorization request status.
 * No auth required - called by CLI/desktop clients.
 */
export const pollAuthRequest = async (
  baseUrl: string,
  requestId: string
): Promise<FetchResult<PollRequestResponse>> => {
  return fetchApi<PollRequestResponse>(
    `${baseUrl}/api/tokens/requests/${encodeURIComponent(requestId)}/poll`
  );
};

// ============================================================================
// User JWT APIs (For approving/rejecting requests)
// ============================================================================

/**
 * Get authorization request details.
 * Requires User JWT.
 */
export const getAuthRequest = async (
  baseUrl: string,
  userAccessToken: string,
  requestId: string
): Promise<FetchResult<PollRequestResponse>> => {
  return fetchWithAuth<PollRequestResponse>(
    `${baseUrl}/api/tokens/requests/${encodeURIComponent(requestId)}`,
    `Bearer ${userAccessToken}`
  );
};

/**
 * Approve an authorization request.
 * Requires User JWT.
 */
export const approveAuthRequest = async (
  baseUrl: string,
  userAccessToken: string,
  requestId: string,
  params?: ApproveRequest
): Promise<FetchResult<ApproveRequestResponse>> => {
  return fetchWithAuth<ApproveRequestResponse>(
    `${baseUrl}/api/tokens/requests/${encodeURIComponent(requestId)}/approve`,
    `Bearer ${userAccessToken}`,
    {
      method: "POST",
      body: params ?? {},
    }
  );
};

/**
 * Reject an authorization request.
 * Requires User JWT.
 */
export const rejectAuthRequest = async (
  baseUrl: string,
  userAccessToken: string,
  requestId: string,
  params?: DenyRequest
): Promise<FetchResult<DenyRequestResponse>> => {
  return fetchWithAuth<DenyRequestResponse>(
    `${baseUrl}/api/tokens/requests/${encodeURIComponent(requestId)}/reject`,
    `Bearer ${userAccessToken}`,
    {
      method: "POST",
      body: params ?? {},
    }
  );
};
