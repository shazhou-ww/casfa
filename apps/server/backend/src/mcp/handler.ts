/**
 * MCP (Model Context Protocol) Handler
 *
 * This controller is accessed by JWT-authenticated users (typically AI agents)
 * to interact with the CAS system via the MCP protocol.
 */

import { isWellKnownNode } from "@casfa/core";
import type { StorageProvider } from "@casfa/storage-core";
import type { Context } from "hono";
import { z } from "zod";
import type { ServerConfig } from "../config.ts";
import type { OwnershipV2Db } from "../db/ownership-v2.ts";
import type { Env, JwtAuthContext } from "../types.ts";
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
const _MCP_INTERNAL_ERROR = -32603;

// ============================================================================
// Schemas
// ============================================================================

const ReadBlobSchema = z.object({
  key: z.string(),
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
  ownershipV2Db: OwnershipV2Db;
  storage: StorageProvider;
  serverConfig: ServerConfig;
};

export type McpController = {
  handle: (c: Context<Env>) => Promise<Response>;
};

export const createMcpController = (deps: McpHandlerDeps): McpController => {
  const { ownershipV2Db, storage } = deps;

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

  const handleRead = async (id: string | number, args: unknown): Promise<McpResponse> => {
    const parsed = ReadBlobSchema.safeParse(args);
    if (!parsed.success) {
      return mcpError(id, MCP_INVALID_PARAMS, "Invalid parameters", parsed.error.issues);
    }

    // Check ownership (well-known nodes are universally accessible)
    const hasAccess =
      isWellKnownNode(parsed.data.key) || (await ownershipV2Db.hasAnyOwnership(parsed.data.key));
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

  const handleToolsCall = async (
    id: string | number,
    params: { name: string; arguments?: unknown } | undefined,
    auth: JwtAuthContext
  ): Promise<McpResponse> => {
    if (!params?.name) {
      return mcpError(id, MCP_INVALID_PARAMS, "Missing tool name");
    }

    switch (params.name) {
      case "cas_read":
        return handleRead(id, params.arguments);
      default:
        return mcpError(id, MCP_METHOD_NOT_FOUND, `Unknown tool: ${params.name}`);
    }
  };

  return {
    handle: async (c) => {
      const auth = c.get("auth");

      // MCP requires JWT authentication
      if (auth.type !== "jwt") {
        return c.json({ error: "JWT authentication required for MCP access" }, 403);
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
