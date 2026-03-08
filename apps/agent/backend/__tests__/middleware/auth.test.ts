/**
 * Auth middleware: no auth -> 401; auth set -> next.
 */
import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { createAuthMiddleware } from "../../middleware/auth.ts";
import type { Env } from "../../types.ts";

describe("auth middleware", () => {
  it("returns 401 when auth is not set", async () => {
    const auth = createAuthMiddleware();
    const app = new Hono<Env>().use("*", auth).get("/", (c) => c.json(c.get("auth")));
    const res = await app.request("http://localhost/");
    expect(res.status).toBe(401);
  });

  it("calls next and returns auth when auth is set", async () => {
    const auth = createAuthMiddleware();
    const app = new Hono<Env>()
      .use("*", (c, next) => {
        c.set("auth", { type: "user", userId: "user-123", email: "u@example.com" });
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
