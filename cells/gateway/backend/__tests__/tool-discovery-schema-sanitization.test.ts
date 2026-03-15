import { describe, expect, it } from "bun:test";
import { createMemoryServerOAuthStateStore } from "../services/server-oauth-state.ts";
import { getToolsForServers } from "../services/tool-discovery.ts";

describe("tool discovery schema sanitization", () => {
  it("removes bound branchUrl field from tool inputSchema returned to agent", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            result: {
              tools: [
                {
                  name: "flux_image",
                  description: "generate image",
                  inputSchema: {
                    type: "object",
                    properties: {
                      casfaBranchUrl: { type: "string" },
                      outputPath: { type: "string" },
                      prompt: { type: "string" },
                    },
                    required: ["casfaBranchUrl", "outputPath", "prompt"],
                  },
                },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )) as typeof fetch;

      const results = await getToolsForServers(
        "user-1",
        [{ id: "artist", name: "artist", url: "https://artist.example.com/mcp" }],
        createMemoryServerOAuthStateStore()
      );

      const tool = results[0]?.tools[0];
      expect(tool?.name).toBe("flux_image");
      const schema = tool?.inputSchema as {
        properties?: Record<string, unknown>;
        required?: unknown[];
      };
      expect(schema.properties?.casfaBranchUrl).toBeUndefined();
      expect(schema.required?.includes("casfaBranchUrl")).toBe(false);
      expect(schema.properties?.outputPath).toBeDefined();
      expect(schema.properties?.prompt).toBeDefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
