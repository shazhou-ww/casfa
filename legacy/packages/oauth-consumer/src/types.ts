/**
 * @casfa/oauth-consumer — Types
 *
 * Core type definitions for OIDC consumer operations:
 * JWT verification, IdP configuration, and token exchange.
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
 * Standard error shape used across the package.
 */
export type OAuthError = {
  /** Machine-readable error code (e.g. "invalid_token", "discovery_failed") */
  code: string;
  /** Human-readable description */
  message: string;
  /** Suggested HTTP status code */
  statusCode: number;
};

// ============================================================================
// IdP Configuration
// ============================================================================

/**
 * OIDC Identity Provider configuration.
 *
 * Can be built manually or obtained via {@link discoverIdpConfig}.
 * Works with any OIDC-compliant provider: Cognito, Auth0, Keycloak, etc.
 */
export type IdpConfig = {
  /** Issuer identifier (e.g. "https://cognito-idp.us-east-1.amazonaws.com/{poolId}") */
  issuer: string;
  /** Authorization endpoint URL */
  authorizationEndpoint: string;
  /** Token endpoint URL */
  tokenEndpoint: string;
  /** JWKS endpoint URL for public key discovery */
  jwksUri: string;
  /** OAuth client_id */
  clientId: string;
  /** OAuth client_secret (omit for public clients) */
  clientSecret?: string;
};

// ============================================================================
// JWT Verification
// ============================================================================

/**
 * Standardized identity extracted from a verified JWT.
 */
export type VerifiedIdentity = {
  /** User identifier (from `sub` claim by default, customizable via extractSubject) */
  subject: string;
  /** Email address (from `email` claim) */
  email?: string;
  /** Display name (from `name` claim) */
  name?: string;
  /** Token expiration as Unix timestamp in seconds */
  expiresAt?: number;
  /** All raw JWT claims for custom extraction */
  rawClaims: Record<string, unknown>;
};

/**
 * JWT verifier function signature.
 *
 * Created by {@link createJwtVerifier} or {@link createMockJwtVerifier}.
 * Returns a Result — never throws.
 */
export type JwtVerifier = (token: string) => Promise<Result<VerifiedIdentity>>;

// ============================================================================
// IdP Token Exchange
// ============================================================================

/**
 * Token set returned by an IdP after code exchange or refresh.
 */
export type IdpTokenSet = {
  /** OAuth access token */
  accessToken: string;
  /** OIDC ID token (if openid scope was requested) */
  idToken?: string;
  /** Refresh token (may not always be returned) */
  refreshToken?: string;
  /** Token lifetime in seconds */
  expiresIn?: number;
  /** Token type (typically "Bearer") */
  tokenType: string;
};
