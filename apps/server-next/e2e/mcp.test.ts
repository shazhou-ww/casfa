/**
 * E2E: MCP initialize, tools/list, tools/call.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createE2EContext } from "./setup.ts";

describe("MCP", () => {
  const ctx = createE2EContext();
  const realmId = "e2e-" + crypto.randomUUID();

  beforeAll(async () => {
    await ctx.ready();
  });

  afterAll(() => {
    ctx.cleanup();
  });

  it("initialize returns protocolVersion and capabilities", async () => {
    const token = ctx.helpers.createUserToken(realmId);
    const res = await ctx.helpers.mcpRequest(token, "initialize");
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      result?: { protocolVersion?: string; capabilities?: unknown };
    };
    expect(data.result?.protocolVersion).toBeDefined();
    expect(data.result?.capabilities).toBeDefined();
  });

  it("tools/list returns tools array", async () => {
    const token = ctx.helpers.createUserToken(realmId);
    const res = await ctx.helpers.mcpRequest(token, "tools/list");
    expect(res.status).toBe(200);
    const data = (await res.json()) as { result?: { tools?: unknown[] } };
    expect(Array.isArray(data.result?.tools)).toBe(true);
    expect((data.result?.tools ?? []).length).toBeGreaterThan(0);
  });

  it("tools/call branches_list returns content", async () => {
    const token = ctx.helpers.createUserToken(realmId);
    const res = await ctx.helpers.mcpRequest(token, "tools/call", {
      name: "branches_list",
      arguments: {},
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      result?: { content?: { type: string; text: string }[] };
    };
    expect(data.result?.content).toBeDefined();
    const text = data.result?.content?.[0]?.text;
    expect(text).toBeDefined();
    const parsed = JSON.parse(text!) as { branches?: unknown[] };
    expect(Array.isArray(parsed.branches)).toBe(true);
  });

  it("tools/call fs_ls returns entries", async () => {
    const token = ctx.helpers.createUserToken(realmId);
    const res = await ctx.helpers.mcpRequest(token, "tools/call", {
      name: "fs_ls",
      arguments: { path: "" },
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      result?: { content?: { type: string; text: string }[] };
    };
    expect(data.result?.content).toBeDefined();
    const text = data.result?.content?.[0]?.text;
    expect(text).toBeDefined();
    const parsed = JSON.parse(text!) as { entries?: unknown[] };
    expect(Array.isArray(parsed.entries)).toBe(true);
  });
});
