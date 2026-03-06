/**
 * When using SSO: only login redirect, logout redirect, and .well-known. No token/callback on this cell.
 */
import { buildClearAuthCookieHeader } from "@casfa/cell-auth-server";
import type { ServerConfig } from "../config.ts";
import type { Env } from "../types.ts";
import { Hono } from "hono";

export function createLoginRedirectRoutes(config: ServerConfig) {
  const routes = new Hono<Env>();
  const ssoBaseUrl = config.ssoBaseUrl;

  if (!ssoBaseUrl) {
    return routes;
  }

  routes.get("/oauth/login", (c) => {
    const returnUrl = c.req.query("return_url") ?? config.baseUrl;
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
    const base = config.baseUrl.replace(/\/$/, "");
    return c.redirect(`${base}/oauth/login`);
  });

  routes.get("/.well-known/oauth-authorization-server", (c) => {
    // Resource server (server-next) is the OAuth issuer for MCP delegate flow. Authorize/token/register
    // are on this cell; user login (when not logged in) goes to SSO via /oauth/login.
    const base = config.baseUrl.replace(/\/$/, "");
    return c.json({
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["delegate"],
    });
  });

  return routes;
}
