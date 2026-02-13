/**
 * MCP (Model Context Protocol) Handler
 *
 * v0.1 — Minimal implementation with list_depots for OAuth verification.
 *
 * Supports both JWT and Delegate AT authentication via accessTokenMiddleware.
 * The auth context provides `realm` which scopes all data access.
 */

import type { Context } from "hono";
import type { DepotsDb } from "../db/depots.ts";
import type { AccessTokenAuthContext, Env } from "../types.ts";
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
  data?: unknown,
): McpResponse => ({
  jsonrpc: "2.0",
  id,
  error: { code, message, data },
});

// ============================================================================
// Handler
// ============================================================================

export type McpHandlerDeps = {
  depotsDb: DepotsDb;
};

export type McpController = {
  handle: (c: Context<Env>) => Promise<Response>;
};

export const createMcpController = (deps: McpHandlerDeps): McpController => {
  const { depotsDb } = deps;

  const handleInitialize = (id: string | number): McpResponse => {
    return mcpSuccess(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "casfa-mcp", version: "0.1.0" },
    });
  };

  const handleToolsList = (id: string | number): McpResponse => {
    return mcpSuccess(id, { tools: MCP_TOOLS });
  };

  const handleListDepots = async (
    id: string | number,
    auth: AccessTokenAuthContext,
  ): Promise<McpResponse> => {
    const result = await depotsDb.list(auth.realm);
    const depots = result.depots.map((d) => ({
      depotId: d.depotId,
      title: d.title,
      root: d.root,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    }));

    return mcpSuccess(id, {
      content: [
        {
          type: "text",
          text: JSON.stringify(depots),
        },
      ],
    });
  };

  const handleToolsCall = async (
    id: string | number,
    params: { name: string; arguments?: unknown } | undefined,
    auth: AccessTokenAuthContext,
  ): Promise<McpResponse> => {
    if (!params?.name) {
      return mcpError(id, MCP_METHOD_NOT_FOUND, "Missing tool name");
    }

    switch (params.name) {
      case "list_depots":
        return handleListDepots(id, auth);
      default:
        return mcpError(id, MCP_METHOD_NOT_FOUND, `Unknown tool: ${params.name}`);
    }
  };

  return {
    handle: async (c) => {
      const auth = c.get("auth") as AccessTokenAuthContext;

      // Parse request
      let request: McpRequest;
      try {
        request = await c.req.json();
      } catch {
        return c.json(mcpError(0, MCP_PARSE_ERROR, "Parse error"));
      }

      if (request.jsonrpc !== "2.0" || !request.method) {
        return c.json(mcpError(request.id ?? 0, MCP_INVALID_REQUEST, "Invalid request"));
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
            auth,
          );
          break;
        default:
          response = mcpError(
            request.id,
            MCP_METHOD_NOT_FOUND,
            `Method not found: ${request.method}`,
          );
      }

      return c.json(response);
    },
  };
};
