/**
 * MCP meta-tools for the Service Worker: list_mcp_servers, get_mcp_tools, load_tool.
 * Progressive discovery (Level 0: servers, Level 1: tools per server, Level 2: load one tool schema).
 */

import { listPrompts, listTools, mcpCall } from "../lib/mcp-client.ts";
import { MCP_SERVERS_SETTINGS_KEY, parseMcpServers } from "../lib/mcp-types.ts";
import type { MCPServerConfig } from "../lib/mcp-types.ts";
import type { ModelState } from "../lib/model-types.ts";
import systemPromptTextRaw from "./system-prompt.md?raw";

const MCP_DEBUG_PREFIX = "[agent-mcp-debug]";

function summarizeConfigs(configs: MCPServerConfig[]): Array<{ id: string; name: string; hasUrl: boolean }> {
  return configs.map((c) => ({ id: c.id, name: c.name, hasUrl: Boolean(c.url) }));
}

// ----- Types -----

export type ListMcpServersResult = {
  servers: Array<{
    serverId: string;
    name?: string;
    description?: string;
    unavailable?: boolean;
    error?: string;
  }>;
};

export type GetMcpToolsResult = {
  serverId: string;
  tools: Array<{ name: string; description?: string }>;
  prompts?: Array<{ name: string; description?: string }>;
};

export type LoadToolResult = {
  result: "success";
  serverId: string;
  toolName: string;
  loadedToolName: string;
};

/** OpenAI-format tool for request body (type + function with name, description, parameters). */
export type OpenAIFormatTool = {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
};

type LoadedToolEntry = {
  serverId: string;
  toolName: string;
  loadedToolName: string;
  schema: OpenAIFormatTool;
  loadedAt: number;
  lastUsedAt: number;
};

const MAX_LOADED_TOOLS_PER_THREAD = 20;
const loadedToolsByThread = new Map<string, Map<string, LoadedToolEntry>>();

function toFunctionSafeName(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function stableShortHash(value: string): string {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).slice(0, 6);
}

function buildLoadedToolName(serverId: string, toolName: string): string {
  const safeServer = toFunctionSafeName(serverId) || "server";
  const safeTool = toFunctionSafeName(toolName) || "tool";
  const suffix = stableShortHash(`${serverId}::${toolName}`);
  return `mcp__${safeServer}__${safeTool}__${suffix}`;
}

function normalizeSchemaParameters(inputSchema: unknown): unknown {
  if (typeof inputSchema === "object" && inputSchema !== null && !Array.isArray(inputSchema)) {
    return inputSchema;
  }
  return { type: "object", properties: {}, required: [] };
}

function getThreadLoadedMap(threadId: string): Map<string, LoadedToolEntry> {
  const existing = loadedToolsByThread.get(threadId);
  if (existing) return existing;
  const created = new Map<string, LoadedToolEntry>();
  loadedToolsByThread.set(threadId, created);
  return created;
}

function pruneThreadLoadedTools(threadId: string): void {
  const map = loadedToolsByThread.get(threadId);
  if (!map) return;
  if (map.size <= MAX_LOADED_TOOLS_PER_THREAD) return;
  const entries = [...map.values()].sort((a, b) => a.lastUsedAt - b.lastUsedAt);
  const toRemove = map.size - MAX_LOADED_TOOLS_PER_THREAD;
  for (let i = 0; i < toRemove; i++) {
    map.delete(entries[i].loadedToolName);
  }
}

export function getLoadedToolSchemas(threadId: string): OpenAIFormatTool[] {
  return [...(loadedToolsByThread.get(threadId)?.values() ?? [])]
    .sort((a, b) => a.loadedAt - b.loadedAt)
    .map((entry) => entry.schema);
}

function markLoadedToolUsed(threadId: string, loadedToolName: string): void {
  const map = loadedToolsByThread.get(threadId);
  if (!map) return;
  const entry = map.get(loadedToolName);
  if (!entry) return;
  entry.lastUsedAt = Date.now();
  map.set(loadedToolName, entry);
}

