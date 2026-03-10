/**
 * Tests for derive-loaded-scenarios-lru: getLastUsedByScenario and applyAutoUnload.
 */
import { describe, expect, it } from "bun:test";
import {
  applyAutoUnload,
  getLastUsedByScenario,
  MAX_LOADED_SCENARIOS,
} from "./derive-loaded-scenarios-lru.ts";
import type { Message } from "./model-types.ts";

describe("getLastUsedByScenario", () => {
  it("returns empty map when messages is empty", () => {
    const loaded = new Set<string>(["s1#sc1"]);
    const result = getLastUsedByScenario([], loaded);
    expect(result.size).toBe(0);
  });

  it("returns empty map when no scenarioToToolNames (no updates)", () => {
    const messages: Message[] = [
      {
        messageId: "m1",
        threadId: "t1",
        role: "assistant",
        content: [
          {
            type: "tool-call",
            callId: "c1",
            name: "s1__foo",
            arguments: "{}",
          },
        ],
        createdAt: 1000,
      },
    ];
    const loaded = new Set<string>(["s1#sc1"]);
    const result = getLastUsedByScenario(messages, loaded);
    expect(result.size).toBe(0);
  });

  it("sets lastUsed for scenario when tool name is in scenarioToToolNames", () => {
    const messages: Message[] = [
      {
        messageId: "m1",
        threadId: "t1",
        role: "assistant",
        content: [
          { type: "tool-call", callId: "c1", name: "s1__foo", arguments: "{}" },
        ],
        createdAt: 1000,
      },
      {
        messageId: "m2",
        threadId: "t1",
        role: "assistant",
        content: [
          { type: "tool-call", callId: "c2", name: "s1__bar", arguments: "{}" },
        ],
        createdAt: 2000,
      },
    ];
    const loaded = new Set<string>(["s1#sc1"]);
    const scenarioToToolNames = new Map<string, Set<string>>([
      ["s1#sc1", new Set(["s1__foo", "s1__bar"])],
    ]);
    const result = getLastUsedByScenario(messages, loaded, scenarioToToolNames);
    expect(result.size).toBe(1);
    expect(result.get("s1#sc1")).toBe(2000);
  });

  it("ignores meta-tool names (load_scenario, unload_scenario, list_mcp_scenarios)", () => {
    const messages: Message[] = [
      {
        messageId: "m1",
        threadId: "t1",
        role: "assistant",
        content: [
          {
            type: "tool-call",
            callId: "c1",
            name: "load_scenario",
            arguments: '{"serverId":"s1","scenarioId":"sc1"}',
          },
        ],
        createdAt: 1000,
      },
    ];
    const loaded = new Set<string>(["s1#sc1"]);
    const scenarioToToolNames = new Map<string, Set<string>>([
      ["s1#sc1", new Set(["load_scenario"])],
    ]);
    const result = getLastUsedByScenario(messages, loaded, scenarioToToolNames);
    expect(result.size).toBe(0);
  });

  it("updates only loaded scenario keys that own the tool", () => {
    const messages: Message[] = [
      {
        messageId: "m1",
        threadId: "t1",
        role: "assistant",
        content: [
          { type: "tool-call", callId: "c1", name: "s1__foo", arguments: "{}" },
        ],
        createdAt: 1500,
      },
    ];
    const loaded = new Set<string>(["s1#sc1", "s1#sc2"]);
    const scenarioToToolNames = new Map<string, Set<string>>([
      ["s1#sc1", new Set(["s1__foo"])],
      ["s1#sc2", new Set(["s1__other"])],
    ]);
    const result = getLastUsedByScenario(messages, loaded, scenarioToToolNames);
    expect(result.get("s1#sc1")).toBe(1500);
    expect(result.has("s1#sc2")).toBe(false);
  });
});

describe("applyAutoUnload", () => {
  it("returns all kept and empty evicted when loaded.size <= max", () => {
    const loaded = new Set<string>(["a", "b"]);
    const lastUsed = new Map<string, number>([["a", 100], ["b", 200]]);
    const r = applyAutoUnload(loaded, lastUsed, 10);
    expect(r.kept.size).toBe(2);
    expect(r.kept.has("a")).toBe(true);
    expect(r.kept.has("b")).toBe(true);
    expect(r.evicted.size).toBe(0);
  });

  it("evicts by lastUsed ascending (oldest first)", () => {
    const loaded = new Set<string>(["a", "b", "c", "d"]);
    const lastUsed = new Map<string, number>([
      ["a", 100],
      ["b", 300],
      ["c", 200],
      ["d", 400],
    ]);
    const r = applyAutoUnload(loaded, lastUsed, 2);
    expect(r.kept.size).toBe(2);
    expect(r.evicted.size).toBe(2);
    expect(r.evicted.has("a")).toBe(true);
    expect(r.evicted.has("c")).toBe(true);
    expect(r.kept.has("b")).toBe(true);
    expect(r.kept.has("d")).toBe(true);
  });

  it("treats missing lastUsed as 0 (evicted first), then sorts by key for tie-break", () => {
    const loaded = new Set<string>(["x", "y", "z"]);
    const lastUsed = new Map<string, number>([["y", 100]]); // x,z missing => 0
    const r = applyAutoUnload(loaded, lastUsed, 1);
    expect(r.kept.size).toBe(1);
    expect(r.evicted.size).toBe(2);
    expect(r.kept.has("y")).toBe(true);
    expect(r.evicted.has("x")).toBe(true);
    expect(r.evicted.has("z")).toBe(true);
  });

  it("uses MAX_LOADED_SCENARIOS as default cap value", () => {
    const loaded = new Set<string>(
      Array.from({ length: MAX_LOADED_SCENARIOS + 2 }, (_, i) => `s${i}`)
    );
    const lastUsed = new Map<string, number>();
    const r = applyAutoUnload(loaded, lastUsed, MAX_LOADED_SCENARIOS);
    expect(r.kept.size).toBe(MAX_LOADED_SCENARIOS);
    expect(r.evicted.size).toBe(2);
  });
});
