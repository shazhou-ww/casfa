/**
 * Tests for deriveLoadedScenarios: derive loaded scenario keys from thread message history.
 */
import { describe, expect, it } from "bun:test";
import { deriveLoadedScenarios } from "./derive-loaded-scenarios.ts";
import type { Message } from "./model-types.ts";
import type { MCPServerConfig } from "./mcp-types.ts";

const threadId = "thread-1";

function makeServer(id: string): MCPServerConfig {
  return { id, name: `Server ${id}`, transport: "stdio", auth: "none" };
}

describe("deriveLoadedScenarios", () => {
  it("returns empty Set when messages is empty", () => {
    const messages: Message[] = [];
    const mcpServers: MCPServerConfig[] = [makeServer("s1")];
    const result = deriveLoadedScenarios(threadId, messages, mcpServers);
    expect(result).toBeInstanceOf(Set);
    expect(result.size).toBe(0);
  });

  it("returns Set with s1#sc1 when one assistant message has load_scenario(s1, sc1)", () => {
    const messages: Message[] = [
      {
        messageId: "m1",
        threadId,
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
    const mcpServers: MCPServerConfig[] = [makeServer("s1")];
    const result = deriveLoadedScenarios(threadId, messages, mcpServers);
    expect(result.size).toBe(1);
    expect(result.has("s1#sc1")).toBe(true);
  });

  it("returns empty Set when load_scenario then unload_scenario(s1, sc1)", () => {
    const messages: Message[] = [
      {
        messageId: "m1",
        threadId,
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
      {
        messageId: "m2",
        threadId,
        role: "assistant",
        content: [
          {
            type: "tool-call",
            callId: "c2",
            name: "unload_scenario",
            arguments: '{"serverId":"s1","scenarioId":"sc1"}',
          },
        ],
        createdAt: 2000,
      },
    ];
    const mcpServers: MCPServerConfig[] = [makeServer("s1")];
    const result = deriveLoadedScenarios(threadId, messages, mcpServers);
    expect(result.size).toBe(0);
  });

  it("adds to loaded when user message contains load_scenario", () => {
    const messages: Message[] = [
      {
        messageId: "m1",
        threadId,
        role: "user",
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
    const mcpServers: MCPServerConfig[] = [makeServer("s1")];
    const result = deriveLoadedScenarios(threadId, messages, mcpServers);
    expect(result.size).toBe(1);
    expect(result.has("s1#sc1")).toBe(true);
  });
});
