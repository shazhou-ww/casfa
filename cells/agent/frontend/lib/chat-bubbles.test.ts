import { describe, expect, test } from "bun:test";
import type { Message } from "./api.ts";
import { mergeConsecutiveAssistantMessages } from "./chat-bubbles.ts";

function mkMessage(
  messageId: string,
  role: Message["role"],
  createdAt: number,
  text: string
): Message {
  return {
    messageId,
    threadId: "t1",
    role,
    content: [{ type: "text", text }],
    createdAt,
  };
}

describe("mergeConsecutiveAssistantMessages", () => {
  test("merges adjacent assistant messages into one bubble message", () => {
    const input: Message[] = [
      mkMessage("u1", "user", 1, "question"),
      mkMessage("a1", "assistant", 2, "thinking"),
      mkMessage("a2", "assistant", 3, "tool result"),
      mkMessage("a3", "assistant", 4, "final answer"),
    ];

    const merged = mergeConsecutiveAssistantMessages(input);

    expect(merged).toHaveLength(2);
    expect(merged[0].messageId).toBe("u1");
    expect(merged[1].role).toBe("assistant");
    expect(merged[1].content).toEqual([
      { type: "text", text: "thinking" },
      { type: "text", text: "tool result" },
      { type: "text", text: "final answer" },
    ]);
  });

  test("does not merge across user/system boundaries", () => {
    const input: Message[] = [
      mkMessage("a1", "assistant", 1, "first"),
      mkMessage("u1", "user", 2, "interrupt"),
      mkMessage("a2", "assistant", 3, "second"),
    ];

    const merged = mergeConsecutiveAssistantMessages(input);
    expect(merged).toHaveLength(3);
    expect(merged.map((m) => m.messageId)).toEqual(["a1", "u1", "a2"]);
  });
});
