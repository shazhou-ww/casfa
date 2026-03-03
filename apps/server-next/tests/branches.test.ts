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

  it("create branch without realm root returns 404", async () => {
    const freshRealm = "e2e-no-root-" + crypto.randomUUID();
    const token = ctx.helpers.createUserToken(freshRealm);
    const res = await ctx.helpers.authRequest(
      token,
      "POST",
      `/api/realm/${freshRealm}/branches`,
      { mountPath: "any" }
    );
    expect(res.status).toBe(404);
    const data = (await res.json()) as { error?: string; message?: string };
    expect(data.error).toBe("NOT_FOUND");
    expect(data.message).toContain("Realm not initialized");
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

  it("revoke branch then branch not in list", async () => {
    const token = ctx.helpers.createUserToken(realmId);
    await ctx.helpers.authRequest(
      token,
      "POST",
      `/api/realm/${realmId}/fs/mkdir`,
      { path: "revMe" }
    );
    const { branchId } = await ctx.helpers.createBranch(token, realmId, {
      mountPath: "revMe",
    });
    const revokeRes = await ctx.helpers.authRequest(
      token,
      "POST",
      `/api/realm/${realmId}/branches/${branchId}/revoke`
    );
    expect(revokeRes.status).toBe(200);
    const listRes = await ctx.helpers.authRequest(
      token,
      "GET",
      `/api/realm/${realmId}/branches`
    );
    expect(listRes.status).toBe(200);
    const data = (await listRes.json()) as { branches?: { branchId: string }[] };
    expect(data.branches?.some((b) => b.branchId === branchId)).toBe(false);
  });

  it("complete merges sub-branch into parent", async () => {
    const token = ctx.helpers.createUserToken(realmId);
    await ctx.helpers.authRequest(
      token,
      "POST",
      `/api/realm/${realmId}/fs/mkdir`,
      { path: "parentDir" }
    );
    const { accessToken: workerToken, branchId: parentId } =
      await ctx.helpers.createBranch(token, realmId, {
        mountPath: "parentDir",
      });
    await ctx.helpers.authRequest(
      workerToken,
      "POST",
      "/api/realm/me/fs/mkdir",
      { path: "child" }
    );
    const { accessToken: childToken, branchId: childId } =
      await ctx.helpers.createBranch(workerToken, realmId, {
        mountPath: "child",
        parentBranchId: parentId,
      });
    const completeRes = await ctx.helpers.authRequest(
      childToken,
      "POST",
      "/api/realm/me/branches/me/complete"
    );
    expect(completeRes.status).toBe(200);
    const completeData = (await completeRes.json()) as { completed?: string };
    expect(completeData.completed).toBe(childId);
    const listRes = await ctx.helpers.authRequest(
      token,
      "GET",
      `/api/realm/${realmId}/files`
    );
    expect(listRes.status).toBe(200);
    const listData = (await listRes.json()) as { entries?: { name: string }[] };
    expect(listData.entries?.some((e) => e.name === "parentDir")).toBe(true);
  });
});
