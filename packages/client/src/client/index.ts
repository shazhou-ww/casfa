/**
 * Stateful CASFA Client
 *
 * A closure-based client that manages two-tier token hierarchy:
 * - User JWT: OAuth login token, highest authority
 * - Root Delegate: RT + AT pair for realm operations (auto-refreshed)
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
import type {
  StoredAccessToken,
  StoredRootDelegate,
  TokenState,
} from "../types/tokens.ts";
import { createDelegateMethods, type DelegateMethods } from "./delegates.ts";
import { createDepotMethods, type DepotMethods } from "./depots.ts";
import { createNodeMethods, type NodeMethods } from "./nodes.ts";
import { createOAuthMethods, type OAuthMethods } from "./oauth.ts";
import { createTicketMethods, type TicketMethods } from "./tickets.ts";
import { createTokenMethods, type TokenMethods } from "./tokens.ts";

// ============================================================================
// Re-exports
// ============================================================================

export type {
  DelegateMethods,
  DepotMethods,
  NodeMethods,
  OAuthMethods,
  TicketMethods,
  TokenMethods,
};

export type {
  ClientConfig,
  OnAuthRequiredCallback,
  OnTokenChangeCallback,
  TokenStorageProvider,
};

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

  /** Set root delegate (e.g., from external source) */
  setRootDelegate: (delegate: StoredRootDelegate) => void;
  /** Get current access token (auto-refreshes if needed) */
  getAccessToken: () => Promise<StoredAccessToken | null>;
  /** Clear all tokens and logout */
  logout: () => void;

  /** OAuth methods */
  oauth: OAuthMethods;
  /** Token management methods (root token + refresh) */
  tokens: TokenMethods;
  /** Delegate management methods */
  delegates: DelegateMethods;
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
export const createClient = async (
  config: ClientConfig,
): Promise<CasfaClient> => {
  const {
    baseUrl,
    realm,
    tokenStorage,
    onTokenChange,
    onAuthRequired,
  } = config;

  // Initialize token store
  const store = createTokenStore({
    storage: tokenStorage,
    onTokenChange,
    onAuthRequired,
  });
  await store.initialize();

  // Initialize refresh manager (for JWT OAuth refresh)
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

  // Initialize token selector (for root delegate + RT/AT refresh)
  const tokenSelector = createTokenSelector({
    store,
    baseUrl,
    realm,
  });

  // Shared dependencies
  const deps = { baseUrl, realm, store, refreshManager, tokenSelector };

  // Build client
  return {
    getState: () => store.getState(),
    getServerInfo: () => serverInfo,

    setRootDelegate: (delegate) => store.setRootDelegate(delegate),
    getAccessToken: () => tokenSelector.ensureAccessToken(),

    logout: () => {
      refreshManager.cancelScheduledRefresh();
      store.clear();
    },

    oauth: createOAuthMethods(deps),
    tokens: createTokenMethods(deps),
    delegates: createDelegateMethods(deps),
    tickets: createTicketMethods(deps),
    depots: createDepotMethods(deps),
    nodes: createNodeMethods(deps),
  };
};
