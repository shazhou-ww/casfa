/**
 * MCP (Model Context Protocol) API functions.
 */

import type { McpRequest, McpResponse } from "../types/api.ts";
import type { Fetcher, FetchResult } from "../utils/fetch.ts";

/**
 * MCP API context.
 */
export type McpApiContext = {
  fetcher: Fetcher;
};

/**
 * Call MCP JSON-RPC endpoint.
 */
export type CallMcpParams = {
  method: string;
  params?: Record<string, unknown>;
  id?: string | number;
};

export const callMcp = async (
  ctx: McpApiContext,
  params: CallMcpParams
): Promise<FetchResult<McpResponse>> => {
  const request: McpRequest = {
    jsonrpc: "2.0",
    id: params.id ?? Date.now(),
    method: params.method,
    params: params.params,
  };

  return ctx.fetcher.request<McpResponse>("/api/mcp", {
    method: "POST",
    body: request,
  });
};

/**
 * List available MCP tools.
 */
export const listTools = async (ctx: McpApiContext): Promise<FetchResult<McpResponse>> => {
  return callMcp(ctx, { method: "tools/list" });
};

/**
 * Call an MCP tool.
 */
export type CallToolParams = {
  name: string;
  arguments?: Record<string, unknown>;
};

export const callTool = async (
  ctx: McpApiContext,
  params: CallToolParams
): Promise<FetchResult<McpResponse>> => {
  return callMcp(ctx, {
    method: "tools/call",
    params: {
      name: params.name,
      arguments: params.arguments,
    },
  });
};
