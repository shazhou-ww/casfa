import * as fs from "node:fs";
import * as path from "node:path";
import { ensureCasfaDir, getCasfaDir } from "./config";

// ============================================================================
// New Credential Types (Three-tier Token System)
// ============================================================================

/**
 * User JWT token from OAuth login.
 */
export interface UserTokenCredential {
  /** JWT access token */
  accessToken: string;
  /** Refresh token for renewal */
  refreshToken: string;
  /** User ID (usr_xxx format) */
  userId?: string;
  /** Token expiration time (epoch seconds) */
  expiresAt: number;
}

/**
 * Delegate Token for re-delegation.
 */
export interface DelegateTokenCredential {
  /** Token ID (dlt1_xxx format) */
  tokenId: string;
  /** Token binary as Base64 */
  token: string;
  /** Issuer ID (usr_xxx or dlt1_xxx) */
  issuerId?: string;
  /** Token expiration time (epoch seconds) */
  expiresAt?: number;
  /** Realm ID (optional, for realm-scoped tokens) */
  realm?: string;
  /** Whether the token can upload nodes */
  canUpload?: boolean;
  /** Whether the token can manage depots */
  canManageDepot?: boolean;
}

/**
 * New credential structure supporting the three-tier token system.
 */
export interface Credentials {
  /** Version for migration support */
  version: 2;
  /** User JWT token from OAuth login */
  userToken?: UserTokenCredential;
  /** Delegate Token for CLI operations */
  delegateToken?: DelegateTokenCredential;
}

// ============================================================================
// Legacy Credential Types (for migration)
// ============================================================================

export interface LegacyTokenCredentials {
  type: "token";
  token: string;
}

