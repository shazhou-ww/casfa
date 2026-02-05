/**
 * Stateful CASFA Client
 *
 * A closure-based client that manages three-tier token hierarchy:
 * - User JWT: OAuth login token, highest authority
 * - Delegate Token: Re-delegation token, can issue child tokens
 * - Access Token: Data access token, used for CAS operations
 *
 * Features:
 * - Automatic token refresh (JWT)
 * - Maximum authority principle for token issuance
 * - Issuer consistency checks before API calls
 * - Ticket creation is always explicit (never auto-issued)
 */

import type {
  CreateDepot,
  CreateTicket,
  CreateToken,
  DepotCommit,
  ListDepotsQuery,
  ListTicketsQuery,
  ServiceInfo,
  TicketSubmit,
  UpdateDepot,
} from "@casfa/protocol";
import * as api from "./api/v2/index.ts";
import { createRefreshManager, type RefreshManager } from "./store/jwt-refresh.ts";
import {
  isAccessTokenValid,
  isDelegateTokenValid,
  isUserTokenValid,
} from "./store/token-checks.ts";
import { createTokenSelector, type TokenSelector } from "./store/token-selector.ts";
import { createTokenStore, type TokenStore } from "./store/token-store.ts";
import type { ClientConfig, ClientError, FetchResult } from "./types/client.ts";
import type {
  StoredAccessToken,
  StoredDelegateToken,
  StoredUserToken,
  TokenState,
} from "./types/tokens.ts";

// ============================================================================
// Client Types
// ============================================================================

/**
 * OAuth namespace methods.
 */
export type OAuthMethods = {
  /** Get Cognito configuration */
  getConfig: () => Promise<FetchResult<api.CognitoConfig>>;
  /** Login with email and password */
  login: (email: string, password: string) => Promise<FetchResult<api.UserInfo>>;
  /** Exchange authorization code for tokens */
  exchangeCode: (
    code: string,
    redirectUri: string,
    codeVerifier?: string
  ) => Promise<FetchResult<api.UserInfo>>;
  /** Get current user info */
  getMe: () => Promise<FetchResult<api.UserInfo>>;
};

/**
 * Token management namespace methods.
 */
export type TokenMethods = {
  /** Create a new token (User JWT required) */
  create: (params: CreateToken) => Promise<FetchResult<StoredDelegateToken | StoredAccessToken>>;
  /** List tokens (User JWT required) */
  list: (params?: api.ListTokensParams) => Promise<FetchResult<api.ListTokensResponse>>;
  /** Revoke a token (User JWT required) */
  revoke: (tokenId: string) => Promise<FetchResult<void>>;
  /** Delegate a token using current Delegate Token */
  delegate: (
    params: api.DelegateTokenParams
  ) => Promise<FetchResult<StoredDelegateToken | StoredAccessToken>>;
};

/**
 * Ticket namespace methods.
 */
export type TicketMethods = {
  /** Create a new ticket (Delegate Token required) */
  create: (
    params: CreateTicket
  ) => Promise<FetchResult<{ ticketId: string; accessToken: StoredAccessToken }>>;
  /** List tickets */
  list: (params?: ListTicketsQuery) => Promise<FetchResult<api.ListTicketsResponse>>;
  /** Get ticket details */
  get: (ticketId: string) => Promise<FetchResult<import("@casfa/protocol").TicketDetail>>;
  /** Submit ticket */
  submit: (
    ticketId: string,
    params: TicketSubmit
  ) => Promise<FetchResult<api.SubmitTicketResponse>>;
};

/**
 * Depot namespace methods.
 */
export type DepotMethods = {
  /** Create a new depot */
  create: (
    params: CreateDepot
  ) => Promise<FetchResult<import("@casfa/protocol").CreateDepotResponse>>;
  /** List depots */
  list: (params?: ListDepotsQuery) => Promise<FetchResult<api.ListDepotsResponse>>;
  /** Get depot details */
  get: (depotId: string) => Promise<FetchResult<import("@casfa/protocol").DepotDetail>>;
  /** Update depot */
  update: (
    depotId: string,
    params: UpdateDepot
  ) => Promise<FetchResult<import("@casfa/protocol").DepotDetail>>;
  /** Delete depot */
  delete: (depotId: string) => Promise<FetchResult<void>>;
  /** Commit new root */
  commit: (depotId: string, params: DepotCommit) => Promise<FetchResult<api.CommitDepotResponse>>;
};

