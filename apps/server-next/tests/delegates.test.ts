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

  it("list delegates returns array", async () => {
    const token = ctx.helpers.createUserToken(realmId);
    await ctx.helpers.assignDelegate(token, realmId);
    const res = await ctx.helpers.authRequest(
      token,
      "GET",
      `/api/realm/${realmId}/delegates`
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { delegates?: { delegateId: string }[] };
    expect(Array.isArray(data.delegates)).toBe(true);
    expect((data.delegates ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it("revoke delegate then token fails", async () => {
    const token = ctx.helpers.createUserToken(realmId);
    const { accessToken, delegateId } = await ctx.helpers.assignDelegate(
      token,
      realmId
    );
    const revokeRes = await ctx.helpers.authRequest(
      token,
      "POST",
      `/api/realm/${realmId}/delegates/${delegateId}/revoke`
    );
    expect(revokeRes.status).toBe(200);
    const revokeData = (await revokeRes.json()) as { revoked?: string };
    expect(revokeData.revoked).toBe(delegateId);
    const listRes = await ctx.helpers.authRequest(
      token,
      "GET",
      `/api/realm/${realmId}/delegates`
    );
    expect(listRes.status).toBe(200);
    const listData = (await listRes.json()) as {
      delegates?: { delegateId: string }[];
    };
    expect(listData.delegates?.some((d) => d.delegateId === delegateId)).toBe(
      false
    );
  });
});
