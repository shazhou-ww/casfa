/**
 * E2E: User path — list root, mkdir, upload file, stat, download.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createE2EContext } from "./setup.ts";

describe("Files (User)", () => {
  const ctx = createE2EContext();
  const realmId = "e2e-" + crypto.randomUUID();

  beforeAll(async () => {
    await ctx.ready();
  });

  afterAll(() => {
    ctx.cleanup();
  });

  it("list root returns 200 and entries array", async () => {
    const token = await ctx.helpers.createUserToken(realmId);
    const res = await ctx.helpers.authRequest(
      token,
      "GET",
      `/api/realm/${realmId}/files`
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { entries?: unknown[] };
    expect(Array.isArray(data.entries)).toBe(true);
  });

  it("mkdir then list shows directory", async () => {
    const token = await ctx.helpers.createUserToken(realmId);
    const mkdirRes = await ctx.helpers.authRequest(
      token,
      "POST",
      `/api/realm/${realmId}/fs/mkdir`,
      { path: "foo" }
    );
    expect(mkdirRes.status).toBe(201);

    const listRes = await ctx.helpers.authRequest(
      token,
      "GET",
      `/api/realm/${realmId}/files`
    );
    expect(listRes.status).toBe(200);
    const data = (await listRes.json()) as { entries?: { name: string; kind: string }[] };
    expect(data.entries?.some((e) => e.name === "foo" && e.kind === "directory")).toBe(true);
  });

  it("upload file then stat and get content", async () => {
    const token = await ctx.helpers.createUserToken(realmId);
    const listRes = await ctx.helpers.authRequest(
      token,
      "GET",
      `/api/realm/${realmId}/files`
    );
    expect(listRes.status).toBe(200);

    const body = "hello e2e";
    const uploadUrl = `${ctx.baseUrl}/api/realm/${realmId}/files/bar.txt`;
    const uploadRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "text/plain",
      },
      body,
    });
    if (uploadRes.status !== 201) {
      const errText = await uploadRes.text();
      throw new Error(`upload failed ${uploadRes.status}: ${errText}`);
    }

    const statRes = await ctx.helpers.authRequest(
      token,
      "GET",
      `/api/realm/${realmId}/files/bar.txt?meta=1`
    );
    expect(statRes.status).toBe(200);
    const statData = (await statRes.json()) as { kind?: string; size?: number };
    expect(statData.kind).toBe("file");
    expect(statData.size).toBe(body.length);

    const getRes = await fetch(
      `${ctx.baseUrl}/api/realm/${realmId}/files/bar.txt`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    expect(getRes.status).toBe(200);
    const text = await getRes.text();
    expect(text).toBe(body);
  });

  it("stat root (directory) returns kind directory", async () => {
    const token = await ctx.helpers.createUserToken(realmId);
    const res = await ctx.helpers.authRequest(
      token,
      "GET",
      `/api/realm/${realmId}/files?meta=1`
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { kind?: string };
    expect(data.kind).toBe("directory");
  });

  it("rm removes entry then list does not show it", async () => {
    const token = await ctx.helpers.createUserToken(realmId);
    await ctx.helpers.authRequest(
      token,
      "POST",
      `/api/realm/${realmId}/fs/mkdir`,
      { path: "toRemove" }
    );
    const rmRes = await ctx.helpers.authRequest(
      token,
      "POST",
      `/api/realm/${realmId}/fs/rm`,
      { path: "toRemove" }
    );
    expect(rmRes.status).toBe(200);
    const rmData = (await rmRes.json()) as { removed?: number };
    expect(rmData.removed).toBe(1);
    const listRes = await ctx.helpers.authRequest(
      token,
      "GET",
      `/api/realm/${realmId}/files`
    );
    expect(listRes.status).toBe(200);
    const listData = (await listRes.json()) as { entries?: { name: string }[] };
    expect(listData.entries?.some((e) => e.name === "toRemove")).toBe(false);
  });

  it("mv moves file then get at new path returns content", async () => {
    const token = await ctx.helpers.createUserToken(realmId);
    await ctx.helpers.authRequest(
      token,
      "POST",
      `/api/realm/${realmId}/fs/mkdir`,
      { path: "dirA" }
    );
    await fetch(`${ctx.baseUrl}/api/realm/${realmId}/files/dirA/origin.txt`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "text/plain",
      },
      body: "moved content",
    });
    const mvRes = await ctx.helpers.authRequest(
      token,
      "POST",
      `/api/realm/${realmId}/fs/mv`,
      { from: "dirA/origin.txt", to: "dirA/dest.txt" }
    );
    expect(mvRes.status).toBe(200);
    const getRes = await fetch(
      `${ctx.baseUrl}/api/realm/${realmId}/files/dirA/dest.txt`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    expect(getRes.status).toBe(200);
    expect(await getRes.text()).toBe("moved content");
  });

  it("cp copies file then get at new path returns same content", async () => {
    const token = await ctx.helpers.createUserToken(realmId);
    await fetch(`${ctx.baseUrl}/api/realm/${realmId}/files/source.txt`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "text/plain",
      },
      body: "copy me",
    });
    const cpRes = await ctx.helpers.authRequest(
      token,
      "POST",
      `/api/realm/${realmId}/fs/cp`,
      { from: "source.txt", to: "copy.txt" }
    );
    expect(cpRes.status).toBe(201);
    const getCopy = await fetch(
      `${ctx.baseUrl}/api/realm/${realmId}/files/copy.txt`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    expect(getCopy.status).toBe(200);
    expect(await getCopy.text()).toBe("copy me");
    const getSource = await fetch(
      `${ctx.baseUrl}/api/realm/${realmId}/files/source.txt`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    expect(getSource.status).toBe(200);
    expect(await getSource.text()).toBe("copy me");
  });
});
