/**
 * Realm Access Middleware
 *
 * Checks that the authenticated user has access to the requested realm.
 */

import type { MiddlewareHandler } from "hono";
import type { Env } from "../types.ts";

/**
 * Create realm access check middleware
 */
export const createRealmAccessMiddleware = (): MiddlewareHandler<Env> => {
  return async (c, next) => {
    const auth = c.get("auth");
    if (!auth) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const realmId = c.req.param("realmId");
    if (!realmId) {
      return c.json({ error: "Missing realmId" }, 400);
    }

    // Check realm access - user can only access their own realm
    if (auth.realm !== realmId) {
      return c.json({ error: "Access denied to this realm" }, 403);
    }

    return next();
  };
};

/**
 * Create write access check middleware
 */
export const createWriteAccessMiddleware = (): MiddlewareHandler<Env> => {
  return async (c, next) => {
    const auth = c.get("auth");
    if (!auth) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    if (!auth.canWrite) {
      return c.json({ error: "Write access denied" }, 403);
    }

    return next();
  };
};

/**
 * Create admin access check middleware
 */
export const createAdminAccessMiddleware = (): MiddlewareHandler<Env> => {
  return async (c, next) => {
    const auth = c.get("auth");
    if (!auth) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    if (!auth.canManageUsers) {
      return c.json({ error: "Admin access required" }, 403);
    }

    return next();
  };
};
