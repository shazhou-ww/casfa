import { Hono } from "hono";
import type { Env, ErrorBody } from "./types.ts";

export function createApp(_deps: {
  port: number;
  storage: { type: "memory" };
  auth: Record<string, unknown>;
}) {
  const app = new Hono<Env>();
  app.get("/api/health", (c) => c.json({ ok: true }, 200));
  app.get("/api/info", (c) =>
    c.json({ storageType: "memory", authType: "mock" }, 200)
  );
  app.onError((err, c) => {
    const body: ErrorBody = {
      error: "INTERNAL_ERROR",
      message: err.message ?? "Internal server error",
    };
    return c.json(body, 500);
  });
  return app;
}
