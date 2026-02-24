/**
 * @casfa/oauth-provider — Types
 *
 * Core type definitions for the OAuth 2.1 authorization server:
 * server configuration, clients, authorization codes, token exchange,
 * dual-auth, and storage adapter interfaces.
 */

// ============================================================================
// Result & Error
// ============================================================================

/**
 * Discriminated union for all function returns.
 * Forces callers to handle errors explicitly.
 */
export type Result<T, E = OAuthError> = { ok: true; value: T } | { ok: false; error: E };

/**
 * Standard OAuth error shape.
 * `code` uses RFC 6749 error codes where applicable.
 */
export type OAuthError = {
  /** Machine-readable error code (e.g. "invalid_grant", "invalid_client") */
  code: string;
  /** Human-readable description */
  message: string;
  /** Suggested HTTP status code */
  statusCode: number;
};

// ============================================================================
// Authorization Server Configuration
// ============================================================================

/**
 * OAuth 2.1 Authorization Server configuration.
 *
 * Used to generate RFC 8414 metadata and to validate requests.
 */
export type AuthServerConfig = {
  /** Authorization server issuer identifier (base URL) */
  issuer: string;
  /** URL of the authorization endpoint (may be a frontend route) */
  authorizationEndpoint: string;
  /** URL of the token endpoint */
  tokenEndpoint: string;
  /** URL of the dynamic client registration endpoint (optional) */
  registrationEndpoint?: string;
  /** Supported OAuth scopes with human-readable descriptions */
  supportedScopes: ScopeDefinition[];
  /** Supported grant types (e.g. ["authorization_code", "refresh_token"]) */
  supportedGrantTypes: string[];
  /** Supported response types (e.g. ["code"]) */
  supportedResponseTypes: string[];
  /** Supported PKCE code challenge methods (e.g. ["S256"]) */
  codeChallengeMethodsSupported: string[];
};

/**
 * Definition of an OAuth scope.
 */
export type ScopeDefinition = {
  /** Scope identifier (e.g. "cas:read") */
  name: string;
  /** Human-readable description (shown in consent UI) */
  description: string;
  /** Whether this scope is granted by default */
  default?: boolean;
};

// ============================================================================
// OAuth Client
// ============================================================================

/**
 * OAuth client record.
 *
 * Stored via {@link ClientStore} and used to validate authorization requests.
 */
export type OAuthClient = {
  /** Unique client identifier */
  clientId: string;
  /** Human-readable client name */
  clientName: string;
  /** Registered redirect URIs (supports "http://127.0.0.1:*" port wildcard) */
  redirectUris: string[];
  /** Allowed grant types */
  grantTypes: string[];
  /** Token endpoint authentication method */
  tokenEndpointAuthMethod: "none" | "client_secret_basic" | "client_secret_post";
  /** Registration timestamp (epoch ms) */
  createdAt: number;
};

// ============================================================================
// Authorization Code
// ============================================================================

/**
 * Authorization code record.
 *
 * Generic over `TGrant` to carry arbitrary business-specific permissions
 * (e.g. CASFA's `GrantedPermissions` with `canUpload`, `canManageDepot`).
 */
export type AuthorizationCode<TGrant = Record<string, unknown>> = {
  /** Random authorization code string */
  code: string;
  /** Client that initiated the authorization */
  clientId: string;
  /** Redirect URI from the authorization request */
  redirectUri: string;
  /** User identifier who approved the authorization */
  subject: string;
  /** Approved scopes */
  scopes: string[];
  /** PKCE code challenge (base64url-encoded SHA-256) */
  codeChallenge: string;
  /** Challenge method (always "S256") */
  codeChallengeMethod: "S256";
  /** Business-specific permissions chosen by the user */
  grantedPermissions: TGrant;
  /** Creation timestamp (epoch ms) */
  createdAt: number;
  /** Expiration timestamp (epoch ms) */
  expiresAt: number;
};

// ============================================================================
// Authorization Request
// ============================================================================

/**
 * Raw authorization request parameters (from query string).
 */
export type AuthorizationRequestParams = {
  responseType?: string;
  clientId?: string;
  redirectUri?: string;
  state?: string;
  scope?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
};

/**
 * Validated authorization request, ready for the consent UI.
 */
