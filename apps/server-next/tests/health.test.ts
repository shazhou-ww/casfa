/**
 * E2E: health and smoke — public endpoints, 404, 401 without auth.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createE2EContext } from "./setup.ts";

describe("Health and smoke", () => {
  const ctx = createE2EContext();

  beforeAll(async () => {
    await ctx.ready();
  });

  afterAll(() => {
    ctx.cleanup();
  });

  it("GET /api/health returns 200 and ok: true", async () => {
    const response = await fetch(`${ctx.baseUrl}/api/health`);
    expect(response.status).toBe(200);
    const data = (await response.json()) as { ok?: boolean };
    expect(data.ok).toBe(true);
  });

  it("GET /api/info returns 200 and storageType/authType", async () => {
    const response = await fetch(`${ctx.baseUrl}/api/info`);
    expect(response.status).toBe(200);
    const data = (await response.json()) as { storageType?: string; authType?: string };
    expect(data.storageType).toBeDefined();
    expect(data.authType).toBeDefined();
  });

  it("GET unknown path returns 404 and error body", async () => {
    const response = await fetch(`${ctx.baseUrl}/nonexistent`);
    expect(response.status).toBe(404);
    const data = (await response.json()) as { error?: string; message?: string };
    expect(data.error).toBe("NOT_FOUND");
    expect(data.message).toBe("Not found");
  });

  it("GET /api/realm/me without Authorization returns 401", async () => {
    const response = await fetch(`${ctx.baseUrl}/api/realm/me`);
    expect(response.status).toBe(401);
    const data = (await response.json()) as { error?: string; message?: string };
    expect(data.error).toBe("UNAUTHORIZED");
    expect(data.message).toBeDefined();
  });

  it("OPTIONS returns CORS headers", async () => {
    const response = await fetch(`${ctx.baseUrl}/api/health`, {
      method: "OPTIONS",
      headers: { "Origin": "http://localhost:3000", "Access-Control-Request-Method": "GET" },
    });
    expect(response.status).toBe(204);
    const allowOrigin = response.headers.get("Access-Control-Allow-Origin");
    expect(allowOrigin === "*" || allowOrigin === "http://localhost:3000").toBe(true);
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain("GET");
  });
});
