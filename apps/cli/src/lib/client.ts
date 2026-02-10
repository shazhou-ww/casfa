import {
  type CasfaClient,
  createClient as createCasfaClient,
  emptyTokenState,
  type StoredRootDelegate,
  type TokenState,
  type TokenStorageProvider,
} from "@casfa/client";
import { getProfile, loadConfig } from "./config";
import {
  type Credentials,
  type RootDelegateCredential,
  getCredentials,
  isUserTokenExpired,
  setCredentials,
} from "./credentials";

// ============================================================================
// Client Options
// ============================================================================

export interface ClientOptions {
  profile?: string;
  baseUrl?: string;
  ticket?: string;
  realm?: string;
}

// ============================================================================
// Resolved Client Types
// ============================================================================

/**
 * Resolved client with context information.
 */
export interface ResolvedClient {
  /** The CASFA client instance */
  client: CasfaClient;
  /** Profile name used */
  profile: string;
  /** Base URL of the server */
  baseUrl: string;
  /** Realm ID (if set) */
  realm: string;
  /** Authentication type */
  authType: "none" | "user" | "delegate" | "ticket";
}

// ============================================================================
// Token Storage Provider for CLI
// ============================================================================

/**
 * Convert RootDelegateCredential (epoch seconds) to StoredRootDelegate (epoch ms).
 */
function credentialToStoredRootDelegate(
  cred: RootDelegateCredential
): StoredRootDelegate {
  return {
    delegateId: cred.delegateId,
    realm: cred.realm,
    refreshToken: cred.refreshToken,
    refreshTokenId: cred.refreshTokenId,
    accessToken: cred.accessToken,
    accessTokenId: cred.accessTokenId,
    accessTokenExpiresAt: cred.accessTokenExpiresAt * 1000, // seconds → ms
    depth: cred.depth,
    canUpload: cred.canUpload,
    canManageDepot: cred.canManageDepot,
  };
}

/**
 * Convert StoredRootDelegate (epoch ms) to RootDelegateCredential (epoch seconds).
 */
function storedRootDelegateToCredential(
  rd: StoredRootDelegate
): RootDelegateCredential {
  return {
    delegateId: rd.delegateId,
    realm: rd.realm,
    refreshToken: rd.refreshToken,
    refreshTokenId: rd.refreshTokenId,
    accessToken: rd.accessToken,
    accessTokenId: rd.accessTokenId,
    accessTokenExpiresAt: Math.floor(rd.accessTokenExpiresAt / 1000), // ms → seconds
    depth: rd.depth,
    canUpload: rd.canUpload,
    canManageDepot: rd.canManageDepot,
  };
}

/**
 * Create a TokenStorageProvider that bridges CLI credentials to CasfaClient.
 */
function createCliTokenStorage(profileName: string): TokenStorageProvider {
  return {
    load: async (): Promise<TokenState | null> => {
      const cred = getCredentials(profileName);
      if (!cred) return null;

      const state: TokenState = emptyTokenState();

      if (cred.userToken && !isUserTokenExpired(cred)) {
        state.user = {
          accessToken: cred.userToken.accessToken,
          refreshToken: cred.userToken.refreshToken,
          userId: cred.userToken.userId || "unknown",
          expiresAt: cred.userToken.expiresAt * 1000, // seconds → ms
        };
      }

      if (cred.rootDelegate) {
        state.rootDelegate = credentialToStoredRootDelegate(cred.rootDelegate);
      }

      return state;
    },

    save: async (state: TokenState): Promise<void> => {
      const cred: Credentials = { version: 3 };

      if (state.user) {
        cred.userToken = {
          accessToken: state.user.accessToken,
          refreshToken: state.user.refreshToken,
          userId: state.user.userId,
          expiresAt: Math.floor(state.user.expiresAt / 1000), // ms → seconds
        };
      }

      if (state.rootDelegate) {
        cred.rootDelegate = storedRootDelegateToCredential(state.rootDelegate);
      }

      setCredentials(profileName, cred);
    },

    clear: async (): Promise<void> => {
      setCredentials(profileName, { version: 3 });
    },
  };
}

// ============================================================================
// Client Creation
// ============================================================================

/**
 * Create a CASFA client based on CLI options and stored credentials.
 */
export async function createClient(options: ClientOptions): Promise<ResolvedClient> {
  const config = loadConfig();
  const profileName = options.profile || process.env.CASFA_PROFILE || config.currentProfile;
  const profile = getProfile(config, profileName);

  const baseUrl = options.baseUrl || process.env.CASFA_BASE_URL || profile.baseUrl;
  const realm = options.realm || process.env.CASFA_REALM || profile.realm;

  if (!realm) {
    throw new Error(
      "Realm is required. Set via --realm option, CASFA_REALM env var, or 'casfa config set realm <id>'."
    );
  }

  const ticketId = options.ticket || process.env.CASFA_TICKET;

  // Determine auth type and create appropriate client
  let authType: ResolvedClient["authType"] = "none";

  if (ticketId) {
    // Ticket authentication
    authType = "ticket";
    const client = await createCasfaClient({
      baseUrl,
      realm,
    });

    return {
      client,
      profile: profileName,
      baseUrl,
      realm,
      authType,
    };
  }

  // Use stored credentials via TokenStorageProvider
  const tokenStorage = createCliTokenStorage(profileName);
  const client = await createCasfaClient({
    baseUrl,
    realm,
    tokenStorage,
    onAuthRequired: () => {
      console.error("Authentication required. Run 'casfa auth login' to authenticate.");
    },
  });

  // Determine auth type from loaded state
  const state = client.getState();
  if (state.user) {
    authType = "user";
  }
  if (state.rootDelegate) {
    authType = "delegate";
  }

  return {
    client,
    profile: profileName,
    baseUrl,
    realm,
    authType,
  };
}

// ============================================================================
// Auth Check Helpers
// ============================================================================

/**
 * Check if the client is authenticated (has any valid token).
 */
export function isAuthenticated(resolved: ResolvedClient): boolean {
  return resolved.authType !== "none";
}

/**
 * Check if the client has user-level authentication.
 */
export function isUserAuthenticated(resolved: ResolvedClient): boolean {
  return resolved.authType === "user" || resolved.client.getState().user !== null;
}

/**
 * Require authentication or throw error.
 */
export function requireAuth(resolved: ResolvedClient): void {
  if (!isAuthenticated(resolved)) {
    throw new Error(
      "Authentication required. Run 'casfa auth login'."
    );
  }
}

/**
 * Require user authentication or throw error.
 */
export function requireUserAuth(resolved: ResolvedClient): void {
  if (!isUserAuthenticated(resolved)) {
    throw new Error("User authentication required. Run 'casfa auth login'.");
  }
}

/**
 * Require realm to be set (always required in new design).
 */
export function requireRealm(resolved: ResolvedClient): void {
  if (!resolved.realm) {
    throw new Error(
      "Realm is required. Set via --realm option, CASFA_REALM env var, or 'casfa config set realm <id>'."
    );
  }
}

/**
 * Require realm and authentication.
 */
export function requireRealmAuth(resolved: ResolvedClient): void {
  requireRealm(resolved);
  requireAuth(resolved);
}

// ============================================================================
// API Helpers for Ticket Auth
// ============================================================================

/**
 * Get the ticket ID from client options.
 */
export function getTicketId(options: ClientOptions): string | undefined {
  return options.ticket || process.env.CASFA_TICKET;
}
