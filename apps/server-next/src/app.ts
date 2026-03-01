import { Hono } from "hono";

type Env = Record<string, unknown>;

export function createApp(_deps: { port: number; storage: { type: "memory" }; auth: Record<string, unknown> }) {
  const app = new Hono<Env>();
  app.get("/api/health", (c) => c.json({ ok: true }, 200));
  app.get("/api/info", (c) =>
    c.json({ storageType: "memory", authType: "mock" }, 200)
  );
  return app;
}
