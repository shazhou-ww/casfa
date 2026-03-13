/**
 * MCP meta-tools for the Service Worker: list_mcp_servers, get_mcp_tools, get_tool_usage, run_mcp_tool.
 * Progressive discovery (Level 0: servers, Level 1: tools per server, Level 2: usage per tool) + single run entry.
 * Replaces scenario-based list_mcp_scenarios / load_scenario / unload_scenario and serverId__toolName.
 */

import { getPrompt, listPrompts, listTools, mcpCall } from "../lib/mcp-client.ts";
import { MCP_SERVERS_SETTINGS_KEY, parseMcpServers } from "../lib/mcp-types.ts";
import type { MCPServerConfig } from "../lib/mcp-types.ts";
import type { ModelState } from "../lib/model-types.ts";

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
  tools: Array<{ name: string; description?: string; inputSchema?: unknown }>;
  prompts?: Array<{ name: string; description?: string }>;
};

export type GetToolUsageResult = {
  serverId: string;
  toolName: string;
  description?: string;
  inputSchema?: unknown;
  promptText?: string;
};

/** OpenAI-format tool for request body (type + function with name, description, parameters). */
export type OpenAIFormatTool = {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
};

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
      inputSchema: t.inputSchema,
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

// ----- Level 2: get_tool_usage -----

