/**
 * JWT Authentication Middleware
 *
 * Verifies User JWT tokens for Token management and user operations.
 * Uses `@casfa/oauth-consumer`'s `JwtVerifier` (Result-based API).
 */

import type { JwtVerifier } from "@casfa/oauth-consumer";
import type { MiddlewareHandler } from "hono";
import type { UserRolesDb } from "../db/user-roles.ts";
import type { Env, JwtAuthContext } from "../types.ts";

// Re-export JwtVerifier so existing imports from this module still work
export type { JwtVerifier } from "@casfa/oauth-consumer";

// ============================================================================
// Types
// ============================================================================

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

    // JWT verification — Result-based API (never throws)
    const result = await jwtVerifier(token);
    if (!result.ok) {
      return c.json({ error: "UNAUTHORIZED", message: result.error.message }, 401);
    }

    const { subject: userId, expiresAt, email, name } = result.value;

    // Get user role
    const role = await userRolesDb.getRole(userId);

    const auth: JwtAuthContext = {
      type: "jwt",
      userId,
      realm: userId,
      email,
      name,
      role,
      expiresAt: expiresAt ? expiresAt * 1000 : Date.now() + 3600000,
    };

    c.set("auth", auth);
    return next();
  };
};
