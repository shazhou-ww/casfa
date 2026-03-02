/**
 * GET /api/me: no auth → 401; Bearer JWT (user) → 200 with userId (and optional email, name, picture).
 */
import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import type { Env } from "../../types.ts";
import { createAuthMiddleware } from "../../middleware/auth.ts";
import { createMeController } from "../../controllers/me.ts";
import { createMemoryDelegateGrantStore } from "../../db/delegate-grants.ts";
import { createMemoryUserSettingsStore } from "../../db/user-settings.ts";
import { createMemoryDelegateStore } from "@casfa/realm";

function makeJwt(sub: string, extra?: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const payload = btoa(JSON.stringify({ sub, ...extra }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${header}.${payload}.sig`;
}

describe("GET /api/me", () => {
  it("returns 401 when Authorization header is missing", async () => {
    const delegateStore = createMemoryDelegateStore();
    const delegateGrantStore = createMemoryDelegateGrantStore();
    const userSettingsStore = createMemoryUserSettingsStore();
    const auth = createAuthMiddleware({ delegateGrantStore, delegateStore });
    const me = createMeController({ userSettingsStore });
    const app = new Hono<Env>()
      .use("/api/me", auth)
      .get("/api/me", (c) => me.get(c));
    const res = await app.request("http://localhost/api/me");
    expect(res.status).toBe(401);
  });

  it("returns 200 with userId when Bearer is valid JWT (user)", async () => {
    const delegateStore = createMemoryDelegateStore();
    const delegateGrantStore = createMemoryDelegateGrantStore();
    const userSettingsStore = createMemoryUserSettingsStore();
    const auth = createAuthMiddleware({ delegateGrantStore, delegateStore });
    const me = createMeController({ userSettingsStore });
    const app = new Hono<Env>()
      .use("/api/me", auth)
      .get("/api/me", (c) => me.get(c));
    const jwt = makeJwt("user-123");
    const res = await app.request("http://localhost/api/me", {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { userId: string; email?: string; name?: string; picture?: string };
    expect(body.userId).toBe("user-123");
  });

  it("returns 403 when auth is delegate (not user)", async () => {
    const delegateStore = createMemoryDelegateStore();
    const delegateGrantStore = createMemoryDelegateGrantStore();
    const userSettingsStore = createMemoryUserSettingsStore();
    const auth = createAuthMiddleware({ delegateGrantStore, delegateStore });
    const me = createMeController({ userSettingsStore });
    const app = new Hono<Env>()
      .use("/api/me", auth)
      .get("/api/me", (c) => me.get(c));
    const jwt = makeJwt("user-456");
    const tokenHash = await (async () => {
      const bytes = new TextEncoder().encode(jwt);
      const hash = await crypto.subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(hash))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    })();
    await delegateGrantStore.insert({
      delegateId: "d1",
      realmId: "user-456",
      clientId: "client-x",
      accessTokenHash: tokenHash,
      refreshTokenHash: null,
      permissions: ["file_read"],
      createdAt: Date.now(),
      expiresAt: null,
    });
    const res = await app.request("http://localhost/api/me", {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    expect(res.status).toBe(403);
  });
});
