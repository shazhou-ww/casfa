/**
 * In-memory message store for unit tests.
 */
import type { Message } from "../../types.ts";
import type { MessageStore } from "../../db/message-store.ts";

function generateMessageId(): string {
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createMemoryMessageStore(): MessageStore {
  const byThread = new Map<string, Message[]>();

  return {
    async list(threadId, limit = 100, _cursor) {
      const list = byThread.get(threadId) ?? [];
      const items = [...list].sort((a, b) => a.createdAt - b.createdAt).slice(0, limit);
      return { items, nextCursor: undefined };
    },

    async create(threadId, input) {
      const now = Date.now();
      const messageId = generateMessageId();
      const message: Message = {
        messageId,
        threadId,
        role: input.role,
        content: input.content,
        createdAt: now,
        modelId: input.modelId,
      };
      const list = byThread.get(threadId) ?? [];
      list.push(message);
      byThread.set(threadId, list);
      return message;
    },

    async deleteByThread(threadId) {
      byThread.delete(threadId);
    },
  };
}
