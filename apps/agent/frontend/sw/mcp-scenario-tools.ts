/**
 * MCP scenario meta-tools for the Service Worker: list_mcp_scenarios (and later load_scenario / unload_scenario).
 * Aggregates prompts from each MCP server and marks which scenarios are loaded per thread.
 */

import { deriveLoadedScenarios } from "../lib/derive-loaded-scenarios.ts";
import { listPrompts } from "../lib/mcp-client.ts";
import { MCP_SERVERS_SETTINGS_KEY, parseMcpServers } from "../lib/mcp-types.ts";
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

/** Meta-tool schemas to be merged with scenario tools when building the LLM tools array (Task 8). */
export const metaToolSchemas = [LIST_MCP_SCENARIOS_TOOL_SCHEMA];

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
