/**
 * MCP JSON-RPC client over HTTP. Handles Bearer token; on 401 throws so caller can run OAuth discovery and retry.
 */

import { getMCPToken } from "./mcp-oauth-tokens.ts";
import type { MCPServerConfig, MCPPrompt, MCPResource, MCPTool } from "./mcp-types.ts";

export { discoverFrom401Response } from "./mcp-oauth-flow.ts";

export class MCPAuthRequiredError extends Error {
  constructor(
    message: string,
    public readonly response: Response,
    public readonly serverUrl: string,
    public readonly serverId: string
  ) {
    super(message);
    this.name = "MCPAuthRequiredError";
  }
}

async function mcpRequest<T>(
  serverUrl: string,
  method: string,
  params: Record<string, unknown> | undefined,
  accessToken: string | null,
  serverId: string
): Promise<T> {
  const endpoint = serverUrl.replace(/\/$/, "");
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method,
    params: params ?? {},
  };
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    credentials: "omit",
  });

  if (res.status === 401) {
    throw new MCPAuthRequiredError("MCP server returned 401", res, serverUrl, serverId);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MCP request failed: ${res.status} ${method} ${text}`);
  }
  const json = (await res.json()) as { result?: T; error?: { code: number; message: string } };
  if (json.error) throw new Error(`MCP error: ${json.error.message ?? json.error.code}`);
  return (json.result ?? {}) as T;
}

/** Call MCP with optional token (for oauth2 servers). On 401 throws MCPAuthRequiredError. */
export async function mcpCall<T>(
  config: MCPServerConfig,
  method: string,
  params?: Record<string, unknown>
): Promise<T> {
  const url = config.url ?? "";
  if (!url) throw new Error("MCP server URL required");
  let token: string | null = null;
  if (config.auth === "oauth2") {
    const entry = await getMCPToken(config.id);
    token = entry?.access_token ?? null;
    console.log("[MCP OAuth] mcpCall: serverId=%s method=%s token=%s", config.id, method, token ? "yes" : "no");
  }
  return await mcpRequest<T>(url, method, params, token, config.id);
}

export type ToolsListResult = { tools: MCPTool[]; nextCursor?: string };
export type PromptsListResult = { prompts: MCPPrompt[]; nextCursor?: string };
export type ResourcesListResult = { resources: MCPResource[]; nextCursor?: string };

export async function listTools(config: MCPServerConfig, cursor?: string): Promise<ToolsListResult> {
  const result = await mcpCall<{ tools?: MCPTool[]; nextCursor?: string }>(config, "tools/list", cursor ? { cursor } : undefined);
  return { tools: result.tools ?? [], nextCursor: result.nextCursor };
}

export async function listPrompts(config: MCPServerConfig, cursor?: string): Promise<PromptsListResult> {
  const result = await mcpCall<{ prompts?: MCPPrompt[]; nextCursor?: string }>(config, "prompts/list", cursor ? { cursor } : undefined);
  return { prompts: result.prompts ?? [], nextCursor: result.nextCursor };
}

export async function listResources(config: MCPServerConfig, cursor?: string): Promise<ResourcesListResult> {
  const result = await mcpCall<{ resources?: MCPResource[]; nextCursor?: string }>(config, "resources/list", cursor ? { cursor } : undefined);
  return { resources: result.resources ?? [], nextCursor: result.nextCursor };
}

export type MCPServerCapabilities = {
  tools: MCPTool[];
  prompts: MCPPrompt[];
  resources: MCPResource[];
  error?: string;
};

/** Call tools/list, prompts/list, resources/list. On 401 throws MCPAuthRequiredError. */
export async function discoverCapabilities(config: MCPServerConfig): Promise<MCPServerCapabilities> {
  const out: MCPServerCapabilities = { tools: [], prompts: [], resources: [] };
  try {
    const [toolsRes, promptsRes, resourcesRes] = await Promise.all([
      listTools(config),
      listPrompts(config),
      listResources(config),
    ]);
    out.tools = toolsRes.tools;
    out.prompts = promptsRes.prompts;
    out.resources = resourcesRes.resources;
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
    throw e;
  }
  return out;
}
