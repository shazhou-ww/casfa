/**
 * Client configuration and callback types.
 */

import type { ServiceInfo } from "@casfa/protocol";
import type { HashProvider, StorageProvider } from "./providers.ts";
import type { TokenState } from "./tokens.ts";

// ============================================================================
// Provider Types
// ============================================================================

/**
 * Token storage provider for persistence.
 * Allows users to persist tokens to localStorage, file, etc.
 */
export type TokenStorageProvider = {
  /** Load persisted token state */
  load: () => Promise<TokenState | null>;
  /** Save token state */
  save: (state: TokenState) => Promise<void>;
  /** Clear all persisted tokens */
  clear: () => Promise<void>;
};

// ============================================================================
// Callback Types
// ============================================================================

/**
 * Callback when token state changes.
 * Called after any token is added, removed, or refreshed.
 */
export type OnTokenChangeCallback = (state: TokenState) => void;

/**
 * Callback when authentication is required.
 * Called when token refresh fails and user needs to re-login.
 */
export type OnAuthRequiredCallback = () => void;

// ============================================================================
// Client Configuration
// ============================================================================

/**
 * Configuration for creating a CASFA client.
 */
export type ClientConfig = {
  /** Base URL of the CASFA server (e.g., "https://api.casfa.app") */
  baseUrl: string;
  /** Realm ID this client operates on (e.g., "usr_abc123") */
  realm: string;
  /** Optional token storage provider for persistence */
  tokenStorage?: TokenStorageProvider;
  /** Optional CAS block storage provider for caching */
  storage?: StorageProvider;
  /** Optional hash provider for node operations */
  hash?: HashProvider;
  /** Default TTL for auto-issued tokens (seconds). If not set, uses server max. */
  defaultTokenTtl?: number;
  /** Callback when token state changes */
  onTokenChange?: OnTokenChangeCallback;
  /** Callback when auth is required (refresh failed) */
  onAuthRequired?: OnAuthRequiredCallback;
};

// ============================================================================
// Client Types
// ============================================================================

/**
 * Internal client context passed to API functions.
 */
export type ClientContext = {
  baseUrl: string;
  realm: string;
  storage?: StorageProvider;
  hash?: HashProvider;
  /** Server info (fetched on init) */
  serverInfo: ServiceInfo | null;
  /** Get current token state */
  getTokenState: () => TokenState;
  /** Get auth header for API calls */
  getAuthHeader: (requirement: "user" | "delegate" | "access") => Promise<string | null>;
  /** Ensure Access Token exists and is from max issuer */
  ensureAccessToken: () => Promise<void>;
  /** Ensure Delegate Token exists */
  ensureDelegateToken: () => Promise<void>;
};

/**
 * Fetch result type.
 */
export type FetchResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: ClientError };

/**
 * Client error type.
 */
export type ClientError = {
  code: string;
  message: string;
  status?: number;
  details?: unknown;
};
