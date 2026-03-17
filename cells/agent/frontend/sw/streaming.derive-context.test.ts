import { describe, expect, test } from "bun:test";
import type { OpenAIFormatTool } from "./mcp-meta-tools.ts";
import { deriveContext } from "./streaming.ts";

function mkTool(name: string): OpenAIFormatTool {
  return {
    type: "function",
    function: {
      name,
      description: `tool ${name}`,
      parameters: { type: "object", properties: {} },
    },
  };
}

describe("deriveContext", () => {
  test("keeps only gateway meta tools by whitelist", () => {
    const ctx = deriveContext(
      [{ role: "user", content: "hello" }],
      {
        tools: [
          mkTool("list_servers"),
          mkTool("search_servers"),
          mkTool("get_tools"),
          mkTool("load_tools"),
          mkTool("add_server"),
          mkTool("remove_server"),
        ],
      },
      Date.now()
    );
    expect(ctx.tools.map((t) => t.function.name)).toEqual([
      "list_servers",
      "search_servers",
      "get_tools",
      "load_tools",
    ]);
  });

  test("extracts loaded tool schema from history and strips schema from tool result message", () => {
    const loadResultRaw = JSON.stringify({
      results: [
        {
          serverId: "srv_artist",
          toolName: "flux_image",
          loadedToolName: "mcp__srv_artist__flux_image",
          result: "success",
          description: "generate image",
          inputSchema: {
            type: "object",
            properties: {
              prompt: { type: "string" },
            },
            required: ["prompt"],
          },
        },
      ],
    });

    const ctx = deriveContext(
      [
        {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: { name: "load_tools", arguments: '{"tools":[{"serverId":"srv_artist","toolName":"flux_image"}]}' },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call-1",
          content: loadResultRaw,
        },
      ],
      {
        tools: [mkTool("list_servers"), mkTool("search_servers"), mkTool("get_tools"), mkTool("load_tools")],
      },
      Date.now()
    );

    const loaded = ctx.tools.find((t) => t.function.name === "mcp__srv_artist__flux_image");
    expect(loaded?.function.description).toBe("generate image");
    expect(loaded?.function.parameters).toEqual({
      type: "object",
      properties: {
        prompt: { type: "string" },
      },
      required: ["prompt"],
    });

    const toolMsg = ctx.messages.find((m) => m.role === "tool");
    expect(toolMsg?.role).toBe("tool");
    if (toolMsg?.role === "tool") {
      const sanitized = JSON.parse(toolMsg.content) as {
        results?: Array<{ inputSchema?: unknown }>;
      };
      expect(sanitized.results?.[0]?.inputSchema).toBeUndefined();
    }
  });
});
