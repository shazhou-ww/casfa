/**
 * Token management API functions.
 *
 * Token Requirement:
 * - POST /api/tokens: User JWT
 * - GET /api/tokens: User JWT
 * - GET /api/tokens/:tokenId: User JWT
 * - POST /api/tokens/:tokenId/revoke: User JWT
 * - POST /api/tokens/delegate: Delegate Token
 */

import type {
  CreateToken,
  CreateTokenResponse,
  RevokeTokenResponse,
  TokenDetail,
  TokenListItem,
} from "@casfa/protocol";
import type { FetchResult } from "../../types/client.ts";
import { fetchWithAuth } from "../../utils/api-fetch.ts";

// ============================================================================
// Types
// ============================================================================

export type ListTokensParams = {
  limit?: number;
  cursor?: string;
  type?: "delegate" | "access";
};

export type ListTokensResponse = {
  tokens: TokenListItem[];
  nextCursor?: string;
};

// ============================================================================
// User JWT APIs
// ============================================================================

/**
 * Create a new Delegate Token.
 * Requires User JWT.
 */
export const createToken = async (
  baseUrl: string,
  userAccessToken: string,
  params: CreateToken
): Promise<FetchResult<CreateTokenResponse>> => {
  return fetchWithAuth<CreateTokenResponse>(`${baseUrl}/api/tokens`, `Bearer ${userAccessToken}`, {
    method: "POST",
    body: params,
  });
};

/**
 * List Delegate Tokens.
 * Requires User JWT.
 */
export const listTokens = async (
  baseUrl: string,
  userAccessToken: string,
  params?: ListTokensParams
): Promise<FetchResult<ListTokensResponse>> => {
  const query = new URLSearchParams();
  if (params?.limit) query.set("limit", String(params.limit));
  if (params?.cursor) query.set("cursor", params.cursor);
  if (params?.type) query.set("type", params.type);

  const queryString = query.toString();
  const url = `${baseUrl}/api/tokens${queryString ? `?${queryString}` : ""}`;

  return fetchWithAuth<ListTokensResponse>(url, `Bearer ${userAccessToken}`);
};

/**
 * Get token details.
 * Requires User JWT.
 */
export const getToken = async (
  baseUrl: string,
  userAccessToken: string,
  tokenId: string
): Promise<FetchResult<TokenDetail>> => {
  return fetchWithAuth<TokenDetail>(
    `${baseUrl}/api/tokens/${encodeURIComponent(tokenId)}`,
    `Bearer ${userAccessToken}`
  );
};

/**
 * Revoke a token.
 * Requires User JWT.
 */
export const revokeToken = async (
  baseUrl: string,
  userAccessToken: string,
  tokenId: string
): Promise<FetchResult<RevokeTokenResponse>> => {
  return fetchWithAuth<RevokeTokenResponse>(
    `${baseUrl}/api/tokens/${encodeURIComponent(tokenId)}/revoke`,
    `Bearer ${userAccessToken}`,
    { method: "POST" }
  );
};

// ============================================================================
// Delegate Token APIs
// ============================================================================

export type DelegateTokenParams = {
  name: string;
  type: "delegate" | "access";
  expiresIn?: number;
  canUpload?: boolean;
  canManageDepot?: boolean;
  scope?: string[];
};

/**
 * Delegate (re-issue) a token using existing Delegate Token.
 * Requires Delegate Token.
 */
export const delegateToken = async (
  baseUrl: string,
  delegateTokenBase64: string,
  params: DelegateTokenParams
): Promise<FetchResult<CreateTokenResponse>> => {
  return fetchWithAuth<CreateTokenResponse>(
    `${baseUrl}/api/tokens/delegate`,
    `Bearer ${delegateTokenBase64}`,
    {
      method: "POST",
      body: params,
    }
  );
};