export async function getToolUsage(
  state: ModelState,
  serverId: string,
  toolName: string
): Promise<GetToolUsageResult | { error: string }> {
  const configs = parseMcpServers(state.settings[MCP_SERVERS_SETTINGS_KEY]);
  const config = configs.find((c) => c.id === serverId);
  if (!config) {
    console.warn(`${MCP_DEBUG_PREFIX} get_tool_usage server not found`, {
      serverId,
      toolName,
      configs: summarizeConfigs(configs),
    });
    return { error: "server not found: use exact serverId from list_mcp_servers" };
  }
  if (!config.url) return { error: "server has no url (http transport required)" };

  try {
    console.info(`${MCP_DEBUG_PREFIX} get_tool_usage request`, {
      serverId,
      serverName: config.name,
      toolName,
      url: config.url,
    });
    const toolsResult = await listTools(config);
    const tool = (toolsResult.tools ?? []).find((t) => t.name === toolName);
    if (!tool) return { error: "tool not found" };

    let promptText: string | undefined;
    const promptsResult = await listPrompts(config).catch(() => ({ prompts: [] }));
    const prompt = (promptsResult.prompts ?? []).find((p) => p.name === toolName || p.name === toolName.replace(/_/g, "-"));
    if (prompt) {
      const getResult = await getPrompt(config, prompt.name).catch(() => ({ messages: [] }));
      const parts: string[] = [];
      for (const msg of getResult.messages ?? []) {
        if (msg.content && typeof msg.content === "object" && "type" in msg.content && (msg.content as { type: string }).type === "text" && "text" in msg.content) {
          parts.push((msg.content as { text: string }).text);
        }
      }
      promptText = parts.length > 0 ? parts.join("\n\n") : undefined;
    }

    const usage = {
      serverId,
      toolName,
      description: tool.description,
      inputSchema: tool.inputSchema,
      promptText,
    };
    console.info(`${MCP_DEBUG_PREFIX} get_tool_usage response`, {
      serverId,
      toolName,
      hasPromptText: Boolean(promptText),
    });
    return usage;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${MCP_DEBUG_PREFIX} get_tool_usage error`, { serverId, toolName, message });
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
    description: "List tools (and optional prompts) for a specific MCP server (Level 1 discovery). Prefer exact serverId from list_mcp_servers.",
    parameters: {
      type: "object" as const,
      properties: {
        serverId: { type: "string" as const, description: "MCP server id from list_mcp_servers" },
      },
      required: ["serverId"] as string[],
    },
  },
};

const GET_TOOL_USAGE_SCHEMA: OpenAIFormatTool = {
  type: "function",
  function: {
    name: "get_tool_usage",
    description: "Get usage details (description, inputSchema, optional prompt text) for a specific tool on a server (Level 2 discovery). Use exact toolName from get_mcp_tools.",
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

const RUN_MCP_TOOL_SCHEMA: OpenAIFormatTool = {
  type: "function",
  function: {
    name: "run_mcp_tool",
    description: "Execute a tool on an MCP server. Use list_mcp_servers and get_mcp_tools (or get_tool_usage) to discover exact serverId and toolName before calling.",
    parameters: {
      type: "object" as const,
      properties: {
        serverId: { type: "string" as const, description: "MCP server id" },
        toolName: { type: "string" as const, description: "Tool name" },
        arguments: { type: "object" as const, description: "Tool arguments (JSON object)" },
      },
      required: ["serverId", "toolName"] as string[],
    },
  },
};

export const metaToolSchemas: OpenAIFormatTool[] = [
  LIST_MCP_SERVERS_SCHEMA,
  GET_MCP_TOOLS_SCHEMA,
  GET_TOOL_USAGE_SCHEMA,
  RUN_MCP_TOOL_SCHEMA,
];

// ----- Execute meta tool -----

const META_TOOL_NAMES = ["list_mcp_servers", "get_mcp_tools", "get_tool_usage", "run_mcp_tool"] as const;

export async function executeMetaTool(
  name: string,
  args: Record<string, unknown>,
  state: ModelState
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
    case "get_tool_usage": {
      const serverId = typeof args.serverId === "string" ? args.serverId : "";
      const toolName = typeof args.toolName === "string" ? args.toolName : "";
      const result = await getToolUsage(state, serverId, toolName);
      return JSON.stringify(result);
    }
    case "run_mcp_tool": {
      const serverId = typeof args.serverId === "string" ? args.serverId : "";
      const toolName = typeof args.toolName === "string" ? args.toolName : "";
      const toolArgs = args.arguments != null && typeof args.arguments === "object" && !Array.isArray(args.arguments) ? (args.arguments as Record<string, unknown>) : undefined;
      const result = await runMcpTool(state, serverId, toolName, toolArgs);
      return result;
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
  _threadId: string
): Promise<string> {
  if (!META_TOOL_NAMES.includes(name as (typeof META_TOOL_NAMES)[number])) {
    console.warn(`${MCP_DEBUG_PREFIX} execute_tool unknown tool`, { name, threadId: _threadId });
    return JSON.stringify({ error: `unknown tool: ${name}` });
  }
  let args: Record<string, unknown> = {};
  try {
    args = argsJson ? (JSON.parse(argsJson) as Record<string, unknown>) : {};
  } catch {
    console.warn(`${MCP_DEBUG_PREFIX} execute_tool invalid arguments JSON`, {
      name,
      threadId: _threadId,
      argsJson,
    });
    return JSON.stringify({ error: "invalid arguments JSON" });
  }
  console.info(`${MCP_DEBUG_PREFIX} execute_tool`, {
    name,
    threadId: _threadId,
    args,
  });
  return executeMetaTool(name, args, state);
}

// ----- Build tools for thread (only the four meta tools) -----

export type BuildToolsAndPromptResult = {
  systemPromptText?: string;
  tools: OpenAIFormatTool[];
};

export async function buildToolsAndPromptForThread(
  _state: ModelState,
  _threadId: string
): Promise<BuildToolsAndPromptResult> {
  const systemPromptText = [
    "You can use MCP meta tools: list_mcp_servers, get_mcp_tools, get_tool_usage, run_mcp_tool.",
    "Think step-by-step internally before each action, but do not expose your hidden reasoning process.",
    "For each user request, first make a short internal plan, then execute tools, then verify, then answer.",
    "When the user asks to inspect files, run commands, or change state (e.g. delete/write/move), you MUST execute real tool calls before making claims.",
    "Never claim an operation succeeded unless a tool result in this turn confirms it.",
    "If a mutation tool returns ambiguous output (for example {}), verify by follow-up read/list tool calls before claiming success.",
    "Use exact serverId from list_mcp_servers and exact toolName from get_mcp_tools.",
    "If server/tool is invalid, report the error and retry with exact ids from tool outputs.",
    "Keep responses concise and evidence-based.",
  ].join(" ");

  return {
    systemPromptText,
    tools: [...metaToolSchemas],
  };
}
