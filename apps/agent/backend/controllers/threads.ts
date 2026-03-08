import type { Context } from "hono";
import type { MessageStore } from "../db/message-store.ts";
import type { ThreadStore } from "../db/thread-store.ts";
import type { Env } from "../types.ts";

export type ThreadsControllerDeps = {
  threadStore: ThreadStore;
  messageStore: MessageStore;
};

export function createThreadsController(deps: ThreadsControllerDeps) {
  const { threadStore, messageStore } = deps;
  return {
    async list(c: Context<Env>) {
      const realmId = c.req.param("realmId")!;
      const limit = Math.min(Number(c.req.query("limit")) || 50, 100);
      const cursor = c.req.query("cursor") ?? undefined;
      const { items, nextCursor } = await threadStore.list(realmId, limit, cursor);
      return c.json({ threads: items, nextCursor: nextCursor ?? null }, 200);
    },

    async get(c: Context<Env>) {
      const realmId = c.req.param("realmId")!;
      const threadId = c.req.param("threadId")!;
      const thread = await threadStore.get(realmId, threadId);
      if (!thread) return c.json({ error: "NOT_FOUND", message: "Thread not found" }, 404);
      return c.json(thread, 200);
    },

    async create(c: Context<Env>) {
      const realmId = c.req.param("realmId")!;
      let body: { title?: string; modelId?: string };
      try {
        body = (await c.req.json()) as { title?: string; modelId?: string };
      } catch {
        return c.json({ error: "VALIDATION_ERROR", message: "Invalid JSON body" }, 400);
      }
      const thread = await threadStore.create(realmId, {
        title: body.title,
        modelId: body.modelId,
      });
      return c.json(thread, 201);
    },

    async update(c: Context<Env>) {
      const realmId = c.req.param("realmId")!;
      const threadId = c.req.param("threadId")!;
      let body: { title?: string; modelId?: string };
      try {
        body = (await c.req.json()) as { title?: string; modelId?: string };
      } catch {
        return c.json({ error: "VALIDATION_ERROR", message: "Invalid JSON body" }, 400);
      }
      const thread = await threadStore.update(realmId, threadId, body);
      if (!thread) return c.json({ error: "NOT_FOUND", message: "Thread not found" }, 404);
      return c.json(thread, 200);
    },

    async delete(c: Context<Env>) {
      const realmId = c.req.param("realmId")!;
      const threadId = c.req.param("threadId")!;
      const existing = await threadStore.get(realmId, threadId);
      if (!existing) return c.json({ error: "NOT_FOUND", message: "Thread not found" }, 404);
      await messageStore.deleteByThread(threadId);
      await threadStore.delete(realmId, threadId);
      return c.json({ success: true }, 200);
    },
  };
}
