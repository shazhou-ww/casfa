/**
 * GET /api/csrf: issue CSRF cookie for this origin (double submit). Only when using SSO.
 */
import { buildCsrfCookieHeader, generateCsrfToken } from "@casfa/cell-auth-server";
import type { ServerConfig } from "../config.ts";
import { Hono } from "hono";
import type { Env } from "../types.ts";

const CSRF_COOKIE_NAME = "csrf_token";

export function createCsrfController(config: ServerConfig) {
  const app = new Hono<Env>();
  const ssoBaseUrl = config.ssoBaseUrl;
  const secure = config.baseUrl.startsWith("https://");

  if (!ssoBaseUrl) {
    app.get("/api/csrf", (c) => c.json({ error: "SSO not configured" }, 404));
    return app;
  }

  app.get("/api/csrf", (c) => {
    const token = generateCsrfToken();
    const header = buildCsrfCookieHeader(token, {
      cookieName: CSRF_COOKIE_NAME,
      secure,
      sameSite: "Strict",
    });
    c.header("Set-Cookie", header);
    return c.json({ token }, 200);
  });

  return app;
}
