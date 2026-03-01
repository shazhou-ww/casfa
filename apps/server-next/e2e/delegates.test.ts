/**
 * E2E: Delegate assign and access with delegate token.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createE2EContext } from "./setup.ts";

describe("Delegates", () => {
  const ctx = createE2EContext();
  const realmId = "e2e-" + crypto.randomUUID();

  beforeAll(async () => {
    await ctx.ready();
  });

  afterAll(() => {
    ctx.cleanup();
  });

  it("assign returns accessToken and delegateId", async () => {
    const token = ctx.helpers.createUserToken(realmId);
    const result = await ctx.helpers.assignDelegate(token, realmId);
    expect(result.accessToken).toBeDefined();
    expect(result.delegateId).toBeDefined();
  });

  it("delegate token can list realm files", async () => {
    const token = ctx.helpers.createUserToken(realmId);
    const { accessToken } = await ctx.helpers.assignDelegate(token, realmId);
    const res = await ctx.helpers.authRequest(
      accessToken,
      "GET",
      `/api/realm/${realmId}/files`
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { entries?: unknown[] };
    expect(Array.isArray(data.entries)).toBe(true);
  });

  it("delegate token can list branches", async () => {
    const token = ctx.helpers.createUserToken(realmId);
    const { accessToken } = await ctx.helpers.assignDelegate(token, realmId);
    const res = await ctx.helpers.authRequest(
      accessToken,
      "GET",
      `/api/realm/${realmId}/branches`
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { branches?: unknown[] };
    expect(Array.isArray(data.branches)).toBe(true);
  });
});
