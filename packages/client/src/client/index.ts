/**
 * Stateful CASFA Client
 *
 * A closure-based client that manages three-tier token hierarchy:
 * - User JWT: OAuth login token, highest authority
 * - Delegate Token: Re-delegation token, can issue child tokens
 * - Access Token: Data access token, used for CAS operations
 */

import type { ServiceInfo } from "@casfa/protocol";
import * as api from "../api/index.ts";
import { createRefreshManager } from "../store/jwt-refresh.ts";
import { createTokenSelector } from "../store/token-selector.ts";
import { createTokenStore } from "../store/token-store.ts";
import type {
  ClientConfig,
  OnAuthRequiredCallback,
  OnTokenChangeCallback,
  TokenStorageProvider,
} from "../types/client.ts";
import type { StoredAccessToken, StoredDelegateToken, TokenState } from "../types/tokens.ts";
import { createDepotMethods, type DepotMethods } from "./depots.ts";
import { createNodeMethods, type NodeMethods } from "./nodes.ts";
import { createOAuthMethods, type OAuthMethods } from "./oauth.ts";
import { createTicketMethods, type TicketMethods } from "./tickets.ts";
import { createTokenMethods, type TokenMethods } from "./tokens.ts";

// ============================================================================
// Re-exports
// ============================================================================

export type { DepotMethods, NodeMethods, OAuthMethods, TicketMethods, TokenMethods };

export type { ClientConfig, OnAuthRequiredCallback, OnTokenChangeCallback, TokenStorageProvider };

// ============================================================================
// Client Type
// ============================================================================

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
export const createClient = async (config: ClientConfig): Promise<CasfaClient> => {
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

  // Shared dependencies
  const deps = { baseUrl, realm, store, refreshManager, tokenSelector };

  // Build client
  return {
    getState: () => store.getState(),
    getServerInfo: () => serverInfo,

    setDelegateToken: (token) => store.setDelegate(token),
    setAccessToken: (token) => store.setAccess(token),

    logout: () => {
      refreshManager.cancelScheduledRefresh();
      store.clear();
    },

    oauth: createOAuthMethods(deps),
    tokens: createTokenMethods(deps),
    tickets: createTicketMethods(deps),
    depots: createDepotMethods(deps),
    nodes: createNodeMethods(deps),
  };
};
