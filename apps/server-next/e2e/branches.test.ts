/**
 * E2E: Branch create and Worker access with branch token.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createE2EContext } from "./setup.ts";

describe("Branches / Worker", () => {
  const ctx = createE2EContext();
  const realmId = "e2e-" + crypto.randomUUID();

  beforeAll(async () => {
    await ctx.ready();
  });

  afterAll(() => {
    ctx.cleanup();
  });

  it("create branch returns branchId and accessToken", async () => {
    const token = ctx.helpers.createUserToken(realmId);
    const mkdirRes = await ctx.helpers.authRequest(
      token,
      "POST",
      `/api/realm/${realmId}/fs/mkdir`,
      { path: "sub" }
    );
    expect(mkdirRes.status).toBe(201);
    const result = await ctx.helpers.createBranch(token, realmId, {
      mountPath: "sub",
    });
    expect(result.branchId).toBeDefined();
    expect(result.accessToken).toBeDefined();
  });

  it("worker token can list own branch", async () => {
    const token = ctx.helpers.createUserToken(realmId);
    await ctx.helpers.authRequest(
      token,
      "POST",
      `/api/realm/${realmId}/fs/mkdir`,
      { path: "work" }
    );
    const { accessToken } = await ctx.helpers.createBranch(token, realmId, {
      mountPath: "work",
    });
    const res = await ctx.helpers.authRequest(
      accessToken,
      "GET",
      "/api/realm/me/branches"
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { branches?: { branchId: string }[] };
    expect(Array.isArray(data.branches)).toBe(true);
    expect(data.branches?.length).toBe(1);
    expect(data.branches?.[0]?.branchId).toBeDefined();
  });

  it("worker token can list files at root", async () => {
    const token = ctx.helpers.createUserToken(realmId);
    await ctx.helpers.authRequest(
      token,
      "POST",
      `/api/realm/${realmId}/fs/mkdir`,
      { path: "files" }
    );
    const { accessToken } = await ctx.helpers.createBranch(token, realmId, {
      mountPath: "files",
    });
    const res = await ctx.helpers.authRequest(
      accessToken,
      "GET",
      "/api/realm/me/files"
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { entries?: unknown[] };
    expect(Array.isArray(data.entries)).toBe(true);
  });
});
