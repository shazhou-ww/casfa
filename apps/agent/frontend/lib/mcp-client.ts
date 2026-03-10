/**
 * MCP JSON-RPC client over HTTP. Handles Bearer token; on 401 clears token, marks server for re-login, then throws.
 */

import { removeMCPToken } from "./mcp-oauth-tokens.ts";
import { getMCPToken } from "./mcp-oauth-tokens.ts";
import type { MCPServerConfig, MCPPrompt, MCPResource, MCPTool } from "./mcp-types.ts";
import { useAgentStore } from "../stores/agent-store.ts";

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
    await removeMCPToken(serverId);
    useAgentStore.getState().addMcpServerNeedingLogin(serverId);
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

/** Call MCP with optional token (for oauth2 servers). On 401 throws MCPAuthRequiredError.
 * Uses token whenever one exists for this server (auto-detect OAuth from 401, no need to set auth in config). */
export async function mcpCall<T>(
  config: MCPServerConfig,
  method: string,
  params?: Record<string, unknown>
): Promise<T> {
  const url = config.url ?? "";
  if (!url) throw new Error("MCP server URL required");
  let token: string | null = null;
  if (config.transport === "http") {
    const entry = await getMCPToken(config.id);
    token = entry?.access_token ?? null;
    if (token) console.log("[MCP OAuth] mcpCall: serverId=%s method=%s token=yes", config.id, method);
  }
  return await mcpRequest<T>(url, method, params, token, config.id);
}

export type ToolsListResult = { tools: MCPTool[]; nextCursor?: string };
export type PromptsListResult = { prompts: MCPPrompt[]; nextCursor?: string };
export type ResourcesListResult = { resources: MCPResource[]; nextCursor?: string };

/** Result of MCP prompts/get. messages are used for prompt injection; allowedTools for tool filtering when present. */
export type GetPromptResult = {
  messages: Array<{
    role: string;
    content: { type: "text"; text: string } | { type: string; [key: string]: unknown };
  }>;
  description?: string;
  allowedTools?: string[];
};

export async function listTools(config: MCPServerConfig, cursor?: string): Promise<ToolsListResult> {
  const result = await mcpCall<{ tools?: MCPTool[]; nextCursor?: string }>(config, "tools/list", cursor ? { cursor } : undefined);
  return { tools: result.tools ?? [], nextCursor: result.nextCursor };
}

export async function listPrompts(config: MCPServerConfig, cursor?: string): Promise<PromptsListResult> {
  const result = await mcpCall<{ prompts?: MCPPrompt[]; nextCursor?: string }>(config, "prompts/list", cursor ? { cursor } : undefined);
  return { prompts: result.prompts ?? [], nextCursor: result.nextCursor };
}

/** Call MCP prompts/get. Returns prompt messages for injection and optional allowedTools for tool filtering. */
export async function getPrompt(
  config: MCPServerConfig,
  name: string,
  args?: Record<string, unknown>
): Promise<GetPromptResult> {
  const result = await mcpCall<GetPromptResult>(config, "prompts/get", {
    name,
    arguments: args,
  });
  return {
    messages: result.messages ?? [],
    description: result.description,
    allowedTools: result.allowedTools,
  };
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

/** Call tools/list, prompts/list, resources/list. On 401 throws MCPAuthRequiredError.
 * If a list method returns "Method not found", that capability is treated as empty (no error). */
export async function discoverCapabilities(config: MCPServerConfig): Promise<MCPServerCapabilities> {
  const out: MCPServerCapabilities = { tools: [], prompts: [], resources: [] };

  function isMethodNotFound(e: unknown): boolean {
    const msg = e instanceof Error ? e.message : String(e);
    return msg.includes("Method not found");
  }

  const [toolsRes, promptsRes, resourcesRes] = await Promise.allSettled([
    listTools(config),
    listPrompts(config),
    listResources(config),
  ]);

  if (toolsRes.status === "fulfilled") {
    out.tools = toolsRes.value.tools;
  } else if (!isMethodNotFound(toolsRes.reason)) {
    out.error = toolsRes.reason instanceof Error ? toolsRes.reason.message : String(toolsRes.reason);
    throw toolsRes.reason;
  }

  if (promptsRes.status === "fulfilled") {
    out.prompts = promptsRes.value.prompts;
  } else if (!isMethodNotFound(promptsRes.reason)) {
    out.error = promptsRes.reason instanceof Error ? promptsRes.reason.message : String(promptsRes.reason);
    throw promptsRes.reason;
  }

  if (resourcesRes.status === "fulfilled") {
    out.resources = resourcesRes.value.resources;
  } else if (!isMethodNotFound(resourcesRes.reason)) {
    out.error = resourcesRes.reason instanceof Error ? resourcesRes.reason.message : String(resourcesRes.reason);
    throw resourcesRes.reason;
  }

  return out;
}
