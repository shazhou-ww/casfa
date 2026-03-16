export { createAppForGateway as createAppForBackend } from "./gateway-app";
export { createAppForGateway } from "./gateway-app";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { SsoConfig } from "./config.ts";
import { createSsoOAuthRoutes } from "./controllers/oauth.ts";
import type { OAuthServer } from "@casfa/cell-cognito-server";
import { getRequestBaseUrl } from "./request-url.ts";
import type { RefreshSessionStore } from "./refresh-session-store.ts";

export function createApp(deps: {
  config: SsoConfig;
  oauthServer: OAuthServer;
  refreshSessionStore: RefreshSessionStore;
}) {
  const app = new Hono();
  const { config, oauthServer } = deps;

  app.use(
    "*",
    cors({
      origin: (origin) => origin ?? "*",
      allowHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      credentials: true,
    })
  );

  app.get("/", (c) => c.json({ ok: true, service: "sso" }, 200));
  app.get("/api/health", (c) => c.json({ ok: true }, 200));

  // Login page is served by frontend; if request hits backend (e.g. wrong port), redirect to frontend.
  app.get("/login", (c) => {
    const base = getRequestBaseUrl(c).replace(/\/$/, "");
    const q = c.req.url.includes("?") ? "?" + new URL(c.req.url).searchParams.toString() : "";
    return c.redirect(`${base}/login${q}`, 302);
  });

  const oauthRoutes = createSsoOAuthRoutes({
    config,
    cognitoConfig: config.cognito,
    oauthServer,
    refreshSessionStore: deps.refreshSessionStore,
  });
  app.route("/", oauthRoutes);

  return app;
}
