import type { Context } from "hono";
import type { MessageStore } from "../db/message-store.ts";
import type { ThreadStore } from "../db/thread-store.ts";
import type { Env } from "../types.ts";
import type { MessageContentPart } from "../types.ts";

export type MessagesControllerDeps = {
  messageStore: MessageStore;
  threadStore: ThreadStore;
};

function isValidContent(content: unknown): content is MessageContentPart[] {
  if (!Array.isArray(content)) return false;
  return content.every(
    (p) => typeof p === "object" && p !== null && p.type === "text" && typeof (p as MessageContentPart).text === "string"
  );
}

export function createMessagesController(deps: MessagesControllerDeps) {
  const { messageStore, threadStore } = deps;
  return {
    async list(c: Context<Env>) {
      const realmId = c.req.param("realmId")!;
      const threadId = c.req.param("threadId")!;
      const thread = await threadStore.get(realmId, threadId);
      if (!thread) return c.json({ error: "NOT_FOUND", message: "Thread not found" }, 404);
      const limit = Math.min(Number(c.req.query("limit")) || 100, 200);
      const cursor = c.req.query("cursor") ?? undefined;
      const { items, nextCursor } = await messageStore.list(threadId, limit, cursor);
      return c.json({ messages: items, nextCursor: nextCursor ?? null }, 200);
    },

    async create(c: Context<Env>) {
      const realmId = c.req.param("realmId")!;
      const threadId = c.req.param("threadId")!;
      const thread = await threadStore.get(realmId, threadId);
      if (!thread) return c.json({ error: "NOT_FOUND", message: "Thread not found" }, 404);
      let body: { role: string; content: unknown };
      try {
        body = (await c.req.json()) as { role: string; content: unknown };
      } catch {
        return c.json({ error: "VALIDATION_ERROR", message: "Invalid JSON body" }, 400);
      }
      const role = body.role;
      if (role !== "user" && role !== "assistant" && role !== "system") {
        return c.json({ error: "VALIDATION_ERROR", message: "role must be user, assistant, or system" }, 400);
      }
      if (!isValidContent(body.content)) {
        return c.json({ error: "VALIDATION_ERROR", message: "content must be array of { type: 'text', text: string }" }, 400);
      }
      const message = await messageStore.create(threadId, { role: role as "user" | "assistant" | "system", content: body.content });
      return c.json(message, 201);
    },
  };
}
