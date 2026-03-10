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

// Node Authorization (Direct Authorization Check — replaces proof validation)
export {
  createNodeAuthMiddleware,
  type NodeAuthMiddlewareDeps,
} from "./node-auth.ts";
// Permission Check
export { createCanManageDepotMiddleware, createCanUploadMiddleware } from "./permission-check.ts";
// Proof Validation (X-CAS-Proof — legacy, kept for backward compatibility)
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
