/**
 * Message store contract tests using in-memory implementation.
 * Verifies that user messages can contain tool-call and tool-result content and are stored/returned as-is.
 */
import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import type { Env } from "../../types.ts";
import { createMessagesController } from "../../controllers/messages.ts";
import { createMemoryMessageStore } from "./memory-message-store.ts";
import { createMemoryThreadStore } from "./memory-thread-store.ts";

describe("message store", () => {
  it("create user message with tool-call content then list returns message with same content", async () => {
    const threadStore = createMemoryThreadStore();
    const messageStore = createMemoryMessageStore();
    const realmId = "realm-1";
    const thread = await threadStore.create(realmId, { title: "Test" });

    const content = [
      {
        type: "tool-call" as const,
        callId: "call-1",
        name: "load_scenario",
        arguments: "{}",
      },
    ];
    const created = await messageStore.create(thread.threadId, {
      role: "user",
      content,
    });
    expect(created.role).toBe("user");
    expect(created.content).toEqual(content);

    const { items } = await messageStore.list(thread.threadId);
    expect(items.length).toBe(1);
    expect(items[0].messageId).toBe(created.messageId);
    expect(items[0].role).toBe("user");
    expect(items[0].content).toEqual(content);
    expect(items[0].content[0]).toMatchObject({
      type: "tool-call",
      callId: "call-1",
      name: "load_scenario",
      arguments: "{}",
    });
  });

  it("create user message with tool-call and tool-result content then list returns both parts", async () => {
    const threadStore = createMemoryThreadStore();
    const messageStore = createMemoryMessageStore();
    const realmId = "realm-1";
    const thread = await threadStore.create(realmId, { title: "Test" });

    const content = [
      { type: "tool-call" as const, callId: "c1", name: "load_scenario", arguments: '{"serverId":"s1","scenarioId":"sc1"}' },
      { type: "tool-result" as const, callId: "c1", result: "ok" },
    ];
    await messageStore.create(thread.threadId, { role: "user", content });

    const { items } = await messageStore.list(thread.threadId);
    expect(items.length).toBe(1);
    expect(items[0].content).toHaveLength(2);
    expect(items[0].content[0]).toEqual({
      type: "tool-call",
      callId: "c1",
      name: "load_scenario",
      arguments: '{"serverId":"s1","scenarioId":"sc1"}',
    });
    expect(items[0].content[1]).toEqual({ type: "tool-result", callId: "c1", result: "ok" });
  });
});

describe("messages controller", () => {
  it("accepts POST with user role and tool-call content, returns 201 and list returns stored content", async () => {
    const threadStore = createMemoryThreadStore();
    const messageStore = createMemoryMessageStore();
    const realmId = "user-123";
    const thread = await threadStore.create(realmId, { title: "Chat" });

    const controller = createMessagesController({ messageStore, threadStore });
    const app = new Hono<Env>()
      .use("*", (c, next) => {
        c.set("auth", { type: "user", userId: realmId });
        return next();
      })
      .post("/api/realm/:realmId/threads/:threadId/messages", (c) => controller.create(c))
      .get("/api/realm/:realmId/threads/:threadId/messages", (c) => controller.list(c));

    const createRes = await app.request(
      `http://localhost/api/realm/${realmId}/threads/${thread.threadId}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: "user",
          content: [{ type: "tool-call", callId: "x1", name: "load_scenario", arguments: "{}" }],
        }),
      }
    );
    expect(createRes.status).toBe(201);

    const listRes = await app.request(
      `http://localhost/api/realm/${realmId}/threads/${thread.threadId}/messages`
    );
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as { messages: { role: string; content: unknown[] }[] };
    expect(listBody.messages.length).toBe(1);
    expect(listBody.messages[0].role).toBe("user");
    expect(listBody.messages[0].content).toEqual([
      { type: "tool-call", callId: "x1", name: "load_scenario", arguments: "{}" },
    ]);
  });
});
