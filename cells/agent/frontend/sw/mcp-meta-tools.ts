/**
 * MCP meta-tools for the Service Worker.
 * Gateway is the only MCP entry for server/tool management.
 */

import { mcpCall } from "../lib/mcp-client.ts";
import type { MCPServerConfig } from "../lib/mcp-types.ts";
import type { ModelState } from "../lib/model-types.ts";
import { parseSystemPromptLanguage, SYSTEM_PROMPT_LANGUAGE_KEY } from "../lib/prompt-settings.ts";
import systemPromptTextRaw from "./system-prompt.md?raw";
import systemPromptZhRaw from "./system-prompt.zh-CN.md?raw";

const MCP_DEBUG_PREFIX = "[agent-mcp-debug]";
const BUILTIN_GATEWAY_SERVER_ID = "gateway";
const GATEWAY_META_TOOL_NAMES = ["list_servers", "search_servers", "get_tools", "load_tools"] as const;

type GatewayMetaToolName = (typeof GATEWAY_META_TOOL_NAMES)[number];

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
    const entry = entries[i];
    if (!entry) continue;
    map.delete(entry.loadedToolName);
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

function lookupLoadedToolByFunctionName(threadId: string, loadedToolName: string): LoadedToolEntry | null {
  return loadedToolsByThread.get(threadId)?.get(loadedToolName) ?? null;
}

function getGatewayUrlFromScope(): string {
  const sw = (globalThis as { self?: { registration?: { scope?: string } } }).self;
  const scope = sw?.registration?.scope ?? "";
  if (!scope) return "";
  const u = new URL(scope);
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts.length === 0) {
    return `${u.origin}/gateway/mcp`;
  }
  parts[parts.length - 1] = "gateway";
  return `${u.origin}/${parts.join("/")}/mcp`;
}

function getGatewayConfig(): MCPServerConfig | null {
  const url = getGatewayUrlFromScope();
  if (!url) return null;
  return {
    id: BUILTIN_GATEWAY_SERVER_ID,
    name: "Gateway",
    // stdio avoids token-store reads; auth is handled by gateway cookie session.
    transport: "stdio",
    sendCookies: true,
    auth: "none",
    url,
  };
}

type ToolCallResultPayload = {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
};

async function callGatewayMetaTool(
  name: GatewayMetaToolName,
  args: Record<string, unknown>
): Promise<string> {
  const gateway = getGatewayConfig();
  if (!gateway) return JSON.stringify({ error: "gateway MCP URL not available in service worker scope" });
  try {
    const result = await mcpCall<ToolCallResultPayload>(gateway, "tools/call", {
      name,
      arguments: args,
    });
    const text = result.content?.map((c) => (c.type === "text" && c.text ? c.text : "")).join("") ?? "";
    return text || JSON.stringify(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: message });
  }
}

function hydrateLoadedToolSchemasFromLoadResult(
  threadId: string,
  loadedItems: Array<{
    serverId: string;
    toolName: string;
    loadedToolName: string;
    description?: string;
    inputSchema?: unknown;
  }>
): void {
  const threadMap = getThreadLoadedMap(threadId);
  const now = Date.now();
  for (const item of loadedItems) {
    const schema: OpenAIFormatTool = {
      type: "function",
      function: {
        name: item.loadedToolName,
        description: item.description ?? `Run MCP tool ${item.toolName} on server ${item.serverId}.`,
        parameters: normalizeSchemaParameters(item.inputSchema),
      },
    };
    threadMap.set(item.loadedToolName, {
      serverId: item.serverId,
      toolName: item.toolName,
      loadedToolName: item.loadedToolName,
      schema,
      loadedAt: now,
      lastUsedAt: now,
    });
  }
  pruneThreadLoadedTools(threadId);
}

const LIST_SERVERS_SCHEMA: OpenAIFormatTool = {
  type: "function",
  function: {
    name: "list_servers",
    description: "List MCP servers registered in gateway for current user.",
    parameters: { type: "object" as const, properties: {} as Record<string, never>, required: [] as string[] },
  },
};

const SEARCH_SERVERS_SCHEMA: OpenAIFormatTool = {
  type: "function",
  function: {
    name: "search_servers",
    description: "Search gateway MCP servers by id, name, or url.",
    parameters: {
      type: "object" as const,
      properties: {
        query: { type: "string" as const },
      },
      required: [] as string[],
    },
  },
};

const GET_TOOLS_SCHEMA: OpenAIFormatTool = {
  type: "function",
  function: {
    name: "get_tools",
    description: "List tools for one or more gateway-managed MCP servers.",
    parameters: {
      type: "object" as const,
      properties: {
        serverIds: {
          type: "array" as const,
          items: { type: "string" as const },
        },
      },
      required: ["serverIds"] as string[],
    },
  },
};

const LOAD_TOOLS_SCHEMA: OpenAIFormatTool = {
  type: "function",
  function: {
    name: "load_tools",
    description: "Load tool schemas into current thread from gateway-managed servers.",
    parameters: {
      type: "object" as const,
      properties: {
        tools: {
          type: "array" as const,
          items: {
            type: "object" as const,
            properties: {
              serverId: { type: "string" as const },
              toolName: { type: "string" as const },
            },
            required: ["serverId", "toolName"] as string[],
          },
        },
      },
      required: ["tools"] as string[],
    },
  },
};

