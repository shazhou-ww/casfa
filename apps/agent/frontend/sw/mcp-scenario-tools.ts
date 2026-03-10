/**
 * MCP scenario meta-tools for the Service Worker: list_mcp_scenarios, load_scenario, unload_scenario.
 * Aggregates prompts from each MCP server and marks which scenarios are loaded per thread.
 */

import { applyAutoUnload, getLastUsedByScenario, MAX_LOADED_SCENARIOS } from "../lib/derive-loaded-scenarios-lru.ts";
import { deriveLoadedScenarios } from "../lib/derive-loaded-scenarios.ts";
import { getPrompt, listPrompts, listTools } from "../lib/mcp-client.ts";
import type { GetPromptResult } from "../lib/mcp-client.ts";
import { MCP_SERVERS_SETTINGS_KEY, parseMcpServers } from "../lib/mcp-types.ts";
import type { MCPServerConfig, MCPTool } from "../lib/mcp-types.ts";
import type { ModelState } from "../lib/model-types.ts";

export type McpScenarioItem = {
  serverId: string;
  scenarioId: string;
  title?: string;
  description?: string;
  loaded: boolean;
};

export type ListMcpScenariosResult = { scenarios: McpScenarioItem[] };

/**
 * List all MCP scenarios from prompts/list for each configured server, and mark loaded state
 * from thread message history (deriveLoadedScenarios). Only servers with url (http transport) are queried.
 * Per-server listPrompts errors are caught so one failing server does not break the whole list.
 */
export async function listMcpScenarios(
  state: ModelState,
  threadId: string
): Promise<ListMcpScenariosResult> {
  const mcpServers = parseMcpServers(state.settings[MCP_SERVERS_SETTINGS_KEY]);
  const messages = state.messagesByThread[threadId] ?? [];
  const loaded = deriveLoadedScenarios(threadId, messages, mcpServers);

  const scenarios: McpScenarioItem[] = [];

  for (const config of mcpServers) {
    if (!config.url) continue;
    try {
      const result = await listPrompts(config);
      for (const p of result.prompts ?? []) {
        const scenarioKey = `${config.id}#${p.name}`;
        scenarios.push({
          serverId: config.id,
          scenarioId: p.name,
          title: p.title,
          description: p.description,
          loaded: loaded.has(scenarioKey),
        });
      }
    } catch (_err) {
      // Skip this server so one failing server does not break the whole list
    }
  }

  return { scenarios };
}

/**
 * Get the effective loaded scenarios for this round after LRU auto-unload.
 * If loaded count > MAX_LOADED_SCENARIOS, evicts by last-used (no unload tool-calls written).
 * Task 7 will call this before buildToolsForThread and use "kept" as the loaded set.
 */
export async function getLoadedScenariosAfterLru(
  state: ModelState,
  threadId: string,
  scenarioToToolNames?: Map<string, Set<string>>
): Promise<{ kept: Set<string>; evicted: Set<string> }> {
  const mcpServers = parseMcpServers(state.settings[MCP_SERVERS_SETTINGS_KEY]);
  const messages = state.messagesByThread[threadId] ?? [];
  const loaded = deriveLoadedScenarios(threadId, messages, mcpServers);
  const lastUsed = getLastUsedByScenario(messages, loaded, scenarioToToolNames);
  return applyAutoUnload(loaded, lastUsed, MAX_LOADED_SCENARIOS);
}

/** OpenAI-format tool for request body (type + function with name, description, parameters). */
export type OpenAIFormatTool = {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
};

/**
 * Build OpenAI-format tools for one scenario: filter by allowedTools when present, else full list.
 * Tool name in API is serverId__tool.name.
 */
export function getScenarioTools(
  serverId: string,
  toolsList: MCPTool[],
  promptMetadata?: { allowedTools?: string[] }
): OpenAIFormatTool[] {
  const allowed = promptMetadata?.allowedTools;
  const list = allowed && allowed.length > 0 ? toolsList.filter((t) => allowed.includes(t.name)) : toolsList;
  return list.map((t) => ({
    type: "function" as const,
    function: {
      name: `${serverId}__${t.name}`,
      description: t.description ?? "",
      parameters: t.inputSchema ?? { type: "object" as const, properties: {} as Record<string, unknown> },
    },
  }));
}

/** Extract concatenated text from getPrompt result messages (content.type === "text"). */
function extractPromptTextFromMessages(messages: GetPromptResult["messages"]): string {
  const parts: string[] = [];
  for (const msg of messages) {
    if (msg.content && typeof msg.content === "object" && "type" in msg.content && msg.content.type === "text" && "text" in msg.content) {
      parts.push((msg.content as { text: string }).text);
    }
  }
  return parts.join("\n\n");
}

