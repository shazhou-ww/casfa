/**
 * Derive loaded scenario keys from thread message history.
 * Only considers load_scenario / unload_scenario tool-calls; scenarioKey format: serverId#scenarioId.
 */
import type { Message } from "./model-types.ts";
import type { MCPServerConfig } from "./mcp-types.ts";

export function deriveLoadedScenarios(
  _threadId: string,
  messages: Message[],
  mcpServers: MCPServerConfig[]
): Set<string> {
  const loaded = new Set<string>();
  const sorted = [...messages].sort((a, b) => a.createdAt - b.createdAt);

  for (const msg of sorted) {
    for (const block of msg.content) {
      if (block.type !== "tool-call") continue;
      if (block.name === "load_scenario") {
        try {
          const args = JSON.parse(block.arguments) as { serverId?: string; scenarioId?: string };
          const serverId = args?.serverId;
          const scenarioId = args?.scenarioId;
          if (
            typeof serverId === "string" &&
            typeof scenarioId === "string" &&
            mcpServers.some((s) => s.id === serverId)
          ) {
            loaded.add(`${serverId}#${scenarioId}`);
          }
        } catch {
          // ignore invalid JSON
        }
        continue;
      }
      if (block.name === "unload_scenario") {
        try {
          const args = JSON.parse(block.arguments) as { serverId?: string; scenarioId?: string };
          const serverId = args?.serverId;
          const scenarioId = args?.scenarioId;
          if (typeof serverId === "string" && typeof scenarioId === "string") {
            loaded.delete(`${serverId}#${scenarioId}`);
          }
        } catch {
          // ignore invalid JSON
        }
      }
    }
  }

  return loaded;
}
