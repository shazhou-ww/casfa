/**
 * MCP Tool Definitions
 *
 * v0.1 — Minimal verification: list_depots only
 */

export const MCP_TOOLS = [
  {
    name: "list_depots",
    description:
      "List all depots in the authenticated user's realm. Returns depot IDs, titles, root node keys, and timestamps.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [] as string[],
    },
  },
] as const;
