import type {
  CasfaAnonymousClient,
  CasfaDelegateClient,
  CasfaDelegateRealmView,
  CasfaTicketClient,
  CasfaUserClient,
  CasfaUserRealmView,
  HashProvider,
} from "@casfa/client";
import { createCasfaClient } from "@casfa/client";
import { blake3 } from "@noble/hashes/blake3.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { getProfile, loadConfig } from "./config";
import { type Credentials, getCredentials, isTokenExpired, setCredentials } from "./credentials";

// ============================================================================
// Hash Provider
// ============================================================================

const createHashProvider = (): HashProvider => ({
  sha256: async (data: Uint8Array): Promise<Uint8Array> => {
    return sha256(data);
  },
  blake3: async (data: Uint8Array): Promise<Uint8Array> => {
    return blake3(data);
  },
});

export interface ClientOptions {
  profile?: string;
  baseUrl?: string;
  token?: string;
  ticket?: string;
  realm?: string;
}

// ============================================================================
// Client Types for CLI
// ============================================================================

/** Base client - only public APIs */
export interface BaseClientResult {
  type: "base";
  client: CasfaAnonymousClient;
  profile: string;
  baseUrl: string;
  realm?: string;
}

/** User client without realm */
export interface UserClientResult {
  type: "user";
  client: CasfaUserClient;
  profile: string;
  baseUrl: string;
  realm?: string;
}

/** User client with realm */
export interface UserRealmResult {
  type: "user-realm";
  client: CasfaUserRealmView;
  profile: string;
  baseUrl: string;
  realm: string;
}

/** Delegate client without realm */
export interface DelegateClientResult {
  type: "delegate";
  client: CasfaDelegateClient;
  profile: string;
  baseUrl: string;
  realm?: string;
}

/** Delegate client with realm */
export interface DelegateRealmResult {
  type: "delegate-realm";
  client: CasfaDelegateRealmView;
  profile: string;
  baseUrl: string;
  realm: string;
}

/** Ticket client (always has realm) */
export interface TicketClientResult {
  type: "ticket";
  client: CasfaTicketClient;
  profile: string;
  baseUrl: string;
  realm: string;
}

export type ResolvedClient =
  | BaseClientResult
  | UserClientResult
  | UserRealmResult
  | DelegateClientResult
  | DelegateRealmResult
  | TicketClientResult;

export type ResolvedRealmClient = UserRealmResult | DelegateRealmResult | TicketClientResult;

export type ResolvedAuthClient =
  | UserClientResult
  | UserRealmResult
  | DelegateClientResult
  | DelegateRealmResult;

// ============================================================================
// Client Creation
// ============================================================================

export async function createClient(options: ClientOptions): Promise<ResolvedClient> {
  const config = loadConfig();
  const profileName = options.profile || process.env.CASFA_PROFILE || config.currentProfile;
  const profile = getProfile(config, profileName);

  const baseUrl = options.baseUrl || process.env.CASFA_BASE_URL || profile.baseUrl;
  const realm = options.realm || process.env.CASFA_REALM || profile.realm;

  const hashProvider = createHashProvider();
  const baseClient = createCasfaClient({ baseUrl, hash: hashProvider });

  // Priority: CLI options > env vars > stored credentials

  // 1. Ticket auth (most restricted)
  const ticketId = options.ticket || process.env.CASFA_TICKET;
  if (ticketId) {
    if (!realm) {
      throw new Error("Realm is required when using ticket authentication");
    }
    return {
      type: "ticket",
      client: baseClient.withTicket(ticketId, realm),
      profile: profileName,
      baseUrl,
      realm,
    };
  }

  // 2. Agent token
  const token = options.token || process.env.CASFA_TOKEN;
  if (token) {
    const delegateClient = baseClient.withDelegateToken(token);
    if (realm) {
      return {
        type: "delegate-realm",
        client: delegateClient.withRealm(realm),
        profile: profileName,
        baseUrl,
        realm,
      };
    }
    return {
      type: "delegate",
      client: delegateClient,
      profile: profileName,
      baseUrl,
    };
  }

  // 3. Stored credentials
  const credentials = getCredentials(profileName);
  if (credentials) {
    if (credentials.type === "token") {
      const delegateClient = baseClient.withDelegateToken(credentials.token);
      if (realm) {
        return {
          type: "delegate-realm",
          client: delegateClient.withRealm(realm),
          profile: profileName,
          baseUrl,
          realm,
        };
      }
      return {
        type: "delegate",
        client: delegateClient,
        profile: profileName,
        baseUrl,
      };
    }

    if (credentials.type === "oauth") {
      // Check if token needs refresh
      if (isTokenExpired(credentials)) {
        const refreshed = await refreshToken(baseClient, credentials, profileName);
        if (refreshed) {
          const userClient = baseClient.withUserToken(
            refreshed.accessToken,
            refreshed.refreshToken
          );
          if (realm) {
            return {
              type: "user-realm",
              client: userClient.withRealm(realm),
              profile: profileName,
              baseUrl,
              realm,
            };
          }
          return {
            type: "user",
            client: userClient,
            profile: profileName,
            baseUrl,
          };
        }
        throw new Error("Token expired and refresh failed. Please run 'casfa auth login'");
      }

      const userClient = baseClient.withUserToken(
        credentials.accessToken,
        credentials.refreshToken
      );
      if (realm) {
        return {
          type: "user-realm",
          client: userClient.withRealm(realm),
          profile: profileName,
          baseUrl,
          realm,
        };
      }
      return {
        type: "user",
        client: userClient,
        profile: profileName,
        baseUrl,
      };
    }
  }

  // 4. No auth - base client only
  return {
    type: "base",
    client: baseClient,
    profile: profileName,
    baseUrl,
    realm,
  };
}

