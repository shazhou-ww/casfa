import {
  type CasfaClient,
  createClient as createCasfaClient,
  emptyTokenState,
  type TokenState,
  type TokenStorageProvider,
} from "@casfa/client";
import { getProfile, loadConfig } from "./config";
import {
  type Credentials,
  getCredentials,
  isDelegateTokenExpired,
  isUserTokenExpired,
  setCredentials,
} from "./credentials";

// ============================================================================
// Client Options
// ============================================================================

export interface ClientOptions {
  profile?: string;
  baseUrl?: string;
  delegateToken?: string; // New: direct delegate token
  accessToken?: string; // New: direct access token (bypasses auto-issue)
  ticket?: string;
  realm?: string;
  /** @deprecated Use delegateToken instead */
  token?: string; // Legacy: agent token, now treated as delegate token
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
  authType: "none" | "user" | "delegate" | "access" | "ticket";
}

// ============================================================================
// Token Storage Provider for CLI
// ============================================================================

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
          expiresAt: cred.userToken.expiresAt * 1000, // Convert to ms
        };
      }

      if (cred.delegateToken && !isDelegateTokenExpired(cred)) {
        state.delegate = {
          tokenId: cred.delegateToken.tokenId,
          tokenBase64: cred.delegateToken.token,
          type: "delegate",
          issuerId: cred.delegateToken.issuerId || "unknown",
          expiresAt: cred.delegateToken.expiresAt
            ? cred.delegateToken.expiresAt * 1000
            : Date.now() + 86400000,
          canUpload: cred.delegateToken.canUpload ?? true,
          canManageDepot: cred.delegateToken.canManageDepot ?? true,
        };
      }

      return state;
    },

    save: async (state: TokenState): Promise<void> => {
      const cred: Credentials = { version: 2 };

      if (state.user) {
        cred.userToken = {
          accessToken: state.user.accessToken,
          refreshToken: state.user.refreshToken,
          userId: state.user.userId,
          expiresAt: Math.floor(state.user.expiresAt / 1000),
        };
      }

      if (state.delegate) {
        cred.delegateToken = {
          tokenId: state.delegate.tokenId,
          token: state.delegate.tokenBase64,
          issuerId: state.delegate.issuerId,
          expiresAt: Math.floor(state.delegate.expiresAt / 1000),
          canUpload: state.delegate.canUpload,
          canManageDepot: state.delegate.canManageDepot,
        };
      }

      setCredentials(profileName, cred);
    },

    clear: async (): Promise<void> => {
      setCredentials(profileName, { version: 2 });
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

  // Handle legacy --token option
  const delegateTokenStr = options.delegateToken || options.token || process.env.CASFA_TOKEN;
  const accessTokenStr = options.accessToken;
  const ticketId = options.ticket || process.env.CASFA_TICKET;

  // Determine auth type and create appropriate client
  let authType: ResolvedClient["authType"] = "none";

  // Priority: ticket > access token > delegate token > stored credentials

  if (ticketId) {
    // Ticket authentication - create a minimal client for ticket operations
    // Note: CasfaClient doesn't directly support ticket auth, we'll handle this separately
    authType = "ticket";
    const client = await createCasfaClient({
      baseUrl,
      realm,
    });

    // For ticket auth, we need to handle it at the API level
    // Store ticket ID in client state for later use
    return {
      client,
      profile: profileName,
      baseUrl,
      realm,
      authType,
    };
  }

  if (accessTokenStr) {
    // Direct access token - bypass normal token management
    authType = "access";
    const client = await createCasfaClient({
      baseUrl,
      realm,
    });
    // Set access token directly
    client.setAccessToken({
      tokenId: "cli-provided",
      tokenBase64: accessTokenStr,
      type: "access",
      issuerId: "unknown",
      expiresAt: Date.now() + 3600000, // Assume 1h validity
      canUpload: true,
      canManageDepot: true,
    });
    return {
      client,
      profile: profileName,
      baseUrl,
      realm,
      authType,
    };
  }

  if (delegateTokenStr) {
    // Direct delegate token provided
    authType = "delegate";
    const client = await createCasfaClient({
      baseUrl,
      realm,
    });
    client.setDelegateToken({
      tokenId: "cli-provided",
      tokenBase64: delegateTokenStr,
      type: "delegate",
      issuerId: "unknown",
      expiresAt: Date.now() + 86400000, // Assume 24h validity
      canUpload: true,
      canManageDepot: true,
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
  } else if (state.delegate) {
    authType = "delegate";
  } else if (state.access) {
    authType = "access";
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
  return resolved.authType === "user";
}

/**
 * Require authentication or throw error.
 */
export function requireAuth(resolved: ResolvedClient): void {
  if (!isAuthenticated(resolved)) {
    throw new Error(
      "Authentication required. Run 'casfa auth login' or provide --delegate-token option."
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
// Legacy Type Guards (for backward compatibility)
// ============================================================================

/** @deprecated Use isAuthenticated instead */
export function isRealmClient(resolved: ResolvedClient): boolean {
  return !!resolved.realm;
}

/** @deprecated Use isAuthenticated instead */
export function isAuthClient(resolved: ResolvedClient): boolean {
  return isAuthenticated(resolved);
}

/** @deprecated Use isUserAuthenticated instead */
export function isUserClient(resolved: ResolvedClient): boolean {
  return isUserAuthenticated(resolved);
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
