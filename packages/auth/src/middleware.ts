/**
 * AWP Auth Middleware
 *
 * Single authentication scheme: ECDSA P-256 keypair-based auth.
 */

import { handleAuthInit, handleAuthStatus } from "./auth-init.ts";
import { buildChallengeResponse, hasAwpAuthCredentials, verifyAwpAuth } from "./awp-auth.ts";
import type { AuthHttpRequest, AuthResult, AwpAuthConfig } from "./types.ts";
import { AWP_AUTH_DEFAULTS } from "./types.ts";

// ============================================================================
// Path Checking
// ============================================================================

/**
 * Check if a path should be excluded from authentication
 */
function shouldExcludePath(path: string, excludePaths: string[]): boolean {
  return excludePaths.some((excludePath) => {
    // Exact match
    if (path === excludePath) {
      return true;
    }
    // Prefix match with trailing slash
    if (excludePath.endsWith("/") && path.startsWith(excludePath)) {
      return true;
    }
    return false;
  });
}

/**
 * Check if a path is an auth endpoint
 */
function _isAuthPath(path: string, config: AwpAuthConfig): boolean {
  const authInitPath = config.authInitPath ?? AWP_AUTH_DEFAULTS.authInitPath;
  const authStatusPath = config.authStatusPath ?? AWP_AUTH_DEFAULTS.authStatusPath;
  const authPagePath = config.authPagePath ?? AWP_AUTH_DEFAULTS.authPagePath;

  return path === authInitPath || path === authStatusPath || path.startsWith(authPagePath);
}

// ============================================================================
// Auth Middleware
// ============================================================================

/**
 * AWP Auth middleware function type
 */
export type AwpAuthMiddleware = (request: AuthHttpRequest) => Promise<AuthResult>;

/**
 * Create AWP authentication middleware
 *
 * @param config - Auth configuration with stores
 * @returns Middleware function that validates requests
 *
 * @example
 * ```typescript
 * const authMiddleware = createAwpAuthMiddleware({
 *   pendingAuthStore: new MemoryPendingAuthStore(),
 *   pubkeyStore: new MemoryPubkeyStore(),
 * });
 *
 * // In your request handler:
 * const result = await authMiddleware(request);
 * if (!result.authorized) {
 *   return result.challengeResponse;
 * }
 * // Proceed with authenticated request using result.context
 * ```
 */
export function createAwpAuthMiddleware(config: AwpAuthConfig): AwpAuthMiddleware {
  // Build list of excluded paths
  const authInitPath = config.authInitPath ?? AWP_AUTH_DEFAULTS.authInitPath;
  const authStatusPath = config.authStatusPath ?? AWP_AUTH_DEFAULTS.authStatusPath;
  const authPagePath = config.authPagePath ?? AWP_AUTH_DEFAULTS.authPagePath;
  const maxClockSkew = config.maxClockSkew ?? AWP_AUTH_DEFAULTS.maxClockSkew;

  const excludePaths = [
    authInitPath,
    authStatusPath,
    `${authPagePath}/`,
    "/health",
    "/healthz",
    "/ping",
    ...(config.excludePaths ?? []),
  ];

  return async (request: AuthHttpRequest): Promise<AuthResult> => {
    const url = new URL(request.url);
    const path = url.pathname;

    // Check if path should be excluded from authentication
    if (shouldExcludePath(path, excludePaths)) {
      return {
        authorized: true,
        context: undefined,
      };
    }

    // Check if this is the auth page path (exact match, not API)
    if (path === authPagePath) {
      return {
        authorized: true,
        context: undefined,
      };
    }

    // Check for AWP auth credentials
    if (!hasAwpAuthCredentials(request)) {
      // No credentials - return challenge
      const challengeResponse = buildChallengeResponse(authInitPath);
      return {
        authorized: false,
        challengeResponse,
      };
    }

    // Verify the request signature
    const result = await verifyAwpAuth(request, config.pubkeyStore, maxClockSkew);

    // If verification failed, return challenge response
    if (!result.authorized) {
      const challengeResponse = buildChallengeResponse(authInitPath);
      return {
        authorized: false,
        challengeResponse,
      };
    }

    return result;
  };
}

// ============================================================================
// Auth Request Router
// ============================================================================

/**
 * Options for the auth router
 */
export interface AuthRouterOptions extends AwpAuthConfig {
  /** Base URL for building auth URLs */
  baseUrl: string;
}

/**
 * Route auth-related requests to appropriate handlers
 *
 * This handles /auth/init and /auth/status automatically.
 * Returns null if the request is not an auth endpoint.
 *
 * @example
 * ```typescript
 * const authResponse = await routeAuthRequest(request, options);
 * if (authResponse) {
 *   return authResponse;
 * }
 * // Continue with normal request handling
 * ```
 */
export async function routeAuthRequest(
  request: AuthHttpRequest,
  options: AuthRouterOptions
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;

  const authInitPath = options.authInitPath ?? AWP_AUTH_DEFAULTS.authInitPath;
  const authStatusPath = options.authStatusPath ?? AWP_AUTH_DEFAULTS.authStatusPath;

  // Handle /auth/init
  if (path === authInitPath) {
    return handleAuthInit(request, {
      baseUrl: options.baseUrl,
      pendingAuthStore: options.pendingAuthStore,
      authPagePath: options.authPagePath,
      verificationCodeTTL: options.verificationCodeTTL,
    });
  }

  // Handle /auth/status
  if (path === authStatusPath) {
    return handleAuthStatus(request, {
      pubkeyStore: options.pubkeyStore,
      pendingAuthStore: options.pendingAuthStore,
    });
  }

  // Not an auth endpoint
  return null;
}

// ============================================================================
// Utility: Check for credentials
// ============================================================================

export { hasAwpAuthCredentials } from "./awp-auth.ts";
