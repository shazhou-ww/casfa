/**
 * When using SSO: only login redirect and .well-known. No token/callback on this cell.
 */
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

  routes.get("/.well-known/oauth-authorization-server", (c) => {
    return c.json({
      issuer: ssoBaseUrl,
      authorization_endpoint: `${ssoBaseUrl}/oauth/authorize`,
      token_endpoint: `${ssoBaseUrl}/oauth/token`,
      registration_endpoint: `${ssoBaseUrl}/oauth/register`,
    });
  });

  return routes;
}