function lookupLoadedToolByFunctionName(
  threadId: string,
  loadedToolName: string
): LoadedToolEntry | null {
  return loadedToolsByThread.get(threadId)?.get(loadedToolName) ?? null;
}

// ----- Level 0: list_mcp_servers -----

export async function listMcpServers(state: ModelState): Promise<ListMcpServersResult> {
  const configs = parseMcpServers(state.settings[MCP_SERVERS_SETTINGS_KEY]);
  console.info(`${MCP_DEBUG_PREFIX} list_mcp_servers`, {
    totalConfigs: configs.length,
    configs: summarizeConfigs(configs),
  });
  const servers: ListMcpServersResult["servers"] = [];

  for (const config of configs) {
    if (!config.url) continue;
    servers.push({
      serverId: config.id,
      name: config.name ?? config.id,
      description: undefined,
    });
  }

  return { servers };
}

// ----- Level 1: get_mcp_tools -----

export async function getMcpTools(state: ModelState, serverId: string): Promise<GetMcpToolsResult | { error: string }> {
  const configs = parseMcpServers(state.settings[MCP_SERVERS_SETTINGS_KEY]);
  const config = configs.find((c) => c.id === serverId);
  if (!config) {
    console.warn(`${MCP_DEBUG_PREFIX} get_mcp_tools server not found`, {
      serverId,
      configs: summarizeConfigs(configs),
    });
    return { error: "server not found: use exact serverId from list_mcp_servers" };
  }
  if (!config.url) return { error: "server has no url (http transport required)" };

  try {
    console.info(`${MCP_DEBUG_PREFIX} get_mcp_tools request`, {
      serverId,
      serverName: config.name,
      url: config.url,
    });
    const [toolsResult, promptsResult] = await Promise.all([listTools(config), listPrompts(config).catch(() => ({ prompts: [] }))]);
    const tools = (toolsResult.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description,
    }));
    const prompts = (promptsResult.prompts ?? []).map((p) => ({
      name: p.name,
      description: p.description,
    }));
    console.info(`${MCP_DEBUG_PREFIX} get_mcp_tools response`, {
      serverId,
      toolCount: tools.length,
      promptCount: prompts.length,
      toolNames: tools.map((t) => t.name),
    });
    return { serverId, tools, prompts };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${MCP_DEBUG_PREFIX} get_mcp_tools error`, { serverId, message });
    return { error: message };
  }
}

// ----- Level 2: load_tool -----

export async function loadTool(
  state: ModelState,
  threadId: string,
  serverId: string,
  toolName: string
): Promise<LoadToolResult | { error: string }> {
  const configs = parseMcpServers(state.settings[MCP_SERVERS_SETTINGS_KEY]);
  const config = configs.find((c) => c.id === serverId);
  if (!config) {
    console.warn(`${MCP_DEBUG_PREFIX} load_tool server not found`, {
      serverId,
      toolName,
      threadId,
      configs: summarizeConfigs(configs),
    });
    return { error: "server not found: use exact serverId from list_mcp_servers" };
  }
  if (!config.url) return { error: "server has no url (http transport required)" };

  try {
    console.info(`${MCP_DEBUG_PREFIX} load_tool request`, {
      serverId,
      serverName: config.name,
      toolName,
      threadId,
      url: config.url,
    });
    const toolsResult = await listTools(config);
    const tool = (toolsResult.tools ?? []).find((t) => t.name === toolName);
    if (!tool) return { error: "tool not found" };

    const loadedToolName = buildLoadedToolName(serverId, toolName);
    const schema: OpenAIFormatTool = {
      type: "function",
      function: {
        name: loadedToolName,
        description: tool.description ?? `Run MCP tool ${toolName} on server ${serverId}.`,
        parameters: normalizeSchemaParameters(tool.inputSchema),
      },
    };
    const threadMap = getThreadLoadedMap(threadId);
    const now = Date.now();
    threadMap.set(loadedToolName, {
      serverId,
      toolName,
      loadedToolName,
      schema,
      loadedAt: now,
      lastUsedAt: now,
    });
    pruneThreadLoadedTools(threadId);

    const loaded: LoadToolResult = {
      result: "success",
      serverId,
      toolName,
      loadedToolName,
    };
    console.info(`${MCP_DEBUG_PREFIX} load_tool response`, {
      serverId,
      toolName,
      threadId,
      loadedToolName,
    });
    return loaded;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${MCP_DEBUG_PREFIX} load_tool error`, {
      serverId,
      toolName,
      threadId,
      message,
    });
    return { error: message };
  }
}