/**
 * Node namespace methods.
 */
export type NodeMethods = {
  /** Get node content */
  get: (nodeKey: string, indexPath: string) => Promise<FetchResult<Uint8Array>>;
  /** Get node metadata */
  getMetadata: (
    nodeKey: string,
    indexPath: string
  ) => Promise<FetchResult<import("@casfa/protocol").NodeMetadata>>;
  /** Prepare nodes for upload */
  prepare: (
    params: import("@casfa/protocol").PrepareNodes
  ) => Promise<FetchResult<import("@casfa/protocol").PrepareNodesResponse>>;
  /** Upload a node */
  put: (nodeKey: string, content: Uint8Array) => Promise<FetchResult<api.NodeUploadResult>>;
};

/**
 * The stateful CASFA client.
 */
export type CasfaClient = {
  /** Get current token state */
  getState: () => TokenState;
  /** Get server info */
  getServerInfo: () => ServiceInfo | null;

  /** Set delegate token (e.g., from external source) */
  setDelegateToken: (token: StoredDelegateToken) => void;
  /** Set access token (e.g., from external source) */
  setAccessToken: (token: StoredAccessToken) => void;
  /** Clear all tokens and logout */
  logout: () => void;

  /** OAuth methods */
  oauth: OAuthMethods;
  /** Token management methods */
  tokens: TokenMethods;
  /** Ticket methods */
  tickets: TicketMethods;
  /** Depot methods */
  depots: DepotMethods;
  /** Node methods */
  nodes: NodeMethods;
};

// ============================================================================
// Client Factory
// ============================================================================

/**
 * Create a stateful CASFA client.
 */
