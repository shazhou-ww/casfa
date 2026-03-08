import type { Context, Next } from "hono";
import type { Env } from "../types.ts";

/**
 * Requires auth to be set by the global auth middleware. Returns 401 if no auth.
 */
export function createAuthMiddleware() {
  return async function authMiddleware(c: Context<Env>, next: Next) {
    const auth = c.get("auth");
    if (!auth) {
      return c.json({ error: "UNAUTHORIZED", message: "Missing or invalid Authorization" }, 401);
    }
    return next();
  };
}
