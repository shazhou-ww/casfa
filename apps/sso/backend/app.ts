import { Hono } from "hono";
import { cors } from "hono/cors";
import type { SsoConfig } from "./config.ts";
import { createSsoOAuthRoutes } from "./controllers/oauth.ts";
import type { OAuthServer } from "@casfa/cell-cognito-server";

export function createApp(deps: { config: SsoConfig; oauthServer: OAuthServer }) {
  const app = new Hono();
  const { config, oauthServer } = deps;

  app.use(
    "*",
    cors({
      origin: "*",
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    })
  );

  app.get("/", (c) => c.json({ ok: true, service: "sso" }, 200));
  app.get("/api/health", (c) => c.json({ ok: true }, 200));

  const oauthRoutes = createSsoOAuthRoutes({
    config,
    cognitoConfig: config.cognito,
    oauthServer,
  });
  app.route("/", oauthRoutes);

  return app;
}
