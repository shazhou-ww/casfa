import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { DelegateGrant, DelegateGrantStore } from "../types.ts";
import { createMemoryAuthCodeStore } from "../auth-code-store.ts";
import { createDelegateOAuthRoutes } from "../delegate-oauth-routes.ts";

type AuthVar = { userId: string };

function createMemoryGrantStore(): DelegateGrantStore {
  const byId = new Map<string, DelegateGrant>();
  return {
    async list(userId: string) {
      return Array.from(byId.values()).filter((g) => g.userId === userId);
    },
    async get(delegateId: string) {
      return byId.get(delegateId) ?? null;
    },
    async getByAccessTokenHash() {
      return null;
    },
    async getByRefreshTokenHash() {
      return null;
    },
    async insert(grant: DelegateGrant) {
      byId.set(grant.delegateId, grant);
    },
    async remove(delegateId: string) {
      byId.delete(delegateId);
    },
    async updateTokens(delegateId: string, update: { accessTokenHash: string; refreshTokenHash: string | null }) {
      const g = byId.get(delegateId);
      if (g) byId.set(delegateId, { ...g, ...update });
    },
  };
}

async function s256Challenge(verifier: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function createTestApp() {
  const grantStore = createMemoryGrantStore();
  const authCodeStore = createMemoryAuthCodeStore();
  const oauthRoutes = createDelegateOAuthRoutes<{ Variables: { auth: AuthVar } }>({
    grantStore,
    authCodeStore,
    getUserId: (auth) => (auth && typeof auth === "object" && "userId" in auth ? (auth as AuthVar).userId : ""),
    baseUrl: "https://example.com",
    allowedScopes: ["use_mcp"],
  });
  const app = new Hono<{ Variables: { auth: AuthVar } }>();
  app.use("*", async (c, next) => {
    const userId = c.req.header("x-test-user-id");
    if (userId) c.set("auth", { userId });
    await next();
  });
  app.route("/", oauthRoutes);
  return { app, grantStore, authCodeStore };
}

describe("createDelegateOAuthRoutes", () => {
  test("authorize without auth returns 401", async () => {
    const { app } = createTestApp();
    const res = await app.request("/api/oauth/delegate/authorize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        redirect_uri: "https://client.example/cb",
        state: "s1",
        code_challenge: "ch",
      }),
    });
    expect(res.status).toBe(401);
  });

  test("authorize with auth returns 200 and redirect_url", async () => {
    const { app } = createTestApp();
    const code_verifier = "v_" + Math.random().toString(36).slice(2);
    const code_challenge = await s256Challenge(code_verifier);
    const res = await app.request("/api/oauth/delegate/authorize", {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user-id": "u1" },
      body: JSON.stringify({
        redirect_uri: "https://client.example/cb",
        state: "st2",
        code_challenge,
      }),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { redirect_url: string };
    expect(data.redirect_url).toContain("https://client.example/cb");
    expect(data.redirect_url).toContain("code=");
    expect(data.redirect_url).toContain("state=st2");
  });

  test("token with valid code returns 200 and access_token and client_id", async () => {
    const { app } = createTestApp();
    const code_verifier = "verifier_" + Math.random().toString(36).slice(2);
    const code_challenge = await s256Challenge(code_verifier);
    const authRes = await app.request("/api/oauth/delegate/authorize", {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user-id": "u1" },
      body: JSON.stringify({
        redirect_uri: "https://client.example/cb",
        state: "st3",
        code_challenge,
      }),
    });
    expect(authRes.status).toBe(200);
    const authData = (await authRes.json()) as { redirect_url: string };
    const url = new URL(authData.redirect_url);
    const code = url.searchParams.get("code");
    expect(code).toBeTruthy();

    const tokenRes = await app.request("/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code!,
        code_verifier,
      }),
    });
    expect(tokenRes.status).toBe(200);
    const tokenData = (await tokenRes.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      token_type: string;
      client_id?: string;
    };
    expect(tokenData.access_token).toBeTruthy();
    expect(tokenData.refresh_token).toBeTruthy();
    expect(tokenData.token_type).toBe("Bearer");
    expect(tokenData.client_id).toBeTruthy();
  });

  test("token with invalid code returns 400 invalid_grant", async () => {
    const { app } = createTestApp();
    const tokenRes = await app.request("/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: "invalid_code_xyz",
        code_verifier: "any",
      }),
    });
    expect(tokenRes.status).toBe(400);
    const data = (await tokenRes.json()) as { error: string };
    expect(data.error).toBe("invalid_grant");
  });

  test("refresh with client_id and refresh_token returns 200 and new access_token", async () => {
    const { app } = createTestApp();
    const code_verifier = "verifier_refresh_" + Math.random().toString(36).slice(2);
    const code_challenge = await s256Challenge(code_verifier);
    const authRes = await app.request("/api/oauth/delegate/authorize", {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user-id": "u1" },
      body: JSON.stringify({
        redirect_uri: "https://client.example/cb",
        state: "st4",
        code_challenge,
      }),
    });
    expect(authRes.status).toBe(200);
    const authData = (await authRes.json()) as { redirect_url: string };
    const url = new URL(authData.redirect_url);
    const code = url.searchParams.get("code");
    expect(code).toBeTruthy();

    const tokenRes = await app.request("/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code!,
        code_verifier,
      }),
    });
    expect(tokenRes.status).toBe(200);
    const tokenData = (await tokenRes.json()) as {
      access_token: string;
      refresh_token: string;
      client_id: string;
    };
    const refreshToken = tokenData.refresh_token;
    const clientId = tokenData.client_id;
    expect(refreshToken).toBeTruthy();
    expect(clientId).toBeTruthy();

    const refreshRes = await app.request("/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
      }),
    });
    expect(refreshRes.status).toBe(200);
    const refreshData = (await refreshRes.json()) as {
      access_token: string;
      refresh_token: string;
      token_type: string;
    };
    expect(refreshData.access_token).toBeTruthy();
    expect(refreshData.access_token).not.toBe(tokenData.access_token);
    expect(refreshData.refresh_token).toBeTruthy();
    expect(refreshData.token_type).toBe("Bearer");
  });
});
