import type { Context } from "hono";

export function getRequestBaseUrl(c: Context): string {
  const host = c.req.header("X-Forwarded-Host") ?? c.req.header("Host") ?? "";
  const proto = c.req.header("X-Forwarded-Proto") ?? (host.includes("localhost") ? "http" : "https");
  const base = `${proto}://${host}`.replace(/\/$/, "");
  return base || "http://localhost";
}
