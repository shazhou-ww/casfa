import { describe, expect, it } from "bun:test";
import { createArtistMcpRoute } from "../index";

type JsonRpcResponse = {
  result?: {
    tools?: Array<{ name?: string }>;
  };
  error?: {
    message?: string;
  };
};

function createJsonRpcBody(method: string, params?: unknown) {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method,
    params,
  });
}

describe("artist mcp tools", () => {
  it("exposes flux_image_edit in tools/list", async () => {
    const route = createArtistMcpRoute({});

    const initRes = await route.request("http://localhost/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: createJsonRpcBody("initialize", {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "test", version: "0.1.0" },
      }),
    });
    expect(initRes.status).toBe(200);

    const listRes = await route.request("http://localhost/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: createJsonRpcBody("tools/list", {}),
    });
    expect(listRes.status).toBe(200);

    const data = (await listRes.json()) as JsonRpcResponse;
    expect(data.error).toBeUndefined();
    const names = (data.result?.tools ?? []).map((tool) => tool.name);
    expect(names).toContain("flux_image");
    expect(names).toContain("flux_image_edit");
  });
});
