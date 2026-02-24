/**
 * @casfa/oauth-consumer
 *
 * OIDC consumer package for authenticating users via external Identity Providers.
 * Framework-agnostic, works with any OIDC-compliant IdP (Cognito, Auth0, Keycloak, etc.).
 *
 * Two main capabilities:
 * 1. **JWT Verification** — validate tokens issued by an IdP
 * 2. **IdP Interaction** — build auth URLs, exchange codes, refresh tokens
 *
 * @packageDocumentation
 */

// ============================================================================
// Types
// ============================================================================

export type {
  IdpConfig,
  IdpTokenSet,
  JwtVerifier,
  OAuthError,
  Result,
  VerifiedIdentity,
} from "./types.ts";

// ============================================================================
// Discovery
// ============================================================================

export { discoverIdpConfig } from "./discovery.ts";

// ============================================================================
// JWT Verification
// ============================================================================

export {
  createJwtVerifier,
  createMockJwt,
  createMockJwtVerifier,
  type JwtVerifierConfig,
} from "./jwt-verifier.ts";

// ============================================================================
// IdP Client
// ============================================================================

export {
  type AuthorizationUrlParams,
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  refreshIdpToken,
} from "./idp-client.ts";
