import { describe, expect, test } from "bun:test";
import type { Change, MessageContent, ModelState } from "../lib/model-types.ts";
import { runMessagesSend } from "./streaming.ts";

function createInitialState(): ModelState {
  return {
    threads: [],
    messagesByThread: {},
    streamByMessageId: {},
    settings: {
      "llm.providers": [
        {
          id: "provider-1",
          baseUrl: "https://example.com/v1",
          apiKey: "k",
          models: [{ id: "model-1", name: "Model 1" }],
        },
      ],
    },
  };
}

describe("runMessagesSend persistence timing", () => {
  test("persists each assistant round instead of waiting for full ReAct loop", async () => {
    const threadId = "thread-1";
    const createMessageCalls: Array<{ role: string; content: unknown[]; modelId?: string }> = [];
    let createMessageCounter = 0;
    const applyChanges: Change[] = [];

    const createMessage = async (
      targetThreadId: string,
      body: { role: "user" | "assistant" | "system"; content: unknown[]; modelId?: string }
    ) => {
      createMessageCalls.push({ role: body.role, content: body.content, modelId: body.modelId });
      createMessageCounter++;
      return {
        messageId: `m-${createMessageCounter}`,
        threadId: targetThreadId,
        role: body.role,
        content: body.content,
        createdAt: 1000 + createMessageCounter,
        modelId: body.modelId,
      };
    };

    let llmRound = 0;
    const callLlmStream = async () => {
      llmRound++;
      if (llmRound === 1) {
        return {
          content: "thinking",
          toolCalls: [{ id: "call-1", name: "list_servers", arguments: "{}" }],
        };
      }
      return {
        content: "final answer",
        toolCalls: [],
      };
    };

    const buildToolsAndPromptForThread = async () => ({ tools: [] });
    const executeTool = async () => '{"result":"ok"}';

    await runMessagesSend(
      threadId,
      [{ type: "text", text: "hello" }],
      "model-1",
      createInitialState(),
      async (change) => {
        applyChanges.push(change);
      },
      () => {},
      () => {},
      undefined,
      {
        createMessage,
        callLlmStream,
        buildToolsAndPromptForThread,
        executeTool,
      }
    );

    expect(createMessageCalls).toHaveLength(3);
    expect(createMessageCalls[0].role).toBe("user");
    expect(createMessageCalls[1].role).toBe("assistant");
    expect(createMessageCalls[2].role).toBe("assistant");

    expect(createMessageCalls[1].content).toEqual([
      { type: "text", text: "thinking" },
      { type: "tool-call", callId: "call-1", name: "list_servers", arguments: "{}" },
      { type: "tool-result", callId: "call-1", result: '{"result":"ok"}' },
    ]);
    expect(createMessageCalls[2].content).toEqual([{ type: "text", text: "final answer" }]);

    const appendedMessages = applyChanges.filter((c) => c.kind === "messages.append");
    expect(appendedMessages).toHaveLength(3);

    const streamDone = applyChanges.find((c) => c.kind === "stream.done");
    expect(streamDone?.kind).toBe("stream.done");
    if (streamDone?.kind === "stream.done") {
      expect(streamDone.payload.message.messageId).toBe("m-3");
      expect(streamDone.payload.message.content as MessageContent[]).toEqual([
        { type: "text", text: "final answer" },
      ]);
    }
  });
});
