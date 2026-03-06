import { Hono } from "hono";
import { cors } from "hono/cors";
import type { SsoConfig } from "./config.ts";

export function createApp(deps: { config: SsoConfig }) {
  const app = new Hono();
  const { config } = deps;

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

  // OAuth routes will be mounted in Task 5
  return app;
}
