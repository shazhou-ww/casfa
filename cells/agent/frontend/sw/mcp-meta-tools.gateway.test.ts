import { describe, expect, test } from "bun:test";
import { metaToolSchemas } from "./mcp-meta-tools.ts";

describe("gateway meta tool schemas", () => {
  test("exports gateway tool names", () => {
    const names = metaToolSchemas.map((tool) => tool.function.name);
    expect(names).toEqual(["list_servers", "search_servers", "get_tools", "load_tools"]);
    expect(names.includes("list_mcp_servers")).toBe(false);
    expect(names.includes("get_mcp_tools")).toBe(false);
  });
});