// ----- run_mcp_tool -----

export async function runMcpTool(
  state: ModelState,
  serverId: string,
  toolName: string,
  args: Record<string, unknown> | undefined
): Promise<string> {
  const configs = parseMcpServers(state.settings[MCP_SERVERS_SETTINGS_KEY]);
  const config = configs.find((c) => c.id === serverId);
  if (!config) {
    console.warn(`${MCP_DEBUG_PREFIX} run_mcp_tool server not found`, {
      serverId,
      toolName,
      args: args ?? {},
      configs: summarizeConfigs(configs),
    });
    return JSON.stringify({
      error: "server not found: use exact serverId from list_mcp_servers",
      requestedServerId: serverId,
      availableServers: summarizeConfigs(configs).map((c) => ({ serverId: c.id, name: c.name })),
    });
  }
  if (!config.url) return JSON.stringify({ error: "server has no url (http transport required)" });

  try {
    const toolsResult = await listTools(config);
    const availableToolNames = (toolsResult.tools ?? []).map((t) => t.name);
    const exactToolName = availableToolNames.find((n) => n === toolName);
    if (!exactToolName) {
      console.warn(`${MCP_DEBUG_PREFIX} run_mcp_tool tool not found`, {
        serverId,
        requestedToolName: toolName,
        availableToolNames,
      });
      return JSON.stringify({
        error: "tool not found",
        requestedToolName: toolName,
        availableToolNames,
      });
    }

    console.info(`${MCP_DEBUG_PREFIX} run_mcp_tool request`, {
      serverId: config.id,
      serverName: config.name,
      requestedToolName: toolName,
      toolName: exactToolName,
      args: args ?? {},
      url: config.url,
    });
    const result = await mcpCall<{ content?: Array<{ type: string; text?: string }>; isError?: boolean }>(config, "tools/call", {
      name: exactToolName,
      arguments: args ?? {},
    });
    console.info(`${MCP_DEBUG_PREFIX} run_mcp_tool response`, {
      serverId: config.id,
      toolName: exactToolName,
      isError: Boolean(result.isError),
      contentTypes: (result.content ?? []).map((c) => c.type),
    });
    const text = result.content?.map((c) => (c.type === "text" && c.text ? c.text : "")).join("") ?? "";
    if (text) return text;
    return JSON.stringify(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${MCP_DEBUG_PREFIX} run_mcp_tool error`, { serverId, toolName, message });
    return JSON.stringify({ error: message });
  }
}

// ----- Meta tool schemas (OpenAI format) -----

const LIST_MCP_SERVERS_SCHEMA: OpenAIFormatTool = {
  type: "function",
  function: {
    name: "list_mcp_servers",
    description: "List all configured MCP servers that have a URL (Level 0 discovery). Use get_mcp_tools(serverId) to list tools for a server.",
    parameters: { type: "object" as const, properties: {} as Record<string, never>, required: [] as string[] },
  },
};

const GET_MCP_TOOLS_SCHEMA: OpenAIFormatTool = {
  type: "function",
  function: {
    name: "get_mcp_tools",
    description:
      "List tools (name and description only, no schema) and optional prompts for a specific MCP server (Level 1 discovery). Prefer exact serverId from list_mcp_servers.",
    parameters: {
      type: "object" as const,
      properties: {
        serverId: { type: "string" as const, description: "MCP server id from list_mcp_servers" },
      },
      required: ["serverId"] as string[],
    },
  },
};

const LOAD_TOOL_SCHEMA: OpenAIFormatTool = {
  type: "function",
  function: {
    name: "load_tool",
    description:
      "Load one MCP tool schema into the active context. After success, call the returned loadedToolName directly as a function.",
    parameters: {
      type: "object" as const,
      properties: {
        serverId: { type: "string" as const, description: "MCP server id" },
        toolName: { type: "string" as const, description: "Tool name from get_mcp_tools" },
      },
      required: ["serverId", "toolName"] as string[],
    },
  },
};

export const metaToolSchemas: OpenAIFormatTool[] = [
  LIST_MCP_SERVERS_SCHEMA,
  GET_MCP_TOOLS_SCHEMA,
  LOAD_TOOL_SCHEMA,
];

// ----- Execute meta tool -----

const META_TOOL_NAMES = ["list_mcp_servers", "get_mcp_tools", "load_tool"] as const;

export async function executeMetaTool(
  name: string,
  args: Record<string, unknown>,
  state: ModelState,
  threadId: string
): Promise<string> {
  switch (name) {
    case "list_mcp_servers": {
      const result = await listMcpServers(state);
      return JSON.stringify(result);
    }
    case "get_mcp_tools": {
      const serverId = typeof args.serverId === "string" ? args.serverId : "";
      const result = await getMcpTools(state, serverId);
      return JSON.stringify(result);
    }
    case "load_tool": {
      const serverId = typeof args.serverId === "string" ? args.serverId : "";
      const toolName = typeof args.toolName === "string" ? args.toolName : "";
      const result = await loadTool(state, threadId, serverId, toolName);
      return JSON.stringify(result);
    }
    default:
      return JSON.stringify({ error: `unknown meta-tool: ${name}` });
  }
}

// ----- Execute any tool (only meta tools now) -----

export async function executeTool(
  name: string,
  argsJson: string,
  state: ModelState,
  threadId: string
): Promise<string> {
  if (!META_TOOL_NAMES.includes(name as (typeof META_TOOL_NAMES)[number])) {
    const loaded = lookupLoadedToolByFunctionName(threadId, name);
    if (!loaded) {
      console.warn(`${MCP_DEBUG_PREFIX} execute_tool unknown tool`, { name, threadId });
      return JSON.stringify({ error: `unknown tool: ${name}` });
    }
    let loadedArgs: Record<string, unknown> = {};
    try {
      loadedArgs = argsJson ? (JSON.parse(argsJson) as Record<string, unknown>) : {};
    } catch {
      return JSON.stringify({ error: "invalid arguments JSON" });
    }
    markLoadedToolUsed(threadId, name);
    return runMcpTool(state, loaded.serverId, loaded.toolName, loadedArgs);
  }
  let args: Record<string, unknown> = {};
  try {
    args = argsJson ? (JSON.parse(argsJson) as Record<string, unknown>) : {};
  } catch {
    console.warn(`${MCP_DEBUG_PREFIX} execute_tool invalid arguments JSON`, {
      name,
      threadId,
      argsJson,
    });
    return JSON.stringify({ error: "invalid arguments JSON" });
  }
  console.info(`${MCP_DEBUG_PREFIX} execute_tool`, {
    name,
    threadId,
    args,
  });
  return executeMetaTool(name, args, state, threadId);
}

// ----- Build tools for thread -----

export type BuildToolsAndPromptResult = {
  systemPromptText?: string;
  tools: OpenAIFormatTool[];
};

export async function buildToolsAndPromptForThread(
  _state: ModelState,
  threadId: string
): Promise<BuildToolsAndPromptResult> {
  const systemPromptText = systemPromptTextRaw.trim();

  return {
    systemPromptText,
    tools: [...metaToolSchemas, ...getLoadedToolSchemas(threadId)],
  };
}
