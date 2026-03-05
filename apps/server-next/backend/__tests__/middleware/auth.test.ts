/**
 * Auth middleware tests: requires auth to be set (by global middleware).
 * Resolution (oauthServer.resolveAuth + branch token) is in app.ts global middleware.
 */
import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import type { Env } from "../../types.ts";
import { createAuthMiddleware } from "../../middleware/auth.ts";

describe("auth middleware", () => {
  it("returns 401 when auth is not set", async () => {
    const auth = createAuthMiddleware();
    const app = new Hono<Env>().use("*", auth).get("/", (c) => c.json(c.get("auth")));
    const res = await app.request("http://localhost/");
    expect(res.status).toBe(401);
  });

  it("returns 401 when Authorization header is missing and no auth set", async () => {
    const auth = createAuthMiddleware();
    const app = new Hono<Env>().use("*", auth).get("/", (c) => c.json(c.get("auth")));
    const res = await app.request("http://localhost/", {
      headers: { Authorization: "Bearer something" },
    });
    expect(res.status).toBe(401);
  });

  it("calls next and returns auth when auth is set (e.g. by global middleware)", async () => {
    const auth = createAuthMiddleware();
    const app = new Hono<Env>()
      .use("*", (c, next) => {
        c.set("auth", { type: "user", userId: "user-123" });
        return next();
      })
      .use("*", auth)
      .get("/", (c) => c.json(c.get("auth")));
    const res = await app.request("http://localhost/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { type: string; userId: string };
    expect(body.type).toBe("user");
    expect(body.userId).toBe("user-123");
  });
});
