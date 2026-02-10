/**
 * MCP Tool Definitions
 */

export const MCP_TOOLS = [
  {
    name: "cas_read",
    description:
      "Read a blob from CAS by its hex key. Returns the blob content as base64.",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "The CAS node hex key",
        },
      },
      required: ["key"],
    },
  },
] as const;