export interface LegacyOAuthCredentials {
  type: "oauth";
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export type LegacyCredentials = LegacyTokenCredentials | LegacyOAuthCredentials;

// ============================================================================
// Store Types
// ============================================================================

export interface CredentialsStore {
  [profileName: string]: Credentials;
}

/** Legacy store for migration */
interface LegacyCredentialsStore {
  [profileName: string]: LegacyCredentials;
}

// ============================================================================
// File Path
// ============================================================================

export function getCredentialsPath(): string {
  return path.join(getCasfaDir(), "credentials.json");
}

// ============================================================================
// Migration from Legacy Format
// ============================================================================

/**
 * Check if the credential is in legacy format.
 */
function isLegacyCredential(cred: unknown): cred is LegacyCredentials {
  return (
    typeof cred === "object" &&
    cred !== null &&
    "type" in cred &&
    (cred.type === "token" || cred.type === "oauth")
  );
}

/**
 * Migrate a legacy credential to the new format.
 */
function migrateLegacyCredential(legacy: LegacyCredentials): Credentials {
  if (legacy.type === "oauth") {
    return {
      version: 2,
      userToken: {
        accessToken: legacy.accessToken,
        refreshToken: legacy.refreshToken,
        expiresAt: legacy.expiresAt,
      },
    };
  }
  // legacy.type === "token" (agent token -> delegate token)
  return {
    version: 2,
    delegateToken: {
      tokenId: "unknown", // Legacy tokens don't have ID
      token: legacy.token,
    },
  };
}

/**
 * Migrate store from legacy format if needed.
 * Returns true if migration occurred.
 */
function migrateStoreIfNeeded(store: Record<string, unknown>): boolean {
  let migrated = false;

  for (const profileName of Object.keys(store)) {
    const cred = store[profileName];
    if (isLegacyCredential(cred)) {
      store[profileName] = migrateLegacyCredential(cred);
      migrated = true;
    }
  }

  return migrated;
}

// ============================================================================
// Load and Save
// ============================================================================

export function loadCredentials(): CredentialsStore {
  const credPath = getCredentialsPath();
  if (!fs.existsSync(credPath)) {
    return {};
  }
  try {
    const content = fs.readFileSync(credPath, "utf-8");
    const store = JSON.parse(content) as Record<string, unknown>;

    // Auto-migrate legacy format
    if (migrateStoreIfNeeded(store)) {
      // Save migrated store
      saveCredentials(store as CredentialsStore);
    }

    return store as CredentialsStore;
  } catch {
    return {};
  }
}

export function saveCredentials(store: CredentialsStore): void {
  ensureCasfaDir();
  const credPath = getCredentialsPath();
  fs.writeFileSync(credPath, JSON.stringify(store, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
}

// ============================================================================
// CRUD Operations
// ============================================================================

export function getCredentials(profileName: string): Credentials | undefined {
  const store = loadCredentials();
  return store[profileName];
}

export function setCredentials(profileName: string, credentials: Credentials): void {
  const store = loadCredentials();
  store[profileName] = credentials;
  saveCredentials(store);
}

export function deleteCredentials(profileName: string): void {
  const store = loadCredentials();
  delete store[profileName];
  saveCredentials(store);
}

// ============================================================================
// User Token Operations
// ============================================================================

export function setUserToken(profileName: string, userToken: UserTokenCredential): void {
  const store = loadCredentials();
  const existing = store[profileName] ?? { version: 2 as const };
  store[profileName] = {
    ...existing,
    version: 2,
    userToken,
  };
  saveCredentials(store);
}

export function clearUserToken(profileName: string): void {
  const store = loadCredentials();
  const existing = store[profileName];
  if (existing) {
    delete existing.userToken;
    if (!existing.delegateToken) {
      delete store[profileName];
    }
    saveCredentials(store);
  }
}

// ============================================================================
// Delegate Token Operations
// ============================================================================

export function setDelegateToken(profileName: string, delegateToken: DelegateTokenCredential): void {
  const store = loadCredentials();
  const existing = store[profileName] ?? { version: 2 as const };
  store[profileName] = {
    ...existing,
    version: 2,
    delegateToken,
  };
  saveCredentials(store);
}

export function clearDelegateToken(profileName: string): void {
  const store = loadCredentials();
  const existing = store[profileName];
  if (existing) {
    delete existing.delegateToken;
    if (!existing.userToken) {
      delete store[profileName];
    }
    saveCredentials(store);
  }
}

// ============================================================================
// Token Expiration Utilities
// ============================================================================

/**
 * Check if user token is expired (with 60s buffer).
 */
export function isUserTokenExpired(cred: Credentials): boolean {
  if (!cred.userToken) return true;
  const expiresAt = cred.userToken.expiresAt;
  // Add 60 second buffer
  return Date.now() >= (expiresAt - 60) * 1000;
}

/**
 * Check if delegate token is expired.
 */
export function isDelegateTokenExpired(cred: Credentials): boolean {
  if (!cred.delegateToken) return true;
  const expiresAt = cred.delegateToken.expiresAt;
  if (!expiresAt) return false; // No expiry = never expires
  return Date.now() >= expiresAt * 1000;
}

/**
 * Format expiration time as human-readable string.
 */
export function formatExpiresIn(expiresAtSeconds: number | undefined): string {
  if (!expiresAtSeconds) {
    return "No expiry";
  }
  const now = Date.now();
  const expiresAt = expiresAtSeconds * 1000;
  if (now >= expiresAt) {
    return "Expired";
  }
  const diff = expiresAt - now;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}

/**
 * Get the primary auth type for display.
 */
export function getAuthType(cred: Credentials): string {
  if (cred.userToken && cred.delegateToken) {
    return "user+delegate";
  }
  if (cred.userToken) {
    return "user";
  }
  if (cred.delegateToken) {
    return "delegate";
  }
  return "none";
}

/**
 * Get expiration info for credentials.
 */
export function getExpirationInfo(cred: Credentials): { type: string; expiresIn: string } {
  if (cred.userToken) {
    return {
      type: "user",
      expiresIn: formatExpiresIn(cred.userToken.expiresAt),
    };
  }
  if (cred.delegateToken) {
    return {
      type: "delegate",
      expiresIn: formatExpiresIn(cred.delegateToken.expiresAt),
    };
  }
  return { type: "none", expiresIn: "N/A" };
}
