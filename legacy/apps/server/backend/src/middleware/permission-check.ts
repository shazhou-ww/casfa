/**
 * Permission Check Middleware
 *
 * Checks specific permission flags on tokens.
 *
 * Based on docs/delegate-token-refactor/impl/03-middleware-refactor.md
 */

import type { MiddlewareHandler } from "hono";
import type { Env, TokenAuthContext } from "../types.ts";

// ============================================================================
// canUpload Middleware
// ============================================================================

/**
 * Create middleware that checks canUpload permission
 *
 * Use this for PUT /nodes/:key endpoints.
 */
export const createCanUploadMiddleware = (): MiddlewareHandler<Env> => {
  return async (c, next) => {
    const auth = c.get("auth") as TokenAuthContext;
    if (!auth) {
      return c.json({ error: "UNAUTHORIZED", message: "Authentication required" }, 401);
    }

    if (!auth.canUpload) {
      return c.json(
        {
          error: "UPLOAD_NOT_ALLOWED",
          message: "Token does not have upload permission",
        },
        403
      );
    }

    return next();
  };
};

// ============================================================================
// canManageDepot Middleware
// ============================================================================

/**
 * Create middleware that checks canManageDepot permission
 *
 * Use this for depot creation, update, and deletion endpoints.
 */
export const createCanManageDepotMiddleware = (): MiddlewareHandler<Env> => {
  return async (c, next) => {
    const auth = c.get("auth") as TokenAuthContext;
    if (!auth) {
      return c.json({ error: "UNAUTHORIZED", message: "Authentication required" }, 401);
    }

    if (!auth.canManageDepot) {
      return c.json(
        {
          error: "DEPOT_MANAGE_NOT_ALLOWED",
          message: "Token does not have depot management permission",
        },
        403
      );
    }

    return next();
  };
};
