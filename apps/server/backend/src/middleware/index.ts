/**
 * Middleware exports
 */

// ============================================================================
// JWT Authentication
// ============================================================================

export { createJwtAuthMiddleware, type JwtAuthMiddlewareDeps, type JwtVerifier } from "./jwt-auth.ts";

// ============================================================================
// Token Authentication
// ============================================================================

// Common token validation
export {
  validateToken,
  type TokenValidationResult,
  type TokenValidationSuccess,
  type TokenValidationFailure,
} from "./token-auth-common.ts";

// Delegate Token Authentication
export {
  createDelegateTokenMiddleware,
  type DelegateTokenMiddlewareDeps,
} from "./delegate-token-auth.ts";

// Access Token Authentication
export {
  createAccessTokenMiddleware,
  type AccessTokenMiddlewareDeps,
} from "./access-token-auth.ts";

// ============================================================================
// Authorization
// ============================================================================

// Scope Validation
export {
  createScopeValidationMiddleware,
  type ScopeValidationMiddlewareDeps,
} from "./scope-validation.ts";

// Permission Check
export { createCanManageDepotMiddleware, createCanUploadMiddleware } from "./permission-check.ts";

// Realm Access
export {
  createAdminAccessMiddleware,
  createRealmAccessMiddleware,
  createWriteAccessMiddleware,
} from "./realm-access.ts";
