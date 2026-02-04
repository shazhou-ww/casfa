/**
 * Authorization strategy types for CasfaClient.
 * Each strategy determines which APIs are accessible and how requests are authenticated.
 */

// =============================================================================
// User Auth (OAuth)
// =============================================================================

/**
 * Callbacks for OAuth user authentication flow.
 */
export type UserAuthCallbacks = {
  /**
   * Called when user authentication is required.
   * Implementation should redirect user to authUrl and return the authorization code.
   * @param authUrl - The OAuth authorization URL to redirect to
   * @returns The authorization code from the OAuth callback
   */
  onAuthRequired: (authUrl: string) => Promise<string>;

  /**
   * Called when token refresh fails (e.g., 401 response).
   * @param error - The error that occurred
   * @returns Retry interval in ms, or null to stop retrying and call onAuthRequired
   */
  onRefreshFailed: (error: Error) => number | null;

  /**
   * Called to attempt silent token refresh (e.g., using refresh_token).
   * If not provided or returns null, will fall back to onRefreshFailed.
   * @returns New access token, or null if silent refresh not possible
   */
  onSilentRefresh?: () => Promise<string | null>;
};

/**
 * User authentication state.
 */
export type UserAuthState = {
  type: "user";
  /** Current access token (JWT) */
  accessToken: string | null;
  /** Refresh token for obtaining new access tokens */
  refreshToken: string | null;
  /** Token expiration timestamp (ms since epoch) */
  expiresAt: number | null;
};

// =============================================================================
// Token Auth (Agent Token)
// =============================================================================

/**
 * Agent Token authentication - direct token usage.
 */
export type TokenAuthState = {
  type: "token";
  /** The agent token value (casfa_...) */
  token: string;
};

// =============================================================================
// P256 Auth (AWP Client)
// =============================================================================

/**
 * Polling status during P256 client authorization.
 */
export type P256PollStatus = {
  /** Whether authorization is complete */
  authorized: boolean;
  /** Client ID being authorized */
  clientId: string;
  /** Human-readable status message */
  message?: string;
};

/**
 * Callbacks for P256 client authentication flow.
 */
export type P256AuthCallbacks = {
  /**
   * Called when client authorization is required.
   * Implementation should display the authorization URL and verification code to user.
   * @param authUrl - URL for user to visit and authorize
   * @param displayCode - Verification code to show user for confirmation
   */
  onAuthRequired: (authUrl: string, displayCode: string) => void;

  /**
   * Called during authorization polling to report status.
   * @param status - Current authorization status
   * @returns Next poll interval in ms, or null to stop polling
   */
  onPollStatus: (status: P256PollStatus) => number | null;
};

/**
 * P256 client authentication state.
 */
export type P256AuthState = {
  type: "p256";
  /** Client ID (base32 encoded public key hash) */
  clientId: string | null;
  /** Whether the client is authorized */
  authorized: boolean;
};

// =============================================================================
// Ticket Auth
// =============================================================================

/**
 * Ticket authentication state.
 */
export type TicketAuthState = {
  type: "ticket";
  /** The ticket ID */
  ticketId: string;
  /** Realm ID this ticket is scoped to */
  realmId: string | null;
  /** Permitted scopes (read paths) */
  scope: string[] | null;
  /** Whether ticket has write permission */
  writable: boolean | null;
  /** Ticket expiration timestamp (ms since epoch) */
  expiresAt: number | null;
};

// =============================================================================
// Combined Types
// =============================================================================

/**
 * Union of all authentication states.
 */
export type AuthState = UserAuthState | TokenAuthState | P256AuthState | TicketAuthState;

/**
 * Authorization type identifier.
 */
export type AuthType = AuthState["type"];

/**
 * Configuration for creating an auth strategy.
 */
export type AuthConfig =
  | { type: "user"; callbacks: UserAuthCallbacks }
  | { type: "token"; token: string }
  | { type: "p256"; callbacks: P256AuthCallbacks }
  | { type: "ticket"; ticketId: string; realmId?: string };

/**
 * Internal auth strategy with state management.
 */
export type AuthStrategy = {
  /** Get current authentication state */
  getState: () => AuthState;
  /** Get authorization header value for requests */
  getAuthHeader: () => Promise<string | null>;
  /** Get custom headers for P256 signature auth */
  getCustomHeaders?: () => Promise<Record<string, string>>;
  /** Initialize or refresh authentication */
  initialize: () => Promise<void>;
  /** Handle 401 unauthorized response */
  handleUnauthorized: () => Promise<boolean>;
};