export const metaToolSchemas: OpenAIFormatTool[] = [
  LIST_SERVERS_SCHEMA,
  SEARCH_SERVERS_SCHEMA,
  GET_TOOLS_SCHEMA,
  LOAD_TOOLS_SCHEMA,
];

const META_TOOL_NAMES = [...GATEWAY_META_TOOL_NAMES] as const;

async function executeMetaTool(
  name: string,
  args: Record<string, unknown>,
  threadId: string
): Promise<string> {
  if (name === "list_servers") return callGatewayMetaTool("list_servers", {});
  if (name === "search_servers") {
    const query = typeof args.query === "string" ? args.query : "";
    return callGatewayMetaTool("search_servers", query ? { query } : {});
  }
  if (name === "get_tools") {
    const serverIds = Array.isArray(args.serverIds) ? args.serverIds.filter((id): id is string => typeof id === "string") : [];
    return callGatewayMetaTool("get_tools", { serverIds });
  }
  if (name === "load_tools") {
    const tools = Array.isArray(args.tools)
      ? args.tools
          .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
          .map((item) => ({
            serverId: typeof item.serverId === "string" ? item.serverId.trim() : "",
            toolName: typeof item.toolName === "string" ? item.toolName.trim() : "",
          }))
          .filter((item) => item.serverId && item.toolName)
      : [];
    const raw = await callGatewayMetaTool("load_tools", { tools });
    try {
      const parsed = JSON.parse(raw) as {
        results?: Array<{
          serverId?: string;
          toolName?: string;
          loadedToolName?: string;
          result?: string;
          description?: string;
          inputSchema?: unknown;
        }>;
      };
      const loaded = (parsed.results ?? [])
        .filter((item) => item.result !== "error")
        .filter(
          (
            item
          ): item is {
            serverId: string;
            toolName: string;
            loadedToolName: string;
            description?: string;
            inputSchema?: unknown;
          } =>
            typeof item.serverId === "string" &&
            typeof item.toolName === "string" &&
            typeof item.loadedToolName === "string" &&
            item.serverId.trim() !== "" &&
            item.toolName.trim() !== "" &&
            item.loadedToolName.trim() !== ""
        )
        .map((item) => ({
          serverId: item.serverId.trim(),
          toolName: item.toolName.trim(),
          loadedToolName: item.loadedToolName.trim(),
          description: typeof item.description === "string" ? item.description : undefined,
          inputSchema: item.inputSchema,
        }));
      if (loaded.length > 0) {
        hydrateLoadedToolSchemasFromLoadResult(threadId, loaded);
        const threadMap = getThreadLoadedMap(threadId);
        for (const item of loaded) {
          const entry = threadMap.get(item.loadedToolName);
          const params = entry?.schema.function.parameters as
            | { properties?: Record<string, unknown>; required?: unknown[] }
            | undefined;
          const propertyKeys = Object.keys(params?.properties ?? {});
          const required = Array.isArray(params?.required) ? params.required : [];
          console.info(`${MCP_DEBUG_PREFIX} load_tools schema`, {
            threadId,
            serverId: item.serverId,
            toolName: item.toolName,
            loadedToolName: item.loadedToolName,
            properties: propertyKeys,
            required,
          });
        }
      }
    } catch (error) {
      console.warn(`${MCP_DEBUG_PREFIX} load_tools parse failed`, {
        threadId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return raw;
  }
  return JSON.stringify({ error: `unknown meta-tool: ${name}` });
}

async function runLoadedToolViaGateway(
  loaded: LoadedToolEntry,
  args: Record<string, unknown>
): Promise<string> {
  const gateway = getGatewayConfig();
  if (!gateway) return JSON.stringify({ error: "gateway MCP URL not available in service worker scope" });
  try {
    const result = await mcpCall<ToolCallResultPayload>(gateway, "tools/call", {
      name: "call_tool",
      arguments: {
        serverId: loaded.serverId,
        toolName: loaded.toolName,
        args,
      },
    });
    const text = result.content?.map((c) => (c.type === "text" && c.text ? c.text : "")).join("") ?? "";
    return text || JSON.stringify(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: message });
  }
}

export async function executeTool(
  name: string,
  argsJson: string,
  _state: ModelState,
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
    return runLoadedToolViaGateway(loaded, loadedArgs);
  }

  let args: Record<string, unknown> = {};
  try {
    args = argsJson ? (JSON.parse(argsJson) as Record<string, unknown>) : {};
  } catch {
    return JSON.stringify({ error: "invalid arguments JSON" });
  }
  return executeMetaTool(name, args, threadId);
}

export type BuildToolsAndPromptResult = {
  systemPromptText?: string;
  tools: OpenAIFormatTool[];
};

export async function buildToolsAndPromptForThread(
  state: ModelState,
  threadId: string
): Promise<BuildToolsAndPromptResult> {
  const promptLanguage = parseSystemPromptLanguage(state.settings[SYSTEM_PROMPT_LANGUAGE_KEY]);
  const systemPromptText = (promptLanguage === "zh-CN" ? systemPromptZhRaw : systemPromptTextRaw).trim();
  return {
    systemPromptText,
    tools: [...metaToolSchemas, ...getLoadedToolSchemas(threadId)],
  };
}