/**
 * Fetch prompt content for a scenario (prompts/get) and return concatenated text from messages.
 */
export async function getScenarioPromptContent(config: MCPServerConfig, scenarioId: string): Promise<string> {
  const result = await getPrompt(config, scenarioId);
  return extractPromptTextFromMessages(result.messages);
}

export type BuildToolsAndPromptResult = {
  systemPromptText?: string;
  tools: OpenAIFormatTool[];
  scenarioToToolNames: Map<string, Set<string>>;
};

/**
 * Build tools array and optional system prompt for the current thread from loaded scenarios.
 * Uses getLoadedScenariosAfterLru (no scenarioToToolNames on first pass); for each kept scenario
 * fetches listTools + getPrompt, builds scenarioToToolNames, collects scenario tools and prompt text.
 * Returns systemPromptText (concatenated scenario prompts), tools (meta + scenario, deduped by name), scenarioToToolNames.
 */
export async function buildToolsAndPromptForThread(
  state: ModelState,
  threadId: string
): Promise<BuildToolsAndPromptResult> {
  const mcpServers = parseMcpServers(state.settings[MCP_SERVERS_SETTINGS_KEY]);
  const { kept } = await getLoadedScenariosAfterLru(state, threadId);

  const scenarioToToolNames = new Map<string, Set<string>>();
  const toolsByName = new Map<string, OpenAIFormatTool>();
  const systemPromptParts: string[] = [];

  for (const metaTool of metaToolSchemas) {
    toolsByName.set(metaTool.function.name, metaTool);
  }

  for (const scenarioKey of kept) {
    const idx = scenarioKey.indexOf("#");
    const serverId = idx >= 0 ? scenarioKey.slice(0, idx) : scenarioKey;
    const scenarioId = idx >= 0 ? scenarioKey.slice(idx + 1) : "";
    const config = mcpServers.find((s) => s.id === serverId);
    if (!config?.url) continue;

    let toolsList: MCPTool[] = [];
    let promptMessages: GetPromptResult["messages"] = [];
    let allowedTools: string[] | undefined;
    try {
      const [toolsResult, promptResult] = await Promise.all([listTools(config), getPrompt(config, scenarioId)]);
      toolsList = toolsResult.tools;
      promptMessages = promptResult.messages;
      allowedTools = promptResult.allowedTools;
    } catch {
      continue;
    }

    const scenarioTools = getScenarioTools(serverId, toolsList, { allowedTools });
    const names = new Set<string>();
    for (const t of scenarioTools) {
      names.add(t.function.name);
      if (!toolsByName.has(t.function.name)) toolsByName.set(t.function.name, t);
    }
    scenarioToToolNames.set(scenarioKey, names);

    const text = extractPromptTextFromMessages(promptMessages);
    if (text.trim()) systemPromptParts.push(text);
  }

  const tools = Array.from(toolsByName.values());
  const systemPromptText = systemPromptParts.length > 0 ? systemPromptParts.join("\n\n") : undefined;
  return { systemPromptText, tools, scenarioToToolNames };
}

/** OpenAI-format tool schema for list_mcp_scenarios (no parameters). */
export const LIST_MCP_SCENARIOS_TOOL_SCHEMA = {
  type: "function" as const,
  function: {
    name: "list_mcp_scenarios",
    description:
      "List all available MCP scenarios (prompts) from configured servers, with loaded state for the current thread.",
    parameters: { type: "object" as const, properties: {} as Record<string, never>, required: [] as string[] },
  },
};

/** Re-export for callers that need the cap (e.g. executeLoadScenario, buildToolsForThread). */
export { MAX_LOADED_SCENARIOS };

/** OpenAI-format tool schema for load_scenario (parameters: serverId, scenarioId). */
export const LOAD_SCENARIO_TOOL_SCHEMA = {
  type: "function" as const,
  function: {
    name: "load_scenario",
    description: "Load an MCP scenario (prompt) for the current thread. Its tools and prompt will be available in the next round.",
    parameters: {
      type: "object" as const,
      properties: {
        serverId: { type: "string" as const, description: "MCP server id" },
        scenarioId: { type: "string" as const, description: "Scenario (prompt) name" },
      },
      required: ["serverId", "scenarioId"] as string[],
    },
  },
};

/** OpenAI-format tool schema for unload_scenario (parameters: serverId, scenarioId). */
export const UNLOAD_SCENARIO_TOOL_SCHEMA = {
  type: "function" as const,
  function: {
    name: "unload_scenario",
    description: "Unload an MCP scenario from the current thread.",
    parameters: {
      type: "object" as const,
      properties: {
        serverId: { type: "string" as const, description: "MCP server id" },
        scenarioId: { type: "string" as const, description: "Scenario (prompt) name" },
      },
      required: ["serverId", "scenarioId"] as string[],
    },
  },
};

