import type { Context, Next } from "hono";
import type { Env } from "../types.ts";

/**
 * Requires that auth was already set by the global auth middleware (oauthServer.resolveAuth + branch token fallback).
 * Use on routes under /api/realm/*, /api/me, /api/mcp. Returns 401 if no auth.
 */
export function createAuthMiddleware(_deps?: unknown) {
  return async function authMiddleware(c: Context<Env>, next: Next) {
    const auth = c.get("auth");
    if (!auth) {
      return c.json({ error: "UNAUTHORIZED", message: "Missing or invalid Authorization" }, 401);
    }
    return next();
  };
}
