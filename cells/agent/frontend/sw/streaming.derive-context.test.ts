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
});
