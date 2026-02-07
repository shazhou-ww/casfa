import { http } from "./http";
import type { TokenRequestApproveParams, TokenRequestDetail, TokenRequestListItem } from "./types";

export const tokenRequestsApi = {
  /** Get a single token request by ID (no auth required for viewing) */
  get: (requestId: string) => http.get<TokenRequestDetail>(`/api/tokens/requests/${requestId}`),

  /** List pending token requests (requires JWT auth) */
  list: () => http.get<{ requests: TokenRequestListItem[] }>("/api/tokens/requests"),

  /** Approve a token request (requires JWT auth) */
  approve: (requestId: string, params: TokenRequestApproveParams) =>
    http.post<{ success: boolean; tokenId: string; expiresAt: number }>(
      `/api/tokens/requests/${requestId}/approve`,
      params
    ),

  /** Reject a token request (requires JWT auth) */
  reject: (requestId: string) =>
    http.post<{ success: boolean }>(`/api/tokens/requests/${requestId}/reject`),
};
