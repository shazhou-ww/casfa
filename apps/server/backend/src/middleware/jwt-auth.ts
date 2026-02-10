/**
 * JWT Authentication Middleware
 *
 * Verifies User JWT tokens for Token management and user operations.
 * Based on docs/delegate-token-refactor/impl/03-middleware-refactor.md
 */

import type { MiddlewareHandler } from "hono";
import type { UserRolesDb } from "../db/user-roles.ts";
import type { Env, JwtAuthContext } from "../types.ts";

// ============================================================================
// Types
// ============================================================================

/**
 * JWT Verifier callback type
 *
 * Verifies a JWT token and returns user info.
 * Returns null if verification fails.
 */
export type JwtVerifier = (
  token: string
) => Promise<{ userId: string; exp?: number; email?: string; name?: string } | null>;

export type JwtAuthMiddlewareDeps = {
  jwtVerifier: JwtVerifier;
  userRolesDb: UserRolesDb;
};

// ============================================================================
// Middleware Factory
// ============================================================================

/**
 * Create JWT authentication middleware
 *
 * This middleware only handles User JWT tokens.
 * Use delegateTokenMiddleware or accessTokenMiddleware for Delegate Tokens.
 */
export const createJwtAuthMiddleware = (deps: JwtAuthMiddlewareDeps): MiddlewareHandler<Env> => {
  const { jwtVerifier, userRolesDb } = deps;

  return async (c, next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader) {
      return c.json({ error: "UNAUTHORIZED", message: "Missing Authorization header" }, 401);
    }

    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer") {
      return c.json({ error: "UNAUTHORIZED", message: "Invalid Authorization header format" }, 401);
    }

    const token = parts[1]!;

    // JWT verification
    try {
      const result = await jwtVerifier(token);
      if (!result) {
        return c.json({ error: "UNAUTHORIZED", message: "Invalid JWT" }, 401);
      }

      const { userId, exp, email, name } = result;

      // Get user role
      const role = await userRolesDb.getRole(userId);

      const auth: JwtAuthContext = {
        type: "jwt",
        userId,
        realm: userId,
        email,
        name,
        role,
        expiresAt: exp ? exp * 1000 : Date.now() + 3600000,
      };

      c.set("auth", auth);
      return next();
    } catch {
      return c.json({ error: "UNAUTHORIZED", message: "JWT verification failed" }, 401);
    }
  };
};
