import type { Message } from "./api.ts";

export function mergeConsecutiveAssistantMessages(messages: Message[]): Message[] {
  const merged: Message[] = [];
  for (const msg of messages) {
    const prev = merged[merged.length - 1];
    if (msg.role !== "assistant" || !prev || prev.role !== "assistant") {
      merged.push(msg);
      continue;
    }

    const combined: Message = {
      ...prev,
      messageId: `${prev.messageId}::${msg.messageId}`,
      content: [...prev.content, ...msg.content],
      createdAt: msg.createdAt,
      modelId: msg.modelId ?? prev.modelId,
    };
    merged[merged.length - 1] = combined;
  }
  return merged;
}