export type ValidatedAuthRequest = {
  /** Resolved client record */
  client: OAuthClient;
  /** Validated redirect URI */
  redirectUri: string;
  /** Validated scope list */
  scopes: string[];
  /** PKCE code challenge */
  codeChallenge: string;
  /** OAuth state parameter */
  state?: string;
};

// ============================================================================
// Token Endpoint
// ============================================================================

/**
 * Raw token request parameters (from POST body).
 */
export type TokenRequestParams = {
  grantType: string;
  /** authorization_code grant fields */
  code?: string;
  codeVerifier?: string;
  redirectUri?: string;
  clientId?: string;
  /** refresh_token grant fields */
  refreshToken?: string;
};

/**
 * Standard OAuth token response (snake_case per RFC 6749).
 */
export type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token?: string;
  scope?: string;
};

// ============================================================================
// Dual Auth
// ============================================================================

/**
 * JWT verifier function signature for dual-auth.
 *
 * Compatible with `@casfa/oauth-consumer`'s {@link JwtVerifier} type.
 */
export type JwtVerifier = (
  token: string
) => Promise<
  | { ok: true; value: VerifiedJwtIdentity }
  | { ok: false; error: { code: string; message: string; statusCode: number } }
>;

/**
 * Minimal identity returned by a JWT verifier.
 */
export type VerifiedJwtIdentity = {
  subject: string;
  email?: string;
  name?: string;
  expiresAt?: number;
  rawClaims: Record<string, unknown>;
};

/**
 * Opaque token verifier function signature.
 *
 * Receives raw token bytes (base64-decoded) and returns
 * a business-specific auth context.
 */
export type OpaqueTokenVerifier<TContext> = (
  tokenBytes: Uint8Array
) => Promise<
  | { ok: true; value: TContext }
  | { ok: false; error: { code: string; message: string; statusCode: number } }
>;

// ============================================================================
// Storage Adapters (implemented by consumers of this package)
// ============================================================================

/**
 * Authorization code storage interface.
 *
 * `consume` MUST be atomic — it must return the code AND mark it as used
 * in a single operation to prevent double-spend. For example, using
 * DynamoDB's conditional writes or PostgreSQL's `UPDATE ... RETURNING`.
 */
export type AuthCodeStore<TGrant = Record<string, unknown>> = {
  /** Persist a newly created authorization code */
  save: (code: AuthorizationCode<TGrant>) => Promise<void>;
  /**
   * Atomically retrieve and consume an authorization code.
   *
   * Returns `null` if the code doesn't exist, is already consumed, or has expired.
   * Must prevent double-spend via atomic operations.
   */
  consume: (code: string) => Promise<AuthorizationCode<TGrant> | null>;
};

/**
 * OAuth client storage interface.
 */
export type ClientStore = {
  /** Look up a client by ID */
  get: (clientId: string) => Promise<OAuthClient | null>;
  /** Persist a client (create or update) */
  save: (client: OAuthClient) => Promise<void>;
};

/**
 * Token issuer callback interface.
 *
 * Implemented by the application to handle business-specific token creation.
 * The OAuth protocol layer (this package) handles code consumption, PKCE verification,
 * and grant_type dispatch; the TokenIssuer handles the actual token generation.
 */
export type TokenIssuer<TGrant> = {
  /**
   * Issue tokens from a consumed authorization code.
   *
   * Called after the code has been consumed and PKCE verified.
   * The implementation should create the necessary business entities
   * (e.g. delegates) and generate the actual tokens.
   */
  issueFromAuthCode: (params: {
    /** User who approved the authorization */
    subject: string;
    /** OAuth client ID */
    clientId: string;
    /** Approved scopes */
    scopes: string[];
    /** Business-specific permissions from the authorization code */
    grantedPermissions: TGrant;
  }) => Promise<
    | { ok: true; value: TokenResponse }
    | { ok: false; error: { code: string; message: string; statusCode: number } }
  >;

  /**
   * Issue new tokens from a refresh token.
   *
   * The implementation should validate the refresh token,
   * perform rotation if applicable, and return new tokens.
   */
  issueFromRefresh: (params: {
    /** Raw refresh token string */
    refreshToken: string;
  }) => Promise<
    | { ok: true; value: TokenResponse }
    | { ok: false; error: { code: string; message: string; statusCode: number } }
  >;
};