export const createStatefulClient = async (config: ClientConfig): Promise<CasfaClient> => {
  const { baseUrl, realm, tokenStorage, onTokenChange, onAuthRequired, defaultTokenTtl } = config;

  // Initialize token store
  const store = createTokenStore({
    storage: tokenStorage,
    onTokenChange,
    onAuthRequired,
  });
  await store.initialize();

  // Initialize refresh manager
  const refreshManager = createRefreshManager({
    store,
    baseUrl,
    onAuthRequired,
  });

  // Fetch server info
  let serverInfo: ServiceInfo | null = null;
  const infoResult = await api.fetchServiceInfo(baseUrl);
  if (infoResult.ok) {
    serverInfo = infoResult.data;
  }

  // Initialize token selector
  const tokenSelector = createTokenSelector({
    store,
    baseUrl,
    realm,
    serverInfo,
    defaultTokenTtl,
  });

  // ========== Helper functions ==========

  const requireUserToken = async (): Promise<StoredUserToken | null> => {
    return refreshManager.ensureValidUserToken();
  };

  const requireDelegateToken = async (): Promise<StoredDelegateToken | null> => {
    return tokenSelector.ensureDelegateToken();
  };

  const requireAccessToken = async (): Promise<StoredAccessToken | null> => {
    return tokenSelector.ensureAccessToken();
  };

  // ========== OAuth Methods ==========

  const oauth: OAuthMethods = {
    getConfig: () => api.getOAuthConfig(baseUrl),

    login: async (email, password) => {
      const result = await api.login(baseUrl, { email, password });
      if (!result.ok) return result;

      // Get user info to get userId
      const meResult = await api.getMe(baseUrl, result.data.accessToken);
      if (!meResult.ok) {
        return meResult;
      }

      // Store user token
      const userToken = api.tokenResponseToStoredUserToken(result.data, meResult.data.userId);
      store.setUser(userToken);
      refreshManager.scheduleProactiveRefresh();

      return meResult;
    },

    exchangeCode: async (code, redirectUri, codeVerifier) => {
      const result = await api.exchangeCode(baseUrl, {
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      });
      if (!result.ok) return result;

      // Get user info
      const meResult = await api.getMe(baseUrl, result.data.accessToken);
      if (!meResult.ok) return meResult;

      // Store user token
      const userToken = api.tokenResponseToStoredUserToken(result.data, meResult.data.userId);
      store.setUser(userToken);
      refreshManager.scheduleProactiveRefresh();

      return meResult;
    },

    getMe: async () => {
      const userToken = await requireUserToken();
      if (!userToken) {
        return { ok: false, error: { code: "UNAUTHORIZED", message: "User login required" } };
      }
      return api.getMe(baseUrl, userToken.accessToken);
    },
  };

  // ========== Token Methods ==========

  const tokens: TokenMethods = {
    create: async (params) => {
      const userToken = await requireUserToken();
      if (!userToken) {
        return { ok: false, error: { code: "UNAUTHORIZED", message: "User login required" } };
      }

      const result = await api.createToken(baseUrl, userToken.accessToken, params);
      if (!result.ok) return result;

      const newToken = {
        tokenId: result.data.tokenId,
        tokenBase64: result.data.tokenBase64,
        type: result.data.type,
        issuerId: result.data.issuerId,
        expiresAt: result.data.expiresAt,
        canUpload: result.data.canUpload,
        canManageDepot: result.data.canManageDepot,
      } as StoredDelegateToken | StoredAccessToken;

      // Auto-store if it's a delegate or access token for this client
      if (params.realm === realm) {
        if (params.type === "delegate") {
          store.setDelegate(newToken as StoredDelegateToken);
        } else {
          store.setAccess(newToken as StoredAccessToken);
        }
      }

      return { ok: true, data: newToken, status: result.status };
    },

    list: async (params) => {
      const userToken = await requireUserToken();
      if (!userToken) {
        return { ok: false, error: { code: "UNAUTHORIZED", message: "User login required" } };
      }
      return api.listTokens(baseUrl, userToken.accessToken, params);
    },

    revoke: async (tokenId) => {
      const userToken = await requireUserToken();
      if (!userToken) {
        return { ok: false, error: { code: "UNAUTHORIZED", message: "User login required" } };
      }
      const result = await api.revokeToken(baseUrl, userToken.accessToken, tokenId);
      if (!result.ok) return { ok: false, error: result.error };

      // Clear local token if it matches
      const state = store.getState();
      if (state.delegate?.tokenId === tokenId) {
        store.setDelegate(null);
      }
      if (state.access?.tokenId === tokenId) {
        store.setAccess(null);
      }

      return { ok: true, data: undefined, status: result.status };
    },

    delegate: async (params) => {
      const delegateToken = await requireDelegateToken();
      if (!delegateToken) {
        return { ok: false, error: { code: "FORBIDDEN", message: "Delegate token required" } };
      }

      const result = await api.delegateToken(baseUrl, delegateToken.tokenBase64, params);
      if (!result.ok) return result;

      const newToken = {
        tokenId: result.data.tokenId,
        tokenBase64: result.data.tokenBase64,
        type: result.data.type,
        issuerId: result.data.issuerId,
        expiresAt: result.data.expiresAt,
        canUpload: result.data.canUpload,
        canManageDepot: result.data.canManageDepot,
      } as StoredDelegateToken | StoredAccessToken;

      return { ok: true, data: newToken, status: result.status };
    },
  };

  // ========== Ticket Methods ==========

  const tickets: TicketMethods = {
    create: async (params) => {
      const delegateToken = await requireDelegateToken();
      if (!delegateToken) {
        return {
          ok: false,
          error: { code: "FORBIDDEN", message: "Delegate token required to create ticket" },
        };
      }

      const result = await api.createTicket(baseUrl, realm, delegateToken.tokenBase64, params);
      if (!result.ok) return result;

      // Return the ticket info with the access token
      const accessToken: StoredAccessToken = {
        tokenId: result.data.accessTokenId,
        tokenBase64: result.data.accessTokenBase64,
        type: "access",
        issuerId: delegateToken.tokenId,
        expiresAt: result.data.expiresAt,
        canUpload: params.canUpload ?? false,
        canManageDepot: false, // Ticket access tokens can't manage depots
      };

      return {
        ok: true,
        data: { ticketId: result.data.ticketId, accessToken },
        status: result.status,
      };
    },

    list: async (params) => {
      const accessToken = await requireAccessToken();
      if (!accessToken) {
        return { ok: false, error: { code: "FORBIDDEN", message: "Access token required" } };
      }
      return api.listTickets(baseUrl, realm, accessToken.tokenBase64, params);
    },

    get: async (ticketId) => {
      const accessToken = await requireAccessToken();
      if (!accessToken) {
        return { ok: false, error: { code: "FORBIDDEN", message: "Access token required" } };
      }
      return api.getTicket(baseUrl, realm, accessToken.tokenBase64, ticketId);
    },

    submit: async (ticketId, params) => {
      const accessToken = await requireAccessToken();
      if (!accessToken) {
        return { ok: false, error: { code: "FORBIDDEN", message: "Access token required" } };
      }
      return api.submitTicket(baseUrl, realm, accessToken.tokenBase64, ticketId, params);
    },
  };

  // ========== Depot Methods ==========

  const depots: DepotMethods = {
    create: async (params) => {
      const accessToken = await requireAccessToken();
      if (!accessToken) {
        return { ok: false, error: { code: "FORBIDDEN", message: "Access token required" } };
      }
      return api.createDepot(baseUrl, realm, accessToken.tokenBase64, params);
    },

    list: async (params) => {
      const accessToken = await requireAccessToken();
      if (!accessToken) {
        return { ok: false, error: { code: "FORBIDDEN", message: "Access token required" } };
      }
      return api.listDepots(baseUrl, realm, accessToken.tokenBase64, params);
    },

    get: async (depotId) => {
      const accessToken = await requireAccessToken();
      if (!accessToken) {
        return { ok: false, error: { code: "FORBIDDEN", message: "Access token required" } };
      }
      return api.getDepot(baseUrl, realm, accessToken.tokenBase64, depotId);
    },

    update: async (depotId, params) => {
      const accessToken = await requireAccessToken();
      if (!accessToken) {
        return { ok: false, error: { code: "FORBIDDEN", message: "Access token required" } };
      }
      return api.updateDepot(baseUrl, realm, accessToken.tokenBase64, depotId, params);
    },

    delete: async (depotId) => {
      const accessToken = await requireAccessToken();
      if (!accessToken) {
        return { ok: false, error: { code: "FORBIDDEN", message: "Access token required" } };
      }
      return api.deleteDepot(baseUrl, realm, accessToken.tokenBase64, depotId);
    },

    commit: async (depotId, params) => {
      const accessToken = await requireAccessToken();
      if (!accessToken) {
        return { ok: false, error: { code: "FORBIDDEN", message: "Access token required" } };
      }
      return api.commitDepot(baseUrl, realm, accessToken.tokenBase64, depotId, params);
    },
  };

  // ========== Node Methods ==========

  const nodes: NodeMethods = {
    get: async (nodeKey, indexPath) => {
      const accessToken = await requireAccessToken();
      if (!accessToken) {
        return { ok: false, error: { code: "FORBIDDEN", message: "Access token required" } };
      }
      return api.getNode(baseUrl, realm, accessToken.tokenBase64, nodeKey, indexPath);
    },

    getMetadata: async (nodeKey, indexPath) => {
      const accessToken = await requireAccessToken();
      if (!accessToken) {
        return { ok: false, error: { code: "FORBIDDEN", message: "Access token required" } };
      }
      return api.getNodeMetadata(baseUrl, realm, accessToken.tokenBase64, nodeKey, indexPath);
    },

    prepare: async (params) => {
      const accessToken = await requireAccessToken();
      if (!accessToken) {
        return { ok: false, error: { code: "FORBIDDEN", message: "Access token required" } };
      }
      return api.prepareNodes(baseUrl, realm, accessToken.tokenBase64, params);
    },

    put: async (nodeKey, content) => {
      const accessToken = await requireAccessToken();
      if (!accessToken) {
        return { ok: false, error: { code: "FORBIDDEN", message: "Access token required" } };
      }
      return api.putNode(baseUrl, realm, accessToken.tokenBase64, nodeKey, content);
    },
  };

  // ========== Return Client ==========

  return {
    getState: () => store.getState(),
    getServerInfo: () => serverInfo,

    setDelegateToken: (token) => store.setDelegate(token),
    setAccessToken: (token) => store.setAccess(token),

    logout: () => {
      refreshManager.cancelScheduledRefresh();
      store.clear();
    },

    oauth,
    tokens,
    tickets,
    depots,
    nodes,
  };
};
