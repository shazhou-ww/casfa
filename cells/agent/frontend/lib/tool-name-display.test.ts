import { describe, expect, test } from "bun:test";
import { formatLoadedToolDisplayName } from "./tool-name-display.ts";

describe("formatLoadedToolDisplayName", () => {
  test("formats loaded tool name to server/tool display text", () => {
    const serverNames = new Map([["srv_b05bcca8a34a", "Artist MCP"]]);
    expect(
      formatLoadedToolDisplayName(
        "mcp__srv_b05bcca8a34a__flux_image_edit",
        serverNames
      )
    ).toBe("Artist MCP/flux-image-edit");
  });

  test("returns original when name is not loaded mcp pattern", () => {
    expect(formatLoadedToolDisplayName("list_servers", new Map())).toBe("list_servers");
  });
});
