/**
 * E2E: Branch create and Worker access with branch token.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createE2EContext } from "./setup.ts";

describe("Branches / Worker", () => {
  const ctx = createE2EContext();
  const realmId = `e2e-${crypto.randomUUID()}`;

  beforeAll(async () => {
    await ctx.ready();
  });

  afterAll(() => {
    ctx.cleanup();
  });

  it("create branch returns branchId and accessToken", async () => {
    const token = await ctx.helpers.createUserToken(realmId);
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

  it("create branch on fresh realm lazy-creates realm and returns 201", async () => {
    const freshRealm = `e2e-fresh-${crypto.randomUUID()}`;
    const token = await ctx.helpers.createUserToken(freshRealm);
    const res = await ctx.helpers.authRequest(token, "POST", `/api/realm/${freshRealm}/branches`, {
      mountPath: "any",
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as { branchId?: string; accessToken?: string };
    expect(data.branchId).toBeDefined();
    expect(data.accessToken).toBeDefined();
  });

  it("create branch with non-existent mountPath returns 201 (NUL root)", async () => {
    const token = await ctx.helpers.createUserToken(realmId);
    await ctx.helpers.authRequest(token, "POST", `/api/realm/${realmId}/fs/mkdir`, {
      path: "base",
    });
    const res = await ctx.helpers.authRequest(token, "POST", `/api/realm/${realmId}/branches`, {
      mountPath: "base/does/not/exist",
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as { branchId?: string; accessToken?: string };
    expect(data.branchId).toBeDefined();
    expect(data.accessToken).toBeDefined();
  });

  it("worker token can list own branch", async () => {
    const token = await ctx.helpers.createUserToken(realmId);
    await ctx.helpers.authRequest(token, "POST", `/api/realm/${realmId}/fs/mkdir`, {
      path: "work",
    });
    const { accessToken } = await ctx.helpers.createBranch(token, realmId, {
      mountPath: "work",
    });
    const res = await ctx.helpers.authRequest(accessToken, "GET", "/api/realm/me/branches");
    expect(res.status).toBe(200);
    const data = (await res.json()) as { branches?: { branchId: string }[] };
    expect(Array.isArray(data.branches)).toBe(true);
    expect(data.branches?.length).toBe(1);
    expect(data.branches?.[0]?.branchId).toBeDefined();
  });

  it("worker token can list files at root", async () => {
    const token = await ctx.helpers.createUserToken(realmId);
    await ctx.helpers.authRequest(token, "POST", `/api/realm/${realmId}/fs/mkdir`, {
      path: "files",
    });
    const { accessToken } = await ctx.helpers.createBranch(token, realmId, {
      mountPath: "files",
    });
    const res = await ctx.helpers.authRequest(accessToken, "GET", "/api/realm/me/files");
    expect(res.status).toBe(200);
    const data = (await res.json()) as { entries?: unknown[] };
    expect(Array.isArray(data.entries)).toBe(true);
  });

  it("path-based access: accessUrlPrefix returns 200 without Bearer, wrong verification returns 401", async () => {
    const token = await ctx.helpers.createUserToken(realmId);
    await ctx.helpers.authRequest(token, "POST", `/api/realm/${realmId}/fs/mkdir`, {
      path: "pathAccess",
    });
    const result = await ctx.helpers.createBranch(token, realmId, {
      mountPath: "pathAccess",
    });
    if (!result.accessUrlPrefix) {
      return; // skip when baseUrl not set (e.g. in-process without CELL_BASE_URL)
    }
    const listRes = await fetch(`${result.accessUrlPrefix}/api/realm/me/branches`);
    expect(listRes.status).toBe(200);
    const listData = (await listRes.json()) as { branches?: { branchId: string }[] };
    expect(listData.branches?.some((b) => b.branchId === result.branchId)).toBe(true);

    const wrongUrl = `${ctx.baseUrl}/branch/${result.branchId}/${"0".repeat(26)}/api/realm/me/branches`;
    const badRes = await fetch(wrongUrl);
    expect(badRes.status).toBe(401);
  });

  it("revoke branch then branch not in list", async () => {
    const token = await ctx.helpers.createUserToken(realmId);
    await ctx.helpers.authRequest(token, "POST", `/api/realm/${realmId}/fs/mkdir`, {
      path: "revMe",
    });
    const { branchId } = await ctx.helpers.createBranch(token, realmId, {
      mountPath: "revMe",
    });
    const revokeRes = await ctx.helpers.authRequest(
      token,
      "POST",
      `/api/realm/${realmId}/branches/${branchId}/revoke`
    );
    expect(revokeRes.status).toBe(200);
    const listRes = await ctx.helpers.authRequest(token, "GET", `/api/realm/${realmId}/branches`);
    expect(listRes.status).toBe(200);
    const data = (await listRes.json()) as { branches?: { branchId: string }[] };
    expect(data.branches?.some((b) => b.branchId === branchId)).toBe(false);
  });

  it("complete after revoke returns 401 (revoked branch token invalid)", async () => {
    const token = await ctx.helpers.createUserToken(realmId);
    await ctx.helpers.authRequest(token, "POST", `/api/realm/${realmId}/fs/mkdir`, {
      path: "toRevoke",
    });
    const { accessToken: workerToken, branchId } = await ctx.helpers.createBranch(token, realmId, {
      mountPath: "toRevoke",
    });
    await ctx.helpers.authRequest(
      token,
      "POST",
      `/api/realm/${realmId}/branches/${branchId}/revoke`
    );
    const completeRes = await ctx.helpers.authRequest(
      workerToken,
      "POST",
      "/api/realm/me/branches/me/complete"
    );
    expect(completeRes.status).toBe(401);
    const data = (await completeRes.json()) as { error?: string; message?: string };
    expect(data.error).toBe("UNAUTHORIZED");
  });

  it("complete merges sub-branch into parent", async () => {
    const token = await ctx.helpers.createUserToken(realmId);
    await ctx.helpers.authRequest(token, "POST", `/api/realm/${realmId}/fs/mkdir`, {
      path: "parentDir",
    });
    const { accessToken: workerToken, branchId: parentId } = await ctx.helpers.createBranch(
      token,
      realmId,
      {
        mountPath: "parentDir",
      }
    );
    await ctx.helpers.authRequest(workerToken, "POST", "/api/realm/me/fs/mkdir", { path: "child" });
    const { accessToken: childToken, branchId: childId } = await ctx.helpers.createBranch(
      workerToken,
      realmId,
      {
        mountPath: "child",
        parentBranchId: parentId,
      }
    );
    const completeRes = await ctx.helpers.authRequest(
      childToken,
      "POST",
      "/api/realm/me/branches/me/complete"
    );
    expect(completeRes.status).toBe(200);
    const completeData = (await completeRes.json()) as { completed?: string };
    expect(completeData.completed).toBe(childId);
    const listRes = await ctx.helpers.authRequest(token, "GET", `/api/realm/${realmId}/files`);
    expect(listRes.status).toBe(200);
    const listData = (await listRes.json()) as { entries?: { name: string }[] };
    expect(listData.entries?.some((e) => e.name === "parentDir")).toBe(true);
  });

  it("branch with null root: PUT /api/realm/me/root sets root to file, complete merges file at mountPath", async () => {
    const token = await ctx.helpers.createUserToken(realmId);
    await ctx.helpers.authRequest(token, "POST", `/api/realm/${realmId}/fs/mkdir`, {
      path: "img",
    });
    const res = await ctx.helpers.authRequest(token, "POST", `/api/realm/${realmId}/branches`, {
      mountPath: "img/generated",
    });
    expect(res.status).toBe(201);
    const { accessToken: workerToken, branchId } = (await res.json()) as {
      accessToken: string;
      branchId: string;
    };
    const putRootRes = await fetch(`${ctx.baseUrl}/api/realm/me/root`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${workerToken}`,
        "Content-Type": "image/png",
      },
      body: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    });
    expect(putRootRes.status).toBe(201);
    const completeRes = await ctx.helpers.authRequest(
      workerToken,
      "POST",
      "/api/realm/me/branches/me/complete"
    );
    expect(completeRes.status).toBe(200);
    const getRes = await ctx.helpers.authRequest(
      token,
      "GET",
      `/api/realm/${realmId}/files/img/generated?meta=1`
    );
    expect(getRes.status).toBe(200);
    const meta = (await getRes.json()) as { kind?: string; contentType?: string };
    expect(meta.kind).toBe("file");
    expect(meta.contentType).toBe("image/png");
  });
});
