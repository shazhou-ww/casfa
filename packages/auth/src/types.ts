/**
 * AWP Authentication Types
 *
 * Single authentication scheme: ECDSA P-256 keypair-based auth
 * with server-generated verification codes for anti-phishing protection.
 */

// ============================================================================
// Pending Auth (for authorization flow)
// ============================================================================

/**
 * Pending authorization record
 *
 * Created when a client initiates the auth flow, stored until
 * the user completes authorization or it expires.
 */
export interface PendingAuth {
  /** Client's public key (base64url encoded) */
  pubkey: string;
  /** Client name for display to user */
  clientName: string;
  /** Server-generated verification code */
  verificationCode: string;
  /** When this pending auth was created (unix timestamp ms) */
  createdAt: number;
  /** When this pending auth expires (unix timestamp ms) */
  expiresAt: number;
}

/**
 * Store interface for pending authorizations
 *
 * Implementations can use in-memory, Redis, DynamoDB, etc.
 */
export interface PendingAuthStore {
  /**
   * Create a new pending authorization
   */
  create(auth: PendingAuth): Promise<void>;

  /**
   * Get pending authorization by pubkey
   * @returns null if not found or expired
   */
  get(pubkey: string): Promise<PendingAuth | null>;

  /**
   * Delete pending authorization (after completion or expiry)
   */
  delete(pubkey: string): Promise<void>;

  /**
   * Validate verification code for a pubkey
   * @returns true if code matches and not expired
   */
  validateCode(pubkey: string, code: string): Promise<boolean>;
}

// ============================================================================
// Pubkey Store (for authorized clients)
// ============================================================================

/**
 * Authorized pubkey record
 */
export interface AuthorizedPubkey {
  /** Client's public key */
  pubkey: string;
  /** Associated user ID */
  userId: string;
  /** Client name */
  clientName: string;
  /** When this authorization was created */
  createdAt: number;
  /** When this authorization expires (optional) */
  expiresAt?: number;
}

/**
 * Store interface for authorized pubkeys
 *
 * Maps pubkeys to user IDs for request verification.
 */
export interface PubkeyStore {
  /**
   * Look up an authorized pubkey
   * @returns user info if authorized, null if not found or expired
   */
  lookup(pubkey: string): Promise<AuthorizedPubkey | null>;

  /**
   * Store an authorized pubkey
   */
  store(auth: AuthorizedPubkey): Promise<void>;

  /**
   * Revoke a pubkey authorization
   */
  revoke(pubkey: string): Promise<void>;

  /**
   * List all authorized pubkeys for a user (optional)
   */
  listByUser?(userId: string): Promise<AuthorizedPubkey[]>;
}

// ============================================================================
// Auth Configuration
// ============================================================================

/**
 * AWP Auth configuration
 */
export interface AwpAuthConfig {
  /**
   * Path for auth initiation endpoint
   * @default "/auth/init"
   */
  authInitPath?: string;

  /**
   * Path for auth status polling endpoint
   * @default "/auth/status"
   */
  authStatusPath?: string;

  /**
   * Path for auth page (where user enters verification code)
   * @default "/auth"
   */
  authPagePath?: string;

  /**
   * Store for pending authorizations
   */
  pendingAuthStore: PendingAuthStore;

  /**
   * Store for authorized pubkeys
   */
  pubkeyStore: PubkeyStore;

  /**
   * TTL for verification codes in seconds
   * @default 600 (10 minutes)
   */
  verificationCodeTTL?: number;

  /**
   * Maximum allowed clock skew for request signatures in seconds
   * @default 300 (5 minutes)
   */
  maxClockSkew?: number;

  /**
   * Paths to exclude from authentication
   * Auth endpoints are automatically excluded.
   */
  excludePaths?: string[];
}

// ============================================================================
// Auth Context
// ============================================================================

/**
 * Authentication context attached to request after successful authentication.
 */
export interface AuthContext {
  /** The authenticated user's ID */
  userId: string;
  /** The client's public key */
  pubkey: string;
  /** The client name */
  clientName: string;
}

// ============================================================================
// Auth Result
// ============================================================================

/**
 * Result of authentication check
 */
export interface AuthResult {
  /** Whether the request is authorized */
  authorized: boolean;
  /** Auth context if authorized */
  context?: AuthContext;
  /** Challenge response to return if not authorized (401) */
  challengeResponse?: Response;
}

// ============================================================================
// HTTP Types
// ============================================================================

/**
 * HTTP Request interface (compatible with Fetch API, Bun, etc.)
 */
export interface AuthHttpRequest {
  method: string;
  url: string;
  headers: Headers | Record<string, string>;
  text(): Promise<string>;
  clone(): AuthHttpRequest;
}

// ============================================================================
// Auth Init Types
// ============================================================================

/**
 * Request body for POST /auth/init
 */
export interface AuthInitRequest {
  /** Client's public key (base64url encoded, format: x.y) */
  pubkey: string;
  /** Client name for display */
  client_name: string;
}

/**
 * Response from POST /auth/init
 */
export interface AuthInitResponse {
  /** URL for user to visit to complete authorization */
  auth_url: string;
  /** Server-generated verification code to display to user */
  verification_code: string;
  /** Seconds until this authorization request expires */
  expires_in: number;
  /** Recommended polling interval in seconds */
  poll_interval: number;
}

/**
 * Request body for auth completion (user submits verification code)
 */
export interface AuthCompleteRequest {
  /** Client's public key */
  pubkey: string;
  /** Verification code entered by user */
  verification_code: string;
}

/**
 * Response from auth status polling
 */
export interface AuthStatusResponse {
  /** Whether the authorization is complete */
  authorized: boolean;
  /** Error message if authorization failed */
  error?: string;
  /** Expiration time for the authorized key (unix timestamp) */
  expires_at?: number;
}

// ============================================================================
// 401 Challenge Response
// ============================================================================

/**
 * 401 Challenge response body
 */
export interface ChallengeBody {
  error: "unauthorized";
  error_description: string;
  /** Endpoint for initiating authorization */
  auth_init_endpoint: string;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Default configuration values
 */
export const AWP_AUTH_DEFAULTS = {
  authInitPath: "/auth/init",
  authStatusPath: "/auth/status",
  authPagePath: "/auth",
  verificationCodeTTL: 600, // 10 minutes
  maxClockSkew: 300, // 5 minutes
  pollInterval: 5, // 5 seconds
} as const;

/**
 * AWP Auth header names
 */
export const AWP_AUTH_HEADERS = {
  pubkey: "X-AWP-Pubkey",
  timestamp: "X-AWP-Timestamp",
  signature: "X-AWP-Signature",
} as const;
