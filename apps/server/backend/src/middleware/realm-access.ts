/**
 * Realm Access Middleware
 *
 * Checks that the authenticated user/token has access to the requested realm.
 * Updated for Delegate Token model.
 */

import type { MiddlewareHandler } from "hono";
import type { Env } from "../types.ts";

/**
 * Create realm access check middleware
 *
 * Validates that the token's realm matches the requested realmId.
 * Works with both JWT auth and Token auth.
 */
export const createRealmAccessMiddleware = (): MiddlewareHandler<Env> => {
  return async (c, next) => {
    const auth = c.get("auth");
    if (!auth) {
      return c.json({ error: "UNAUTHORIZED", message: "Authentication required" }, 401);
    }

    const realmId = c.req.param("realmId");
    if (!realmId) {
      return c.json({ error: "INVALID_REQUEST", message: "Missing realmId" }, 400);
    }

    // Check realm access - token/user can only access their own realm
    if (auth.realm !== realmId) {
      return c.json(
        {
          error: "REALM_MISMATCH",
          message: "Token realm does not match the requested realmId",
        },
        403
      );
    }

    return next();
  };
};

/**
 * Create write access check middleware
 *
 * @deprecated Use createCanUploadMiddleware for new code
 *
 * This middleware is kept for backward compatibility with legacy auth.
 * For new Delegate Token flow, use createCanUploadMiddleware instead.
 */
export const createWriteAccessMiddleware = (): MiddlewareHandler<Env> => {
  return async (c, next) => {
    const auth = c.get("auth");
    if (!auth) {
      return c.json({ error: "UNAUTHORIZED", message: "Authentication required" }, 401);
    }

    // For new token types, check canUpload
    if (auth.type === "access" || auth.type === "delegate") {
      if (!auth.canUpload) {
        return c.json(
          { error: "UPLOAD_NOT_ALLOWED", message: "Token does not have upload permission" },
          403
        );
      }
      return next();
    }

    // For legacy JWT auth, allow write (user has full access to their realm)
    if (auth.type === "jwt") {
      return next();
    }

    return c.json({ error: "FORBIDDEN", message: "Write access denied" }, 403);
  };
};

/**
 * Create admin access check middleware
 *
 * Validates that the user has admin role.
 * Only works with JWT auth (tokens cannot be admins).
 */
export const createAdminAccessMiddleware = (): MiddlewareHandler<Env> => {
  return async (c, next) => {
    const auth = c.get("auth");
    if (!auth) {
      return c.json({ error: "UNAUTHORIZED", message: "Authentication required" }, 401);
    }

    // Only JWT auth can be admin
    if (auth.type !== "jwt") {
      return c.json(
        { error: "FORBIDDEN", message: "Admin access requires user authentication" },
        403
      );
    }

    if (auth.role !== "admin") {
      return c.json({ error: "FORBIDDEN", message: "Admin access required" }, 403);
    }

    return next();
  };
};

/**
 * Create authorized user check middleware
 *
 * Validates that the JWT-authenticated user has an "authorized" or "admin" role.
 * Blocks users with "unauthorized" role — they must be approved by an admin first.
 * Place this AFTER jwtAuthMiddleware on routes that require authorization.
 */
export const createAuthorizedUserMiddleware = (): MiddlewareHandler<Env> => {
  return async (c, next) => {
    const auth = c.get("auth");
    if (!auth) {
      return c.json({ error: "UNAUTHORIZED", message: "Authentication required" }, 401);
    }

    if (auth.type === "jwt" && auth.role === "unauthorized") {
      return c.json(
        {
          error: "FORBIDDEN",
          message: "Your account is pending approval. Please contact an administrator.",
        },
        403
      );
    }

    return next();
  };
};
