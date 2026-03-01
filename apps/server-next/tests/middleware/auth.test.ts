/**
 * Auth middleware tests: no header → 401; Bearer JWT → user or delegate;
 * Bearer branch token → worker or 401.
 */
import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import type { Env } from "../../src/types.ts";
import { createAuthMiddleware } from "../../src/middleware/auth.ts";
import { createMemoryDelegateGrantStore } from "../../src/db/delegate-grants.ts";
import { createMemoryDelegateStore } from "@casfa/realm";
import type { Delegate } from "@casfa/realm";

function base64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makeJwt(sub: string): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const payload = btoa(JSON.stringify({ sub }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${header}.${payload}.sig`;
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

describe("auth middleware", () => {
  it("returns 401 when Authorization header is missing", async () => {
    const delegateStore = createMemoryDelegateStore();
    const delegateGrantStore = createMemoryDelegateGrantStore();
    const auth = createAuthMiddleware({ delegateGrantStore, delegateStore });
    const app = new Hono<Env>().use("*", auth).get("/", (c) => c.json(c.get("auth")));
    const res = await app.request("http://localhost/");
    expect(res.status).toBe(401);
  });

  it("returns 401 when Bearer token is empty", async () => {
    const delegateStore = createMemoryDelegateStore();
    const delegateGrantStore = createMemoryDelegateGrantStore();
    const auth = createAuthMiddleware({ delegateGrantStore, delegateStore });
    const app = new Hono<Env>().use("*", auth).get("/", (c) => c.json(c.get("auth")));
    const res = await app.request("http://localhost/", {
      headers: { Authorization: "Bearer " },
    });
    expect(res.status).toBe(401);
  });

  it("sets UserAuth when Bearer is valid JWT and no grant exists", async () => {
    const delegateStore = createMemoryDelegateStore();
    const delegateGrantStore = createMemoryDelegateGrantStore();
    const auth = createAuthMiddleware({ delegateGrantStore, delegateStore });
    const app = new Hono<Env>().use("*", auth).get("/", (c) => c.json(c.get("auth")));
    const jwt = makeJwt("user-123");
    const res = await app.request("http://localhost/", {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { type: string; userId: string };
    expect(body.type).toBe("user");
    expect(body.userId).toBe("user-123");
  });

  it("sets DelegateAuth when Bearer is JWT and grant exists for token hash", async () => {
    const delegateStore = createMemoryDelegateStore();
    const delegateGrantStore = createMemoryDelegateGrantStore();
    const jwt = makeJwt("user-456");
    const tokenHash = await sha256Hex(jwt);
    await delegateGrantStore.insert({
      delegateId: "d1",
      realmId: "user-456",
      clientId: "client-x",
      accessTokenHash: tokenHash,
      refreshTokenHash: null,
      permissions: ["file_read", "file_write"],
      createdAt: Date.now(),
      expiresAt: null,
    });
    const auth = createAuthMiddleware({ delegateGrantStore, delegateStore });
    const app = new Hono<Env>().use("*", auth).get("/", (c) => c.json(c.get("auth")));
    const res = await app.request("http://localhost/", {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      type: string;
      realmId: string;
      delegateId: string;
      clientId: string;
      permissions: string[];
    };
    expect(body.type).toBe("delegate");
    expect(body.realmId).toBe("user-456");
    expect(body.delegateId).toBe("d1");
    expect(body.clientId).toBe("client-x");
    expect(body.permissions).toEqual(["file_read", "file_write"]);
  });

  it("sets WorkerAuth when Bearer is valid branch token", async () => {
    const delegateStore = createMemoryDelegateStore();
    const delegateGrantStore = createMemoryDelegateGrantStore();
    const branchId = "branch-abc";
    const delegate: Delegate = {
      delegateId: branchId,
      realmId: "realm-r1",
      parentId: null,
      mountPath: "",
      lifetime: "limited",
      accessTokenHash: "",
      expiresAt: Date.now() + 3600_000,
    };
    await delegateStore.insertDelegate(delegate);
    const token = base64urlEncode(branchId);
    const auth = createAuthMiddleware({ delegateGrantStore, delegateStore });
    const app = new Hono<Env>().use("*", auth).get("/", (c) => c.json(c.get("auth")));
    const res = await app.request("http://localhost/", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      type: string;
      realmId: string;
      branchId: string;
      access: string;
    };
    expect(body.type).toBe("worker");
    expect(body.realmId).toBe("realm-r1");
    expect(body.branchId).toBe(branchId);
    expect(body.access).toBe("readwrite");
  });

  it("returns 401 when branch token is not found in store", async () => {
    const delegateStore = createMemoryDelegateStore();
    const delegateGrantStore = createMemoryDelegateGrantStore();
    const token = base64urlEncode("nonexistent-branch");
    const auth = createAuthMiddleware({ delegateGrantStore, delegateStore });
    const app = new Hono<Env>().use("*", auth).get("/", (c) => c.json(c.get("auth")));
    const res = await app.request("http://localhost/", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 when branch token is expired", async () => {
    const delegateStore = createMemoryDelegateStore();
    const delegateGrantStore = createMemoryDelegateGrantStore();
    const branchId = "expired-branch";
    const delegate: Delegate = {
      delegateId: branchId,
      realmId: "realm-r1",
      parentId: null,
      mountPath: "",
      lifetime: "limited",
      accessTokenHash: "",
      expiresAt: Date.now() - 1000,
    };
    await delegateStore.insertDelegate(delegate);
    const token = base64urlEncode(branchId);
    const auth = createAuthMiddleware({ delegateGrantStore, delegateStore });
    const app = new Hono<Env>().use("*", auth).get("/", (c) => c.json(c.get("auth")));
    const res = await app.request("http://localhost/", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
  });
});
