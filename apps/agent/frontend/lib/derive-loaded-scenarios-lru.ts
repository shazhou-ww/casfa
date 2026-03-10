/**
 * LRU derivation and auto-unload for loaded scenarios.
 * Used before building tools each round: if loaded count > cap, evict by last-used (message createdAt of last tool use).
 */
import type { Message } from "./model-types.ts";

/** Max number of loaded scenarios per thread; when exceeded, LRU eviction is applied for the current round. */
export const MAX_LOADED_SCENARIOS = 10;

/** Tool name pattern for scenario tools: serverId__toolName. Meta-tools (load_scenario, unload_scenario, list_mcp_scenarios) are not. */
function isScenarioToolName(name: string): boolean {
  return name.includes("__") && name !== "load_scenario" && name !== "unload_scenario" && name !== "list_mcp_scenarios";
}

/**
 * Build a map of scenarioKey -> last used timestamp from message history.
 * For each message (by createdAt), for each tool-call with name like serverId__toolName,
 * for each loadedScenarioKeys entry that owns that tool (via scenarioToToolNames), set lastUsed[key] = message.createdAt.
 * If scenarioToToolNames is missing or empty, no updates are made (all lastUsed remain 0 for eviction order).
 */
export function getLastUsedByScenario(
  messages: Message[],
  loadedScenarioKeys: Set<string>,
  scenarioToToolNames?: Map<string, Set<string>>
): Map<string, number> {
  const lastUsed = new Map<string, number>();
  const sorted = [...messages].sort((a, b) => a.createdAt - b.createdAt);

  for (const msg of sorted) {
    for (const block of msg.content) {
      if (block.type !== "tool-call") continue;
      const name = block.name;
      if (!isScenarioToolName(name)) continue;

      if (!scenarioToToolNames || scenarioToToolNames.size === 0) {
        // No mapping: do not update any key (all remain 0 for deterministic eviction)
        continue;
      }

      for (const scenarioKey of loadedScenarioKeys) {
        if (scenarioToToolNames.get(scenarioKey)?.has(name)) {
          lastUsed.set(scenarioKey, msg.createdAt);
        }
      }
    }
  }

  return lastUsed;
}

export type ApplyAutoUnloadResult = { kept: Set<string>; evicted: Set<string> };

/**
 * If loaded.size > max, evict (loaded.size - max) scenarios by LRU order (lastUsed ascending; missing or 0 first).
 * Evicted scenarios are not written as unload tool-calls; caller uses "kept" as the effective loaded set for this round.
 */
export function applyAutoUnload(
  loaded: Set<string>,
  lastUsed: Map<string, number>,
  max: number
): ApplyAutoUnloadResult {
  if (loaded.size <= max) {
    return { kept: new Set(loaded), evicted: new Set() };
  }

  const byKey = [...loaded];
  byKey.sort((a, b) => {
    const ta = lastUsed.get(a) ?? 0;
    const tb = lastUsed.get(b) ?? 0;
    if (ta !== tb) return ta - tb;
    return a.localeCompare(b);
  });

  const toEvict = loaded.size - max;
  const evicted = new Set(byKey.slice(0, toEvict));
  const kept = new Set(byKey.slice(toEvict));
  return { kept, evicted };
}
