/**
 * @casfa/auth
 *
 * AWP Authentication package for server-side auth handling.
 * Uses ECDSA P-256 keypair-based authentication with server-generated
 * verification codes for anti-phishing protection.
 *
 * @example
 * ```typescript
 * import {
 *   createAwpAuthMiddleware,
 *   routeAuthRequest,
 *   MemoryPendingAuthStore,
 *   MemoryPubkeyStore,
 * } from "@casfa/auth";
 *
 * // Create stores (use DynamoDB/Redis in production)
 * const pendingAuthStore = new MemoryPendingAuthStore();
 * const pubkeyStore = new MemoryPubkeyStore();
 *
 * // Create middleware
 * const authMiddleware = createAwpAuthMiddleware({
 *   pendingAuthStore,
 *   pubkeyStore,
 * });
 *
 * // In your request handler:
 * Bun.serve({
 *   fetch: async (req) => {
 *     // Handle auth endpoints
 *     const authResponse = await routeAuthRequest(req, {
 *       baseUrl: "https://example.com",
 *       pendingAuthStore,
 *       pubkeyStore,
 *     });
 *     if (authResponse) return authResponse;
 *
 *     // Check authentication
 *     const result = await authMiddleware(req);
 *     if (!result.authorized) {
 *       return result.challengeResponse!;
 *     }
 *
 *     // Proceed with authenticated request
 *     // result.context contains { userId, pubkey, clientName }
 *   },
 * });
 * ```
 */

// ============================================================================
// Middleware
// ============================================================================

export {
  type AuthRouterOptions,
  type AwpAuthMiddleware,
  createAwpAuthMiddleware,
  hasAwpAuthCredentials,
  routeAuthRequest,
} from "./middleware.ts";

// ============================================================================
// Auth Init (for custom implementations)
// ============================================================================

export {
  generateVerificationCode,
  type HandleAuthInitOptions,
  type HandleAuthStatusOptions,
  handleAuthInit,
  handleAuthStatus,
  MemoryPendingAuthStore,
} from "./auth-init.ts";

// ============================================================================
// Auth Complete (for custom implementations)
// ============================================================================

export {
  type AuthCompleteResult,
  completeAuthorization,
  type HandleAuthCompleteOptions,
  handleAuthComplete,
  MemoryPubkeyStore,
} from "./auth-complete.ts";

// ============================================================================
// AWP Auth (low-level utilities)
// ============================================================================

export {
  buildChallengeResponse,
  validateTimestamp,
  verifyAwpAuth,
  verifySignature,
} from "./awp-auth.ts";

// ============================================================================
// Types
// ============================================================================

export type {
  AuthCompleteRequest,
  // Auth context and result
  AuthContext,
  // HTTP
  AuthHttpRequest,
  // Request/Response types
  AuthInitRequest,
  AuthInitResponse,
  AuthorizedPubkey,
  AuthResult,
  AuthStatusResponse,
  // Config
  AwpAuthConfig,
  ChallengeBody,
  // Stores
  PendingAuth,
  PendingAuthStore,
  PubkeyStore,
} from "./types.ts";

// Constants
export { AWP_AUTH_DEFAULTS, AWP_AUTH_HEADERS } from "./types.ts";
