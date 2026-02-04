/**
 * MCP (Model Context Protocol) Handler
 */

import type { StorageProvider } from "@casfa/storage-core";
import type { Context } from "hono";
import { z } from "zod";
import type { ServerConfig } from "../config.ts";
import type { OwnershipDb } from "../db/ownership.ts";
import type { TokensDb } from "../db/tokens.ts";
import type { AuthContext, Env } from "../types.ts";
import { extractTokenId } from "../util/token-id.ts";
import { MCP_TOOLS } from "./tools.ts";

// ============================================================================
// Types
// ============================================================================

type McpRequest = {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: unknown;
};

type McpResponse = {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

// MCP Error Codes
const MCP_PARSE_ERROR = -32700;
const MCP_INVALID_REQUEST = -32600;
const MCP_METHOD_NOT_FOUND = -32601;
const MCP_INVALID_PARAMS = -32602;
const MCP_INTERNAL_ERROR = -32603;

// ============================================================================
// Schemas
// ============================================================================

const GetTicketSchema = z.object({
  scope: z.union([z.string(), z.array(z.string())]),
  writable: z.boolean().default(false),
  expiresIn: z.number().positive().optional(),
});

const ReadBlobSchema = z.object({
  endpoint: z.string().url(),
  key: z.string(),
  path: z.string().default("."),
});

const WriteBlobSchema = z.object({
  endpoint: z.string().url(),
  content: z.string(),
  contentType: z.string(),
});

// ============================================================================
// Response Helpers
// ============================================================================

const mcpSuccess = (id: string | number, result: unknown): McpResponse => ({
  jsonrpc: "2.0",
  id,
  result,
});

const mcpError = (
  id: string | number,
  code: number,
  message: string,
  data?: unknown
): McpResponse => ({
  jsonrpc: "2.0",
  id,
  error: { code, message, data },
});

// ============================================================================
// Handler
// ============================================================================

export type McpHandlerDeps = {
  tokensDb: TokensDb;
  ownershipDb: OwnershipDb;
  storage: StorageProvider;
  serverConfig: ServerConfig;
};

export type McpController = {
  handle: (c: Context<Env>) => Promise<Response>;
};

export const createMcpController = (deps: McpHandlerDeps): McpController => {
  const { tokensDb, ownershipDb, storage, serverConfig } = deps;

  const handleInitialize = (id: string | number): McpResponse => {
    return mcpSuccess(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "cas-mcp", version: "0.2.0" },
    });
  };

  const handleToolsList = (id: string | number): McpResponse => {
    return mcpSuccess(id, { tools: MCP_TOOLS });
  };

  const handleGetTicket = async (
    id: string | number,
    args: unknown,
    auth: AuthContext
  ): Promise<McpResponse> => {
    const parsed = GetTicketSchema.safeParse(args);
    if (!parsed.success) {
      return mcpError(id, MCP_INVALID_PARAMS, "Invalid parameters", parsed.error.issues);
    }

    const normalizedScope = Array.isArray(parsed.data.scope)
      ? parsed.data.scope
      : [parsed.data.scope];

    // Use the caller's issuerId directly
    const ticket = await tokensDb.createTicket(auth.realm, auth.issuerId, {
      scope: normalizedScope,
      commit: parsed.data.writable ? {} : undefined,
      expiresIn: parsed.data.expiresIn,
    });

    const ticketId = extractTokenId(ticket.pk);
    const endpoint = `${serverConfig.baseUrl}/api/ticket/${ticketId}`;

    return mcpSuccess(id, {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            endpoint,
            scope: ticket.scope,
            expiresAt: new Date(ticket.expiresAt).toISOString(),
          }),
        },
      ],
    });
  };

  const handleRead = async (id: string | number, args: unknown): Promise<McpResponse> => {
    const parsed = ReadBlobSchema.safeParse(args);
    if (!parsed.success) {
      return mcpError(id, MCP_INVALID_PARAMS, "Invalid parameters", parsed.error.issues);
    }

    // Path resolution not supported in this version
    if (parsed.data.path !== ".") {
      return mcpError(
        id,
        MCP_INVALID_PARAMS,
        "Path resolution not yet supported. Use path='.' with direct key."
      );
    }

    // Parse endpoint to get ticket ID
    const match = parsed.data.endpoint.match(/\/api\/ticket\/([^/]+)$/);
    if (!match) {
      return mcpError(id, MCP_INVALID_PARAMS, "Invalid endpoint URL format");
    }

    const ticketId = match[1]!;
    const ticket = await tokensDb.getTicket(ticketId);
    if (!ticket) {
      return mcpError(id, MCP_INVALID_PARAMS, "Invalid or expired ticket");
    }

    // Check ownership
    const hasAccess = await ownershipDb.hasOwnership(ticket.realm, parsed.data.key);
    if (!hasAccess) {
      return mcpError(id, MCP_INVALID_PARAMS, "Node not found or not accessible");
    }

    // Get content
    const bytes = await storage.get(parsed.data.key);
    if (!bytes) {
      return mcpError(id, MCP_INVALID_PARAMS, "Node not found in storage");
    }

    const content = Buffer.from(bytes).toString("base64");

    return mcpSuccess(id, {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            key: parsed.data.key,
            contentType: "application/octet-stream",
            size: bytes.length,
            content,
          }),
        },
      ],
    });
  };

  const handleWrite = async (id: string | number, args: unknown): Promise<McpResponse> => {
    const parsed = WriteBlobSchema.safeParse(args);
    if (!parsed.success) {
      return mcpError(id, MCP_INVALID_PARAMS, "Invalid parameters", parsed.error.issues);
    }

    // Parse endpoint
    const match = parsed.data.endpoint.match(/\/api\/ticket\/([^/]+)$/);
    if (!match) {
      return mcpError(id, MCP_INVALID_PARAMS, "Invalid endpoint URL format");
    }

    const ticketId = match[1]!;
    const ticket = await tokensDb.getTicket(ticketId);
    if (!ticket) {
      return mcpError(id, MCP_INVALID_PARAMS, "Invalid or expired ticket");
    }

    if (!ticket.commit || ticket.commit.root) {
      return mcpError(id, MCP_INVALID_PARAMS, "Ticket has no commit permission or already used");
    }

    // Decode and store content
    const _content = Buffer.from(parsed.data.content, "base64");

    // For simplicity, we'd need to implement full chunk creation here
    // This is a placeholder
    return mcpError(
      id,
      MCP_INTERNAL_ERROR,
      "Write operation requires full CAS node creation - use HTTP API"
    );
  };

  const handleToolsCall = async (
    id: string | number,
    params: { name: string; arguments?: unknown } | undefined,
    auth: AuthContext
  ): Promise<McpResponse> => {
    if (!params?.name) {
      return mcpError(id, MCP_INVALID_PARAMS, "Missing tool name");
    }

    switch (params.name) {
      case "cas_get_ticket":
        return handleGetTicket(id, params.arguments, auth);
      case "cas_read":
        return handleRead(id, params.arguments);
      case "cas_write":
        return handleWrite(id, params.arguments);
      default:
        return mcpError(id, MCP_METHOD_NOT_FOUND, `Unknown tool: ${params.name}`);
    }
  };

  return {
    handle: async (c) => {
      const auth = c.get("auth");

      // Must have ticket issuing capability
      if (!auth.canIssueTicket) {
        return c.json({ error: "Agent or User token required for MCP access" }, 403);
      }

      // Parse request
      let request: McpRequest;
      try {
        request = await c.req.json();
      } catch {
        return c.json([mcpError(0, MCP_PARSE_ERROR, "Parse error")]);
      }

      if (request.jsonrpc !== "2.0" || !request.method) {
        return c.json([mcpError(request.id ?? 0, MCP_INVALID_REQUEST, "Invalid request")]);
      }

      // Route to handler
      let response: McpResponse;

      switch (request.method) {
        case "initialize":
          response = handleInitialize(request.id);
          break;
        case "tools/list":
          response = handleToolsList(request.id);
          break;
        case "tools/call":
          response = await handleToolsCall(
            request.id,
            request.params as { name: string; arguments?: unknown },
            auth
          );
          break;
        default:
          response = mcpError(
            request.id,
            MCP_METHOD_NOT_FOUND,
            `Method not found: ${request.method}`
          );
      }

      return c.json(response);
    },
  };
};
