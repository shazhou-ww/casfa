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

// Access Token Authentication (new delegate model)
export {
  type AccessTokenMiddlewareDeps,
  createAccessTokenMiddleware,
} from "./access-token-auth.ts";

// ============================================================================
// Authorization
// ============================================================================

// Permission Check
export { createCanManageDepotMiddleware, createCanUploadMiddleware } from "./permission-check.ts";
// Proof Validation (X-CAS-Proof — replaces scope validation)
export {
  createMultiNodeProofMiddleware,
  createProofValidationMiddleware,
  type ProofValidationMiddlewareDeps,
  type ProofVerificationState,
} from "./proof-validation.ts";
// Realm Access
export {
  createAdminAccessMiddleware,
  createAuthorizedUserMiddleware,
  createRealmAccessMiddleware,
  createWriteAccessMiddleware,
} from "./realm-access.ts";
