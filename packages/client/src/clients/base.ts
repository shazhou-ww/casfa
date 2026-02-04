/**
 * Base client implementation with public APIs.
 *
 * This provides the foundation for all client types, containing
 * only APIs that don't require authentication.
 */

import type { ServiceInfo } from "@casfa/protocol";
import type {
  AwpAuthInitResponse,
  AwpAuthPollResponse,
  CognitoConfig,
  TokenResponse,
} from "../types/api.ts";
import type { HashProvider, StorageProvider } from "../types/providers.ts";
import { createStatelessFetcher, type FetchResult, type StatelessFetcher } from "./fetcher.ts";
import type {
  BuildAuthUrlParams,
  CasfaBaseClient,
  ClientConfig,
  ExchangeCodeParams,
  InitClientParams,
  LoginParams,
  PollClientParams,
  RefreshParams,
} from "./types.ts";

/**
 * Internal context for base client operations.
 */
export type BaseClientContext = {
  baseUrl: string;
  storage?: StorageProvider;
  hash?: HashProvider;
  fetcher: StatelessFetcher;
};

/**
 * Create a base client context (shared by all client types).
 */
export const createBaseContext = (config: ClientConfig): BaseClientContext => {
  const fetcher = createStatelessFetcher({
    baseUrl: config.baseUrl,
    // No auth for base client
  });

  return {
    baseUrl: config.baseUrl,
    storage: config.storage,
    hash: config.hash,
    fetcher,
  };
};

/**
 * Create the base client API object.
 */
export const createBaseClientApi = (ctx: BaseClientContext): CasfaBaseClient => {
  const { baseUrl, storage, hash, fetcher } = ctx;

  return {
    baseUrl,
    storage,
    hash,

    getInfo: () => fetcher.request<ServiceInfo>("/api/info"),

    oauth: {
      getConfig: () => fetcher.request<CognitoConfig>("/api/oauth/config"),

      exchangeCode: (params: ExchangeCodeParams) =>
        fetcher.request<TokenResponse>("/api/oauth/token", {
          method: "POST",
          body: {
            code: params.code,
            redirect_uri: params.redirectUri,
            code_verifier: params.codeVerifier,
          },
        }),

      login: (params: LoginParams) =>
        fetcher.request<TokenResponse>("/api/oauth/login", {
          method: "POST",
          body: params,
        }),

      refresh: (params: RefreshParams) =>
        fetcher.request<TokenResponse>("/api/oauth/refresh", {
          method: "POST",
          body: { refresh_token: params.refreshToken },
        }),

      buildAuthUrl: (params: BuildAuthUrlParams): string => {
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
      },
    },

    awp: {
      initClient: (params: InitClientParams): Promise<FetchResult<AwpAuthInitResponse>> =>
        fetcher.request<AwpAuthInitResponse>("/api/auth/clients/init", {
          method: "POST",
          body: {
            pubkey: params.publicKey,
            clientName: params.name,
          },
        }),

      pollClient: (params: PollClientParams): Promise<FetchResult<AwpAuthPollResponse>> =>
        fetcher.request<AwpAuthPollResponse>(
          `/api/auth/clients/${encodeURIComponent(params.clientId)}`
        ),
    },
  };
};
