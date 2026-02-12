import * as fs from "node:fs";
import * as path from "node:path";
import { ensureCasfaDir, getCasfaDir } from "./config";

// ============================================================================
// Credential Types (Two-tier Token System)
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
 * Root Delegate credential (metadata only).
 *
 * Created via POST /api/tokens/root.
 * Root delegate operations use the user's JWT directly for authentication,
 * so no RT/AT pair is stored.
 */
export interface RootDelegateCredential {
  /** Delegate entity ID */
  delegateId: string;
  /** Realm this delegate belongs to */
  realm: string;
  /** Delegate depth (0 = root) */
  depth: number;
  /** Whether the delegate can upload nodes */
  canUpload: boolean;
  /** Whether the delegate can manage depots */
  canManageDepot: boolean;
}

/**
 * Credential structure supporting the two-tier token system.
 */
export interface Credentials {
  /** Version for migration support */
  version: 3;
  /** User JWT token from OAuth login */
  userToken?: UserTokenCredential;
  /** Root Delegate with RT + AT pair */
  rootDelegate?: RootDelegateCredential;
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

/** Version 2 credential with old delegate token format */
export interface LegacyV2Credentials {
  version: 2;
  userToken?: UserTokenCredential;
  delegateToken?: {
    tokenId: string;
    token: string;
    issuerId?: string;
    expiresAt?: number;
    realm?: string;
    canUpload?: boolean;
    canManageDepot?: boolean;
  };
}

export type LegacyCredentials = LegacyTokenCredentials | LegacyOAuthCredentials;

// ============================================================================
// Store Types
// ============================================================================

export interface CredentialsStore {
  [profileName: string]: Credentials;
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
 * Check if the credential is in legacy format (v0/v1).
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
 * Check if the credential is in legacy v2 format.
 */
function isLegacyV2Credential(cred: unknown): cred is LegacyV2Credentials {
  return (
    typeof cred === "object" &&
    cred !== null &&
    "version" in cred &&
    (cred as { version: number }).version === 2 &&
    "delegateToken" in cred
  );
}

/**
 * Migrate a legacy credential to the new format.
 */
function migrateLegacyCredential(legacy: LegacyCredentials): Credentials {
  if (legacy.type === "oauth") {
    return {
      version: 3,
      userToken: {
        accessToken: legacy.accessToken,
        refreshToken: legacy.refreshToken,
        expiresAt: legacy.expiresAt,
      },
    };
  }
  // legacy.type === "token" — old token cannot be migrated to root delegate
  // User needs to re-login
  return {
    version: 3,
  };
}

/**
 * Migrate a v2 credential to v3.
 * Note: old delegateToken cannot be directly migrated to rootDelegate,
 * only userToken is preserved.
 */
function migrateV2Credential(v2: LegacyV2Credentials): Credentials {
  return {
    version: 3,
    userToken: v2.userToken,
    // delegateToken is dropped — user needs to re-login to get rootDelegate
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
    } else if (isLegacyV2Credential(cred)) {
      store[profileName] = migrateV2Credential(cred);
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
  const existing = store[profileName] ?? { version: 3 as const };
  store[profileName] = {
    ...existing,
    version: 3,
    userToken,
  };
  saveCredentials(store);
}

export function clearUserToken(profileName: string): void {
  const store = loadCredentials();
  const existing = store[profileName];
  if (existing) {
    delete existing.userToken;
    if (!existing.rootDelegate) {
      delete store[profileName];
    }
    saveCredentials(store);
  }
}

// ============================================================================
// Root Delegate Operations
// ============================================================================

export function setRootDelegate(profileName: string, rootDelegate: RootDelegateCredential): void {
  const store = loadCredentials();
  const existing = store[profileName] ?? { version: 3 as const };
  store[profileName] = {
    ...existing,
    version: 3,
    rootDelegate,
  };
  saveCredentials(store);
}

export function clearRootDelegate(profileName: string): void {
  const store = loadCredentials();
  const existing = store[profileName];
  if (existing) {
    delete existing.rootDelegate;
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
 * Check if root delegate needs re-creation.
 * Root delegates use JWT auth directly, so there's no AT to expire.
 * Returns true only if no root delegate exists.
 */
export function isRootDelegateMissing(cred: Credentials): boolean {
  return !cred.rootDelegate;
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
  if (cred.userToken && cred.rootDelegate) {
    return "user+delegate";
  }
  if (cred.userToken) {
    return "user";
  }
  if (cred.rootDelegate) {
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
  if (cred.rootDelegate) {
    return {
      type: "delegate",
      expiresIn: "N/A (uses JWT)",
    };
  }
  return { type: "none", expiresIn: "N/A" };
}
