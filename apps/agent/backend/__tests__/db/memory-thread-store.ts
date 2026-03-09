/**
 * In-memory thread store for unit tests.
 */
import type { Thread } from "../../types.ts";
import type { ThreadStore } from "../../db/thread-store.ts";

function generateThreadId(): string {
  return `thr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createMemoryThreadStore(): ThreadStore {
  const byKey = new Map<string, Thread>();

  function key(realmId: string, threadId: string): string {
    return `REALM#${realmId}#THREAD#${threadId}`;
  }

  return {
    async list(realmId, limit = 50) {
      const prefix = `REALM#${realmId}#THREAD#`;
      const items = Array.from(byKey.entries())
        .filter(([k]) => k.startsWith(prefix))
        .map(([, v]) => v)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, limit);
      return { items, nextCursor: undefined };
    },

    async get(realmId, threadId) {
      return byKey.get(key(realmId, threadId)) ?? null;
    },

    async create(realmId, input) {
      const now = Date.now();
      const threadId = generateThreadId();
      const thread: Thread = {
        threadId,
        title: input.title,
        createdAt: now,
        updatedAt: now,
      };
      byKey.set(key(realmId, threadId), thread);
      return thread;
    },

    async update(realmId, threadId, input) {
      const existing = byKey.get(key(realmId, threadId));
      if (!existing) return null;
      const now = Date.now();
      const thread: Thread = {
        ...existing,
        ...input,
        updatedAt: now,
      };
      byKey.set(key(realmId, threadId), thread);
      return thread;
    },

    async delete(realmId, threadId) {
      byKey.delete(key(realmId, threadId));
    },
  };
}
