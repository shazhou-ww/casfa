/**
 * @casfa/oauth-provider
 *
 * OAuth 2.1 Authorization Server provider package.
 * Framework-agnostic, implements RFC 8414 metadata, RFC 7591 dynamic client
 * registration, PKCE-enforced authorization code flow, and dual-mode
 * (JWT + opaque) bearer token authentication.
 *
 * Key capabilities:
 * 1. **Metadata** — RFC 8414 authorization server + RFC 9728 protected resource
 * 2. **Client Registration** — dynamic client registration with redirect URI validation
 * 3. **Authorization** — PKCE-enforced authorization code lifecycle
 * 4. **Token Grant** — token endpoint dispatching (authorization_code, refresh_token)
 * 5. **Dual Auth** — detect JWT vs opaque token, route to correct verifier
 * 6. **Scope & Redirect URI** — scope validation/mapping, redirect URI matching
 *
 * @packageDocumentation
 */

// ============================================================================
// Types
// ============================================================================

// Re-export JwtVerifier type (used by dual-auth)
export type {
  AuthCodeStore,
  AuthorizationCode,
  AuthorizationRequestParams,
  AuthServerConfig,
  ClientStore,
  JwtVerifier,
  OAuthClient,
  OAuthError,
  OpaqueTokenVerifier,
  Result,
  ScopeDefinition,
  TokenIssuer,
  TokenRequestParams,
  TokenResponse,
  ValidatedAuthRequest,
  VerifiedJwtIdentity,
} from "./types.ts";

// ============================================================================
// Metadata (RFC 8414 / RFC 9728)
// ============================================================================

export {
  generateAuthServerMetadata,
  generateProtectedResourceMetadata,
} from "./metadata.ts";

// ============================================================================
// Redirect URI
// ============================================================================

export { isRedirectUriAllowed } from "./redirect-uri.ts";

// ============================================================================
// Scope
// ============================================================================

export { mapScopes, validateScopes } from "./scope.ts";

// ============================================================================
// Client Registry (RFC 7591)
// ============================================================================

export { registerClient, resolveClient } from "./client-registry.ts";

// ============================================================================
// Authorization Code
// ============================================================================

export {
  consumeAuthorizationCode,
  createAuthorizationCode,
  validateAuthorizationRequest,
} from "./authorization.ts";

// ============================================================================
// Token Grant
// ============================================================================

export { handleTokenRequest } from "./token-grant.ts";

// ============================================================================
// Dual Auth (JWT + Opaque)
// ============================================================================

export { createDualAuthHandler, type DualAuthConfig } from "./dual-auth.ts";
