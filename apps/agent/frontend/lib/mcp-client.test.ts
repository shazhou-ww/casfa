import { afterEach, describe, expect, test } from "bun:test";
import { mcpCall } from "./mcp-client";
import type { MCPServerConfig } from "./mcp-types";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("mcpCall", () => {
  test("sends Accept header with json and event-stream", async () => {
    let seenAccept = "";
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seenAccept = headers.get("Accept") ?? "";
      return Response.json({ jsonrpc: "2.0", result: { ok: true }, id: 1 });
    }) as typeof fetch;

    const config: MCPServerConfig = {
      id: "s1",
      name: "server",
      transport: "stdio",
      auth: "none",
      url: "http://localhost:7100/drive/mcp",
    };
    const result = await mcpCall<{ ok: boolean }>(config, "tools/list");
    expect(result.ok).toBe(true);
    expect(seenAccept).toContain("application/json");
    expect(seenAccept).toContain("text/event-stream");
  });
});

