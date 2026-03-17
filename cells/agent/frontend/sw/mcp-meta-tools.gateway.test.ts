import { describe, expect, test } from "bun:test";
import type { ModelState } from "../lib/model-types.ts";
import { executeTool, getLoadedToolSchemas, metaToolSchemas } from "./mcp-meta-tools.ts";

describe("gateway meta tool schemas", () => {
  test("exports gateway tool names", () => {
    const names = metaToolSchemas.map((tool) => tool.function.name);
    expect(names).toEqual(["list_servers", "search_servers", "get_tools", "load_tools"]);
    expect(names.includes("list_mcp_servers")).toBe(false);
    expect(names.includes("get_mcp_tools")).toBe(false);
  });

  test("hydrates loaded tool schema directly from load_tools result", async () => {
    const originalSelf = (globalThis as { self?: unknown }).self;
    const originalFetch = globalThis.fetch;
    const fetchCalls: string[] = [];
    try {
      (globalThis as { self?: { registration?: { scope?: string } } }).self = {
        registration: { scope: "https://example.com/cells/agent/" },
      };
      globalThis.fetch = (async (_url, init) => {
        const bodyRaw = typeof init?.body === "string" ? init.body : "";
        fetchCalls.push(bodyRaw);
        const body = JSON.parse(bodyRaw) as {
          method?: string;
          params?: { name?: string };
        };
        expect(body.method).toBe("tools/call");
        expect(body.params?.name).toBe("load_tools");
        return new Response(
          JSON.stringify({
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    results: [
                      {
                        serverId: "srv_artist",
                        toolName: "flux_image",
                        loadedToolName: "mcp__srv_artist__flux_image",
                        result: "success",
                        description: "generate image",
                        inputSchema: {
                          type: "object",
                          properties: { prompt: { type: "string" } },
                          required: ["prompt"],
                        },
                      },
                    ],
                  }),
                },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }) as typeof fetch;

      await executeTool(
        "load_tools",
        JSON.stringify({ tools: [{ serverId: "srv_artist", toolName: "flux_image" }] }),
        {} as ModelState,
        "thread-load-tools-schema"
      );
      const loaded = getLoadedToolSchemas("thread-load-tools-schema");
      expect(loaded).toHaveLength(1);
      expect(loaded[0]?.function.name).toBe("mcp__srv_artist__flux_image");
      expect(loaded[0]?.function.description).toBe("generate image");
      expect(loaded[0]?.function.parameters).toEqual({
        type: "object",
        properties: { prompt: { type: "string" } },
        required: ["prompt"],
      });
      expect(fetchCalls).toHaveLength(1);
    } finally {
      (globalThis as { self?: unknown }).self = originalSelf;
      globalThis.fetch = originalFetch;
    }
  });
});