// ============================================================================
// Token Refresh
// ============================================================================

async function refreshToken(
  baseClient: CasfaAnonymousClient,
  credentials: Credentials & { type: "oauth" },
  profileName: string
): Promise<{ accessToken: string; refreshToken: string } | null> {
  try {
    const result = await baseClient.oauth.refresh({ refreshToken: credentials.refreshToken });
    if (!result.ok) {
      return null;
    }
    const newCredentials: Credentials = {
      type: "oauth",
      accessToken: result.data.access_token,
      refreshToken: result.data.refresh_token || credentials.refreshToken,
      expiresAt: Math.floor(Date.now() / 1000) + result.data.expires_in,
    };
    setCredentials(profileName, newCredentials);
    return {
      accessToken: result.data.access_token,
      refreshToken: result.data.refresh_token || credentials.refreshToken,
    };
  } catch {
    return null;
  }
}

// ============================================================================
// Type Guards
// ============================================================================

export function isRealmClient(resolved: ResolvedClient): resolved is ResolvedRealmClient {
  return (
    resolved.type === "user-realm" ||
    resolved.type === "delegate-realm" ||
    resolved.type === "ticket"
  );
}

export function isAuthClient(resolved: ResolvedClient): resolved is ResolvedAuthClient {
  return (
    resolved.type === "user" ||
    resolved.type === "user-realm" ||
    resolved.type === "delegate" ||
    resolved.type === "delegate-realm"
  );
}

export function isUserClient(
  resolved: ResolvedClient
): resolved is UserClientResult | UserRealmResult {
  return resolved.type === "user" || resolved.type === "user-realm";
}

// ============================================================================
// Assertions
// ============================================================================

export function requireAuth(resolved: ResolvedClient): asserts resolved is ResolvedAuthClient {
  if (resolved.type === "base") {
    throw new Error("Authentication required. Run 'casfa auth login' or provide --token option.");
  }
  if (resolved.type === "ticket") {
    throw new Error("This operation is not available with ticket authentication.");
  }
}

export function requireUserAuth(
  resolved: ResolvedClient
): asserts resolved is UserClientResult | UserRealmResult {
  if (resolved.type !== "user" && resolved.type !== "user-realm") {
    throw new Error("User authentication required. Run 'casfa auth login'.");
  }
}

export function requireRealm(resolved: ResolvedClient): asserts resolved is ResolvedRealmClient {
  if (!isRealmClient(resolved)) {
    throw new Error(
      "Realm is required. Set via --realm option, CASFA_REALM env var, or 'casfa config set realm <id>'."
    );
  }
}

export function requireRealmAuth(
  resolved: ResolvedClient
): asserts resolved is UserRealmResult | DelegateRealmResult {
  requireAuth(resolved);
  if (resolved.type !== "user-realm" && resolved.type !== "delegate-realm") {
    throw new Error(
      "Realm is required. Set via --realm option, CASFA_REALM env var, or 'casfa config set realm <id>'."
    );
  }
}
