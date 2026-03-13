/**
 * Derive the request's base URL (origin) from Host and X-Forwarded-* headers.
 * Use for issuer, callback URIs, and cookie scope when supporting multiple domains.
 */
import type { Context } from "hono";

export function getRequestBaseUrl(c: Context): string {
  const host = (c.req.header("X-Forwarded-Host") ?? c.req.header("Host") ?? "").trim();
  if (!host) return "http://localhost";

  const forwardedProto = (c.req.header("X-Forwarded-Proto") ?? "").trim();
  const normalizedForwardedProto = forwardedProto.replace(/:$/, "").toLowerCase();
  const proto =
    normalizedForwardedProto === "http" || normalizedForwardedProto === "https"
      ? normalizedForwardedProto
      : (host.includes("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");

  return `${proto}://${host}`.replace(/\/$/, "");
}
