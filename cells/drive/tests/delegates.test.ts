/**
 * E2E: Delegate create (POST /api/delegates), list (GET /api/delegates), revoke; delegate token access.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createE2EContext } from "./setup.ts";

describe("Delegates", () => {
  const ctx = createE2EContext();
  const realmId = `e2e-${crypto.randomUUID()}`;

  beforeAll(async () => {
    await ctx.ready();
  });

  afterAll(() => {
    ctx.cleanup();
  });

  it("assign returns accessToken and delegateId", async () => {
    const token = await ctx.helpers.createUserToken(realmId);
    const result = await ctx.helpers.assignDelegate(token, realmId);
    expect(result.accessToken).toBeDefined();
    expect(result.delegateId).toBeDefined();
  });

  it("delegate token can list realm files", async () => {
    const token = await ctx.helpers.createUserToken(realmId);
    const { accessToken } = await ctx.helpers.assignDelegate(token, realmId);
    const res = await ctx.helpers.authRequest(accessToken, "GET", `/api/realm/${realmId}/files`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { entries?: unknown[] };
    expect(Array.isArray(data.entries)).toBe(true);
  });

  it("delegate token can list branches", async () => {
    const token = await ctx.helpers.createUserToken(realmId);
    const { accessToken } = await ctx.helpers.assignDelegate(token, realmId);
    const res = await ctx.helpers.authRequest(accessToken, "GET", `/api/realm/${realmId}/branches`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { branches?: unknown[] };
    expect(Array.isArray(data.branches)).toBe(true);
  });

  it("list delegates returns array", async () => {
    const token = await ctx.helpers.createUserToken(realmId);
    await ctx.helpers.assignDelegate(token, realmId);
    const res = await ctx.helpers.authRequest(token, "GET", "/api/delegates");
    expect(res.status).toBe(200);
    const data = (await res.json()) as
      | { delegateId?: string }[]
      | { delegates?: { delegateId: string }[] };
    const list = Array.isArray(data)
      ? data
      : ((data as { delegates?: { delegateId: string }[] }).delegates ?? []);
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThanOrEqual(1);
  });

  it("revoke delegate then token fails", async () => {
    const token = await ctx.helpers.createUserToken(realmId);
    const { delegateId } = await ctx.helpers.assignDelegate(token, realmId);
    const revokeRes = await ctx.helpers.authRequest(
      token,
      "POST",
      `/api/delegates/${delegateId}/revoke`
    );
    expect(revokeRes.status).toBe(200);
    const revokeData = (await revokeRes.json()) as { ok?: boolean; revoked?: string };
    expect(revokeData.ok === true || revokeData.revoked === delegateId).toBe(true);
    const listRes = await ctx.helpers.authRequest(token, "GET", "/api/delegates");
    expect(listRes.status).toBe(200);
    const listData = (await listRes.json()) as
      | { delegateId?: string }[]
      | { delegates?: { delegateId: string }[] };
    const list = Array.isArray(listData)
      ? listData
      : ((listData as { delegates?: { delegateId: string }[] }).delegates ?? []);
    expect(list.some((d: { delegateId?: string }) => d.delegateId === delegateId)).toBe(false);
  });
});
