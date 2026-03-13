/**
 * Derive the request's base URL (origin) from Host and X-Forwarded-* headers.
 * Use for issuer and redirects when supporting multiple domains.
 */
import type { Context } from "hono";

export function getRequestBaseUrl(c: Context): string {
  const host = c.req.header("X-Forwarded-Host") ?? c.req.header("Host") ?? "";
  const proto = c.req.header("X-Forwarded-Proto") ?? (host.includes("localhost") ? "http" : "https");
  const base = `${proto}://${host}`.replace(/\/$/, "");
  return base || "http://localhost";
}
