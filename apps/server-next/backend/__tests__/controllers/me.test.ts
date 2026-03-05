/**
 * GET /api/me: no auth → 401; Bearer with user auth → 200; delegate auth → 403.
 * Auth is set by global middleware (oauthServer.resolveAuth + branch); here we simulate it.
 */
import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { createMeController } from "../../controllers/me.ts";
import { createMemoryUserSettingsStore } from "../../db/user-settings.ts";
import { createAuthMiddleware } from "../../middleware/auth.ts";
import type { Env } from "../../types.ts";

describe("GET /api/me", () => {
  it("returns 401 when Authorization header is missing", async () => {
    const userSettingsStore = createMemoryUserSettingsStore();
    const auth = createAuthMiddleware();
    const me = createMeController({ userSettingsStore });
    const app = new Hono<Env>().use("/api/me", auth).get("/api/me", (c) => me.get(c));
    const res = await app.request("http://localhost/api/me");
    expect(res.status).toBe(401);
  });

  it("returns 200 with userId when auth is user", async () => {
    const userSettingsStore = createMemoryUserSettingsStore();
    const auth = createAuthMiddleware();
    const me = createMeController({ userSettingsStore });
    const app = new Hono<Env>()
      .use("/api/me", (c, next) => {
        c.set("auth", { type: "user", userId: "user-123" });
        return next();
      })
      .use("/api/me", auth)
      .get("/api/me", (c) => me.get(c));
    const res = await app.request("http://localhost/api/me", {
      headers: { Authorization: "Bearer any" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      userId: string;
      email?: string;
      name?: string;
      picture?: string;
    };
    expect(body.userId).toBe("user-123");
  });

  it("returns 403 when auth is delegate (not user)", async () => {
    const userSettingsStore = createMemoryUserSettingsStore();
    const auth = createAuthMiddleware();
    const me = createMeController({ userSettingsStore });
    const app = new Hono<Env>()
      .use("/api/me", (c, next) => {
        c.set("auth", {
          type: "delegate",
          realmId: "user-456",
          delegateId: "d1",
          clientId: "client-x",
          permissions: ["file_read"],
        });
        return next();
      })
      .use("/api/me", auth)
      .get("/api/me", (c) => me.get(c));
    const res = await app.request("http://localhost/api/me", {
      headers: { Authorization: "Bearer any" },
    });
    expect(res.status).toBe(403);
  });
});
