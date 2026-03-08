/**
 * When using SSO: only login redirect, logout redirect, and .well-known. No token/callback on this cell.
 */
import { buildClearAuthCookieHeader } from "@casfa/cell-auth-server";
import type { ServerConfig } from "../config.ts";
import type { Env } from "../types.ts";
import type { PendingClientInfoStore } from "@casfa/cell-delegates-server";
import { Hono } from "hono";
import { getRequestBaseUrl } from "../request-url.ts";

const PENDING_CLIENT_TTL_SEC = 3600; // 1 hour

export function createLoginRedirectRoutes(
  config: ServerConfig,
  deps: { pendingClientInfoStore: PendingClientInfoStore }
) {
  const routes = new Hono<Env>();
  const ssoBaseUrl = config.ssoBaseUrl;
  const { pendingClientInfoStore } = deps;

  if (!ssoBaseUrl) {
    return routes;
  }

  routes.get("/oauth/login", (c) => {
    const baseUrl = getRequestBaseUrl(c);
    const returnUrl = c.req.query("return_url") ?? baseUrl;
    const auth = c.get("auth");
    if (auth) {
      return c.redirect(returnUrl);
    }
    const url = new URL(`${ssoBaseUrl}/login`);
    url.searchParams.set("return_url", returnUrl);
    return c.redirect(url.toString());
  });

  routes.get("/oauth/logout", (c) => {
    const auth = config.auth;
    if (auth.cookieName) {
      const clearHeader = buildClearAuthCookieHeader({
        cookieName: auth.cookieName,
        cookiePath: auth.cookiePath ?? "/",
        cookieDomain: auth.cookieDomain,
        sameSite: "Strict",
      });
      c.header("Set-Cookie", clearHeader);
    }
    const base = getRequestBaseUrl(c).replace(/\/$/, "");
    return c.redirect(`${base}/oauth/login`);
  });

  routes.get("/.well-known/oauth-authorization-server", (c) => {
    const base = getRequestBaseUrl(c).replace(/\/$/, "");
    return c.json({
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["use_mcp", "file_read", "file_write", "branch_manage", "manage_delegates"],
    });
  });

  // Stub for MCP clients that require dynamic client registration; real client_id (delegateId) is issued at first authorize.
  routes.post("/oauth/register", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { client_name?: string; redirect_uris?: string[] };
    const clientId = "mcp";
    const clientName = body.client_name?.trim() || "MCP Client";
    await pendingClientInfoStore.put(clientId, clientName, PENDING_CLIENT_TTL_SEC);
    return c.json(
      {
        client_id: clientId,
        client_name: clientName,
        redirect_uris: body.redirect_uris ?? [],
      },
      201
    );
  });

  routes.get("/oauth/client-info", async (c) => {
    const clientId = c.req.query("client_id")?.trim();
    if (!clientId) return c.json({ error: "missing client_id" }, 400);
    const clientName = await pendingClientInfoStore.get(clientId);
    if (!clientName) return c.json({ error: "client not found" }, 404);
    return c.json({ client_name: clientName });
  });

  routes.delete("/oauth/client-info", async (c) => {
    const clientId = c.req.query("client_id")?.trim();
    if (!clientId) return c.json({ error: "missing client_id" }, 400);
    await pendingClientInfoStore.delete(clientId);
    return c.json({ ok: true }, 200);
  });

  return routes;
}
