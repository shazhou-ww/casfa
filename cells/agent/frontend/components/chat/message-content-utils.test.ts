import { describe, expect, test } from "bun:test";
import type { Message } from "../../lib/api.ts";
import { groupContentParts, messageToCopyText } from "./message-content-utils.ts";

function mkAssistantMessage(content: Message["content"]): Message {
  return {
    messageId: "m1",
    threadId: "t1",
    role: "assistant",
    content,
    createdAt: 1,
  };
}

describe("message content utils", () => {
  test("groups fragmented tool-call chunks without callId into one tool block", () => {
    const msg = mkAssistantMessage([
      { type: "tool-call", callId: "", name: "get_tools", arguments: "{" },
      { type: "tool-call", callId: "", name: "get_tools", arguments: '{"serverIds": [' },
      { type: "tool-call", callId: "c1", name: "get_tools", arguments: '{"serverIds":["s1"]}' },
      { type: "tool-result", callId: "c1", result: '{"ok":true}' },
    ]);

    const blocks = groupContentParts(msg.content);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      type: "tool",
      callId: "c1",
      name: "get_tools",
      request: '{"serverIds":["s1"]}',
      response: '{"ok":true}',
    });
  });

  test("copy text is generated from grouped blocks instead of raw fragmented parts", () => {
    const msg = mkAssistantMessage([
      { type: "text", text: "先查看工具" },
      { type: "tool-call", callId: "", name: "list_servers", arguments: "{}" },
      { type: "tool-call", callId: "", name: "list_servers", arguments: "{}" },
      { type: "tool-result", callId: "", result: '{"servers":[]}' },
    ]);

    const copied = messageToCopyText(msg);
    expect(copied).toContain("先查看工具");
    expect(copied.match(/tool request: list_servers/g)?.length ?? 0).toBe(1);
    expect(copied).toContain('"servers": []');
  });
});
