/**
 * Middleware exports
 */

// ============================================================================
// JWT Authentication
// ============================================================================

export {
  createJwtAuthMiddleware,
  type JwtAuthMiddlewareDeps,
  type JwtVerifier,
} from "./jwt-auth.ts";

// ============================================================================
// Token Authentication
// ============================================================================

// Access Token Authentication
export {
  type AccessTokenMiddlewareDeps,
  createAccessTokenMiddleware,
} from "./access-token-auth.ts";

// Delegate Token Authentication
export {
  createDelegateTokenMiddleware,
  type DelegateTokenMiddlewareDeps,
} from "./delegate-token-auth.ts";
// Common token validation
export {
  type TokenValidationFailure,
  type TokenValidationResult,
  type TokenValidationSuccess,
  validateToken,
} from "./token-auth-common.ts";

// ============================================================================
// Authorization
// ============================================================================

// Permission Check
export { createCanManageDepotMiddleware, createCanUploadMiddleware } from "./permission-check.ts";
// Realm Access
export {
  createAdminAccessMiddleware,
  createRealmAccessMiddleware,
  createWriteAccessMiddleware,
} from "./realm-access.ts";
// Scope Validation
export {
  createScopeValidationMiddleware,
  type ScopeValidationMiddlewareDeps,
} from "./scope-validation.ts";
