import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { createCellMcpServer } from "./server.js";

describe("createCellMcpServer integration", () => {
  const schema = z.object({ x: z.string() });

  it("initialize returns serverInfo with name", async () => {
    const cellMcp = createCellMcpServer({ name: "test-mcp", version: "0.1.0" });
    cellMcp.registerTool("echo", { description: "Echo x", inputSchema: schema }, async (args) => ({
      content: [{ type: "text", text: args.x }],
    }));

    const app = cellMcp.getRoute();
    const res = await app.request("/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "0.1.0" },
        },
      }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    const result = data.result as Record<string, unknown> | undefined;
    const serverInfo = result?.serverInfo as { name?: string } | undefined;
    expect(serverInfo?.name).toBe("test-mcp");
  });

  it("tools/call with invalid args returns validation error with tool name", async () => {
    const cellMcp = createCellMcpServer({ name: "test-mcp", version: "0.1.0" });
    cellMcp.registerTool("echo", { description: "Echo x", inputSchema: schema }, async (args) => ({
      content: [{ type: "text", text: args.x }],
    }));

    const app = cellMcp.getRoute();
    const res = await app.request("/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "echo", arguments: {} },
      }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as { result?: { content?: Array<{ type: string; text?: string }> }; error?: { data?: { content?: Array<{ text?: string }> } } };
    const text = data.result?.content?.[0]?.text ?? data.error?.data?.content?.[0]?.text ?? "";
    expect(text).toContain("echo");
    expect(text).toContain("x");
  });

  it("tools/call with valid args returns handler result", async () => {
    const cellMcp = createCellMcpServer({ name: "test-mcp", version: "0.1.0" });
    cellMcp.registerTool("echo", { description: "Echo x", inputSchema: schema }, async (args) => ({
      content: [{ type: "text", text: args.x }],
    }));

    const app = cellMcp.getRoute();
    const res = await app.request("/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "echo", arguments: { x: "hello" } },
      }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as { result?: { content?: Array<{ type: string; text?: string }> } };
    expect(data.result?.content?.[0]?.text).toBe("hello");
  });
});
