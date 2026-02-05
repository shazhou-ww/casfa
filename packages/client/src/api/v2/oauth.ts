/**
 * OAuth API functions.
 */

import type { Login, Refresh, TokenExchange } from "@casfa/protocol";
import type { FetchResult } from "../../types/client.ts";
import type { StoredUserToken } from "../../types/tokens.ts";
import { fetchApi, fetchWithAuth } from "../../utils/api-fetch.ts";

// ============================================================================
// Types
// ============================================================================

export type CognitoConfig = {
  region: string;
  userPoolId: string;
  clientId: string;
  domain: string;
};

export type TokenResponse = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  idToken?: string;
};

export type UserInfo = {
  userId: string;
  email: string;
  role: string;
};

// ============================================================================
// Public OAuth API
// ============================================================================

/**
 * Get Cognito configuration.
 */
export const getOAuthConfig = async (baseUrl: string): Promise<FetchResult<CognitoConfig>> => {
  return fetchApi<CognitoConfig>(`${baseUrl}/api/oauth/config`);
};

/**
 * Exchange authorization code for tokens.
 */
export const exchangeCode = async (
  baseUrl: string,
  params: TokenExchange
): Promise<FetchResult<TokenResponse>> => {
  return fetchApi<TokenResponse>(`${baseUrl}/api/oauth/token`, {
    method: "POST",
    body: params,
  });
};

/**
 * Login with email and password.
 */
export const login = async (
  baseUrl: string,
  params: Login
): Promise<FetchResult<TokenResponse>> => {
  return fetchApi<TokenResponse>(`${baseUrl}/api/oauth/login`, {
    method: "POST",
    body: params,
  });
};

/**
 * Refresh access token.
 */
export const refresh = async (
  baseUrl: string,
  params: Refresh
): Promise<FetchResult<TokenResponse>> => {
  return fetchApi<TokenResponse>(`${baseUrl}/api/oauth/refresh`, {
    method: "POST",
    body: params,
  });
};

// ============================================================================
// Authenticated OAuth API
// ============================================================================

/**
 * Get current user info.
 * Requires User JWT.
 */
export const getMe = async (
  baseUrl: string,
  userAccessToken: string
): Promise<FetchResult<UserInfo>> => {
  return fetchWithAuth<UserInfo>(`${baseUrl}/api/oauth/me`, `Bearer ${userAccessToken}`);
};

// ============================================================================
// Helpers
// ============================================================================

/**
 * Convert token response to stored user token.
 */
export const tokenResponseToStoredUserToken = (
  response: TokenResponse,
  userId: string
): StoredUserToken => ({
  accessToken: response.accessToken,
  refreshToken: response.refreshToken,
  userId,
  expiresAt: Date.now() + response.expiresIn * 1000,
});
