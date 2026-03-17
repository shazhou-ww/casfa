/**
 * When using SSO: only login redirect, logout redirect, and .well-known. No token/callback on this cell.
 */
import { buildClearAuthCookieHeader } from "@casfa/cell-auth-server";
import { buildClearRefreshCookieHeader } from "@casfa/cell-auth-server";
import type { ServerConfig } from "../config.ts";
import type { Env } from "../types.ts";
import type { PendingClientInfoStore } from "@casfa/cell-delegates-server";
import { Hono } from "hono";
import { getRequestBaseUrl } from "../request-url.ts";

const PENDING_CLIENT_TTL_SEC = 3600; // 1 hour

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function resolveSsoRefreshCookiePath(ssoBaseUrl: string): string {
  try {
    const path = new URL(ssoBaseUrl).pathname.replace(/\/+$/, "");
    return `${path || ""}/oauth/refresh`;
  } catch {
    return "/oauth/refresh";
  }
}

export function resolveSsoBaseUrlForRequest(ssoBaseUrl: string, requestBaseUrl: string): string {
  try {
    const configured = new URL(ssoBaseUrl);
    const request = new URL(requestBaseUrl);
    const configuredPath = configured.pathname.replace(/\/+$/, "");
    if (configured.origin === request.origin) {
      return `${configured.origin}${configuredPath}`;
    }
    if (isLoopbackHost(configured.hostname) && isLoopbackHost(request.hostname)) {
      return `${request.origin}${configuredPath}`;
    }
    return `${configured.origin}${configuredPath}`;
  } catch {
    return ssoBaseUrl.replace(/\/+$/, "");
  }
}

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

  routes.get("/api/oauth/login", (c) => {
    const baseUrl = getRequestBaseUrl(c);
    const returnUrl = c.req.query("return_url") ?? baseUrl;
    const auth = c.get("auth");
    if (auth) {
      return c.redirect(returnUrl);
    }
    const requestScopedSsoBaseUrl = resolveSsoBaseUrlForRequest(ssoBaseUrl, baseUrl);
    const url = new URL(`${requestScopedSsoBaseUrl}/`);
    url.searchParams.set("return_url", returnUrl);
    return c.redirect(url.toString());
  });

  routes.get("/api/oauth/logout", (c) => {
    const auth = config.auth;
    if (auth.cookieName) {
      const clearHeader = buildClearAuthCookieHeader({
        cookieName: auth.cookieName,
        cookiePath: auth.cookiePath ?? "/",
        cookieDomain: auth.cookieDomain,
        sameSite: "Strict",
      });
      c.header("Set-Cookie", clearHeader);
      const refreshCookiePath = resolveSsoRefreshCookiePath(ssoBaseUrl);
      const clearRefreshHeader = buildClearRefreshCookieHeader({
        cookieName: "auth_refresh",
        cookiePath: refreshCookiePath,
        cookieDomain: auth.cookieDomain,
        sameSite: "Strict",
      });
      c.res.headers.append("Set-Cookie", clearRefreshHeader);
    }
    const base = getRequestBaseUrl(c).replace(/\/$/, "");
    return c.redirect(`${base}/api/oauth/login`);
  });

  routes.get("/api/oauth/authorize", (c) => {
    const base = getRequestBaseUrl(c).replace(/\/$/, "");
    const qs = new URL(c.req.url).search;
    return c.redirect(`${base}/oauth/authorize${qs}`);
  });

  routes.get("/.well-known/oauth-authorization-server", (c) => {
    const base = getRequestBaseUrl(c).replace(/\/$/, "");
    return c.json({
      issuer: base,
      authorization_endpoint: `${base}/api/oauth/authorize`,
      token_endpoint: `${base}/api/oauth/token`,
      registration_endpoint: `${base}/api/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["use_mcp", "file_read", "file_write", "branch_manage", "manage_delegates"],
    });
  });

  /** RFC 9728 Protected Resource Metadata for MCP OAuth discovery (e.g. agent client). */
  routes.get("/.well-known/oauth-protected-resource", (c) => {
    const base = getRequestBaseUrl(c).replace(/\/$/, "");
    return c.json({
      authorization_servers: [base],
      resource: base,
      scopes_supported: ["use_mcp", "file_read", "file_write", "branch_manage", "manage_delegates"],
    });
  });

  // Stub for MCP clients that require dynamic client registration; real client_id (delegateId) is issued at first authorize.
  routes.post("/api/oauth/register", async (c) => {
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

  routes.get("/api/oauth/client-info", async (c) => {
    const clientId = c.req.query("client_id")?.trim();
    if (!clientId) return c.json({ error: "missing client_id" }, 400);
    const clientName = await pendingClientInfoStore.get(clientId);
    if (!clientName) return c.json({ error: "client not found" }, 404);
    return c.json({ client_name: clientName });
  });

  routes.delete("/api/oauth/client-info", async (c) => {
    const clientId = c.req.query("client_id")?.trim();
    if (!clientId) return c.json({ error: "missing client_id" }, 400);
    await pendingClientInfoStore.delete(clientId);
    return c.json({ ok: true }, 200);
  });

  return routes;
}