/** Meta-tool schemas to be merged with scenario tools when building the LLM tools array (Task 8). */
export const metaToolSchemas = [
  LIST_MCP_SCENARIOS_TOOL_SCHEMA,
  LOAD_SCENARIO_TOOL_SCHEMA,
  UNLOAD_SCENARIO_TOOL_SCHEMA,
];

/**
 * Execute list_mcp_scenarios and return the result as a JSON string for LLM tool result.
 */
export async function executeListMcpScenarios(
  state: ModelState,
  threadId: string
): Promise<string> {
  const result = await listMcpScenarios(state, threadId);
  return JSON.stringify(result);
}

/**
 * Execute load_scenario: validate server and scenario exist; if at cap and scenario not already loaded, return error.
 * Returns JSON string: { ok: true, serverId, scenarioId } or { error: string }.
 * Caller (Task 8) will append tool-call + tool-result to assistant message so deriveLoadedScenarios sees the new state.
 */
export async function executeLoadScenario(
  state: ModelState,
  threadId: string,
  serverId: string,
  scenarioId: string
): Promise<string> {
  const mcpServers = parseMcpServers(state.settings[MCP_SERVERS_SETTINGS_KEY]);
  const server = mcpServers.find((s) => s.id === serverId);
  if (!server) {
    return JSON.stringify({ error: "server not found" });
  }
  if (!server.url) {
    return JSON.stringify({ error: "server has no url (http transport required)" });
  }
  let prompts: { name: string }[];
  try {
    const result = await listPrompts(server);
    prompts = result.prompts ?? [];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return JSON.stringify({ error: `failed to list prompts: ${msg}` });
  }
  const scenarioExists = prompts.some((p) => p.name === scenarioId);
  if (!scenarioExists) {
    return JSON.stringify({ error: "scenario not found" });
  }
  const messages = state.messagesByThread[threadId] ?? [];
  const loaded = deriveLoadedScenarios(threadId, messages, mcpServers);
  const scenarioKey = `${serverId}#${scenarioId}`;
  if (!loaded.has(scenarioKey) && loaded.size >= MAX_LOADED_SCENARIOS) {
    return JSON.stringify({ error: "max scenarios loaded" });
  }
  return JSON.stringify({ ok: true, serverId, scenarioId });
}

/**
 * Execute unload_scenario: validate server and scenario exist; return success or error JSON.
 * Caller (Task 8) will append tool-call + tool-result to assistant message.
 */
export async function executeUnloadScenario(
  state: ModelState,
  _threadId: string,
  serverId: string,
  scenarioId: string
): Promise<string> {
  const mcpServers = parseMcpServers(state.settings[MCP_SERVERS_SETTINGS_KEY]);
  const server = mcpServers.find((s) => s.id === serverId);
  if (!server) {
    return JSON.stringify({ error: "server not found" });
  }
  if (!server.url) {
    return JSON.stringify({ error: "server has no url (http transport required)" });
  }
  try {
    const result = await listPrompts(server);
    const prompts = result.prompts ?? [];
    const scenarioExists = prompts.some((p) => p.name === scenarioId);
    if (!scenarioExists) {
      return JSON.stringify({ error: "scenario not found" });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return JSON.stringify({ error: `failed to list prompts: ${msg}` });
  }
  return JSON.stringify({ ok: true });
}

/**
 * Execute a meta-tool by name and return the result as a JSON string.
 * Used by the tool execution router (Task 8 will call this and then append tool-call + tool-result to the assistant message).
 */
export async function executeMetaTool(
  name: string,
  args: Record<string, unknown>,
  state: ModelState,
  threadId: string
): Promise<string> {
  switch (name) {
    case "list_mcp_scenarios":
      return executeListMcpScenarios(state, threadId);
    case "load_scenario": {
      const serverId = typeof args.serverId === "string" ? args.serverId : "";
      const scenarioId = typeof args.scenarioId === "string" ? args.scenarioId : "";
      return executeLoadScenario(state, threadId, serverId, scenarioId);
    }
    case "unload_scenario": {
      const serverId = typeof args.serverId === "string" ? args.serverId : "";
      const scenarioId = typeof args.scenarioId === "string" ? args.scenarioId : "";
      return executeUnloadScenario(state, threadId, serverId, scenarioId);
    }
    default:
      return JSON.stringify({ error: `unknown meta-tool: ${name}` });
  }
}
