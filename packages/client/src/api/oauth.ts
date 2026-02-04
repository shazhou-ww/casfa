/**
 * OAuth API functions.
 */

import type { CognitoConfig, TokenResponse, UserInfo } from "../types/api.ts";
import type { Fetcher, FetchResult } from "../utils/fetch.ts";

/**
 * OAuth API context.
 */
export type OAuthApiContext = {
  fetcher: Fetcher;
};

/**
 * Get Cognito configuration for OAuth login.
 */
export const getConfig = async (ctx: OAuthApiContext): Promise<FetchResult<CognitoConfig>> => {
  return ctx.fetcher.request<CognitoConfig>("/api/oauth/config", {
    skipAuth: true,
  });
};

/**
 * Exchange authorization code for tokens.
 */
export type ExchangeCodeParams = {
  code: string;
  redirectUri: string;
  codeVerifier?: string; // For PKCE
};

export const exchangeCode = async (
  ctx: OAuthApiContext,
  params: ExchangeCodeParams
): Promise<FetchResult<TokenResponse>> => {
  return ctx.fetcher.request<TokenResponse>("/api/oauth/token", {
    method: "POST",
    body: {
      code: params.code,
      redirect_uri: params.redirectUri,
      code_verifier: params.codeVerifier,
    },
    skipAuth: true,
  });
};

/**
 * Login with email and password.
 */
export type LoginParams = {
  email: string;
  password: string;
};

export const login = async (
  ctx: OAuthApiContext,
  params: LoginParams
): Promise<FetchResult<TokenResponse>> => {
  return ctx.fetcher.request<TokenResponse>("/api/oauth/login", {
    method: "POST",
    body: params,
    skipAuth: true,
  });
};

/**
 * Refresh access token using refresh token.
 */
export type RefreshParams = {
  refreshToken: string;
};

export const refresh = async (
  ctx: OAuthApiContext,
  params: RefreshParams
): Promise<FetchResult<TokenResponse>> => {
  return ctx.fetcher.request<TokenResponse>("/api/oauth/refresh", {
    method: "POST",
    body: { refresh_token: params.refreshToken },
    skipAuth: true,
  });
};

/**
 * Get current user info.
 */
export const getMe = async (ctx: OAuthApiContext): Promise<FetchResult<UserInfo>> => {
  return ctx.fetcher.request<UserInfo>("/api/oauth/me");
};

/**
 * Build OAuth authorization URL with PKCE.
 */
export type BuildAuthUrlParams = {
  config: CognitoConfig;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
};

export const buildAuthUrl = (params: BuildAuthUrlParams): string => {
  const { config, redirectUri, codeChallenge, state } = params;
  const authUrl = new URL(`https://${config.domain}/oauth2/authorize`);

  authUrl.searchParams.set("client_id", config.clientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  if (state) {
    authUrl.searchParams.set("state", state);
  }

  return authUrl.toString();
};
