import { describe, expect, it } from "bun:test";
import { createMemoryServerOAuthStateStore } from "../services/server-oauth-state.ts";
import { getToolsForServers } from "../services/tool-discovery.ts";

describe("tool discovery visibility", () => {
  it("hides branch lifecycle primitives from get_tools", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            result: {
              tools: [
                { name: "create_branch", description: "create" },
                { name: "transfer_paths", description: "transfer" },
                { name: "close_branch", description: "close" },
                { name: "flux_image", description: "image" },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )) as typeof fetch;

      const results = await getToolsForServers(
        "user-1",
        [{ id: "srv_artist", name: "artist", url: "https://artist.example.com/mcp" }],
        createMemoryServerOAuthStateStore()
      );
      expect(results).toHaveLength(1);
      expect(results[0]?.tools.map((t) => t.name)).toEqual(["flux_image"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
