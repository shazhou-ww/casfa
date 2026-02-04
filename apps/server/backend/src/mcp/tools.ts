/**
 * MCP Tool Definitions
 */

export const MCP_TOOLS = [
  {
    name: "cas_get_ticket",
    description:
      "Get a CAS access ticket for reading or writing blobs. " +
      "Returns an endpoint URL that can be used in #cas-endpoint field.",
    inputSchema: {
      type: "object",
      properties: {
        scope: {
          oneOf: [
            { type: "string", description: "DAG root key to access" },
            { type: "array", items: { type: "string" }, description: "Multiple DAG root keys" },
          ],
          description: "The scope (DAG root keys) to access",
        },
        writable: {
          type: "boolean",
          description: "Whether write access is needed",
          default: false,
        },
        expiresIn: {
          type: "number",
          description: "Ticket expiration in seconds (default: 3600)",
        },
      },
      required: ["scope"],
    },
  },
  {
    name: "cas_read",
    description:
      "Read a blob from CAS using a ticket endpoint. Returns the blob content as base64.",
    inputSchema: {
      type: "object",
      properties: {
        endpoint: {
          type: "string",
          description: "The #cas-endpoint URL from ticket",
        },
        key: {
          type: "string",
          description: "The CAS node key (cas-node)",
        },
        path: {
          type: "string",
          description: "Path within the node ('.' for file itself, './path' for collection child)",
          default: ".",
        },
      },
      required: ["endpoint", "key"],
    },
  },
  {
    name: "cas_write",
    description:
      "Write a blob to CAS using a writable ticket endpoint. " +
      "Returns the CAS key of the uploaded blob.",
    inputSchema: {
      type: "object",
      properties: {
        endpoint: {
          type: "string",
          description: "The #cas-endpoint URL from a writable ticket",
        },
        content: {
          type: "string",
          description: "Base64 encoded content to upload",
        },
        contentType: {
          type: "string",
          description: "MIME type of the content",
        },
      },
      required: ["endpoint", "content", "contentType"],
    },
  },
] as const;
