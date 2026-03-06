import { validateCsrf } from "@casfa/cell-oauth";
import type { Context, Next } from "hono";
import type { Env } from "../types.ts";

const CSRF_COOKIE_NAME = "csrf_token";
const CSRF_HEADER_NAME = "X-CSRF-Token";

/**
 * When SSO is enabled, require valid CSRF for mutating methods. Use after auth middleware.
 */
export function createCsrfMiddleware() {
  return async function csrfMiddleware(c: Context<Env>, next: Next) {
    const method = c.req.method;
    if (method !== "POST" && method !== "PUT" && method !== "PATCH" && method !== "DELETE") {
      return next();
    }
    const valid = validateCsrf(c.req.raw, {
      cookieName: CSRF_COOKIE_NAME,
      headerName: CSRF_HEADER_NAME,
    });
    if (!valid) {
      return c.json({ error: "FORBIDDEN", message: "Invalid or missing CSRF token" }, 403);
    }
    return next();
  };
}
