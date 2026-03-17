import { describe, expect, test } from "bun:test";
import type { Change, Message, ModelState } from "../lib/model-types.ts";
import type { ApplyChangeDeps } from "./apply-change.ts";
import { applyChange } from "./apply-change.ts";

function createStateWithAssistant(threadId: string, message: Message): ModelState {
  return {
    threads: [],
    messagesByThread: {
      [threadId]: [message],
    },
    streamByMessageId: {
      stream_1: {
        messageId: "stream_1",
        threadId,
        status: "streaming",
        chunks: [],
        startedAt: 100,
      },
    },
    settings: {},
  };
}

describe("applyChange stream.done", () => {
  test("does not duplicate assistant message when already appended in previous round", async () => {
    const threadId = "thread-1";
    const assistantMessage: Message = {
      messageId: "a-1",
      threadId,
      role: "assistant",
      content: [{ type: "text", text: "final" }],
      createdAt: 123,
      modelId: "model-1",
    };
    const state = createStateWithAssistant(threadId, assistantMessage);
    const change: Change = {
      kind: "stream.done",
      payload: {
        messageId: "stream_1",
        threadId,
        message: assistantMessage,
      },
    };
    const deps: ApplyChangeDeps = {
      putThreads: async () => {},
      putMessage: async () => {},
      deleteMessage: async () => {},
      replaceMessagesForThread: async () => {},
      putStreamState: async () => {},
      deleteStreamState: async () => {},
      putSetting: async () => {},
    };

    const next = await applyChange(state, change, deps);
    expect(next.messagesByThread[threadId]).toHaveLength(1);
    expect(next.messagesByThread[threadId][0].messageId).toBe("a-1");
    expect(next.streamByMessageId.stream_1).toBeUndefined();
  });
});
