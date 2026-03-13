/**
 * E2E: MCP initialize, tools/list, tools/call.
 * Uses POST /mcp for JSON-RPC.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createE2EContext } from "./setup.ts";

describe("MCP", () => {
  const ctx = createE2EContext();
  const realmId = `e2e-${crypto.randomUUID()}`;

  beforeAll(async () => {
    await ctx.ready();
  });

  afterAll(() => {
    ctx.cleanup();
  });

  it("initialize returns protocolVersion and capabilities", async () => {
    const token = await ctx.helpers.createUserToken(realmId);
    const res = await ctx.helpers.mcpRequest(token, "initialize");
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      result?: { protocolVersion?: string; capabilities?: unknown; serverInfo?: unknown };
    };
    expect(data.result?.protocolVersion).toBeDefined();
    expect(data.result?.capabilities).toBeDefined();
  });

  it("tools/list returns tools array", async () => {
    const token = await ctx.helpers.createUserToken(realmId);
    const res = await ctx.helpers.mcpRequest(token, "tools/list");
    expect(res.status).toBe(200);
    const data = (await res.json()) as { result?: { tools?: unknown[] } };
    expect(Array.isArray(data.result?.tools)).toBe(true);
    expect((data.result?.tools ?? []).length).toBeGreaterThan(0);
  });

  it("tools/call branches_list returns content", async () => {
    const token = await ctx.helpers.createUserToken(realmId);
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
    const token = await ctx.helpers.createUserToken(realmId);
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

  it("tools/call fs_write writes file then fs_read returns content", async () => {
    const token = await ctx.helpers.createUserToken(realmId);
    const writeRes = await ctx.helpers.mcpRequest(token, "tools/call", {
      name: "fs_write",
      arguments: { path: "hello.txt", content: "Hello MCP" },
    });
    expect(writeRes.status).toBe(200);
    const writeData = (await writeRes.json()) as {
      result?: { content?: { type: string; text: string }[] };
      error?: { message: string };
    };
    if (writeData.error) {
      throw new Error(`fs_write failed: ${writeData.error.message}`);
    }
    expect(writeData.result?.content).toBeDefined();
    const writeText = writeData.result?.content?.[0]?.text;
    expect(writeText).toBeDefined();
    const writeParsed = JSON.parse(writeText!) as { path?: string };
    expect(writeParsed.path).toBe("hello.txt");

    const readRes = await ctx.helpers.mcpRequest(token, "tools/call", {
      name: "fs_read",
      arguments: { path: "hello.txt" },
    });
    expect(readRes.status).toBe(200);
    const readData = (await readRes.json()) as {
      result?: { content?: { type: string; text: string }[] };
    };
    expect(readData.result?.content).toBeDefined();
    const readText = readData.result?.content?.[0]?.text;
    expect(readText).toBeDefined();
    const readParsed = JSON.parse(readText!) as { content?: string };
    expect(readParsed.content).toBe("Hello MCP");
  });
});
