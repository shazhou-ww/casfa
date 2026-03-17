import { describe, expect, test } from "bun:test";
import type { Message } from "./api.ts";
import { resolveStreamMessageCreatedAt } from "./chat-display-order.ts";

function mkMessage(createdAt: number): Message {
  return {
    messageId: `m-${createdAt}`,
    threadId: "t1",
    role: "assistant",
    content: [{ type: "text", text: "x" }],
    createdAt,
  };
}

describe("resolveStreamMessageCreatedAt", () => {
  test("places streaming message after latest persisted message", () => {
    const messages = [mkMessage(1000), mkMessage(1200), mkMessage(1500)];
    const createdAt = resolveStreamMessageCreatedAt(messages, 900, 0);
    expect(createdAt).toBe(1501);
  });

  test("keeps monotonic order for multiple stream messages", () => {
    const messages = [mkMessage(10)];
    const a = resolveStreamMessageCreatedAt(messages, 1, 0);
    const b = resolveStreamMessageCreatedAt(messages, 1, 1);
    expect(a).toBe(11);
    expect(b).toBe(12);
  });
});
