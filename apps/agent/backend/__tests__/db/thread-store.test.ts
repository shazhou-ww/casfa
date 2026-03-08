/**
 * Thread store contract tests using in-memory implementation.
 */
import { describe, expect, it } from "bun:test";
import { createMemoryThreadStore } from "./memory-thread-store.ts";

describe("thread store", () => {
  it("create then get returns thread", async () => {
    const store = createMemoryThreadStore();
    const realmId = "realm-1";
    const created = await store.create(realmId, { title: "My thread" });
    expect(created.threadId).toBeDefined();
    expect(created.title).toBe("My thread");
    const got = await store.get(realmId, created.threadId);
    expect(got).not.toBeNull();
    expect(got!.threadId).toBe(created.threadId);
    expect(got!.title).toBe("My thread");
  });

  it("list returns threads by updatedAt desc", async () => {
    const store = createMemoryThreadStore();
    const realmId = "realm-1";
    await store.create(realmId, { title: "First" });
    await store.create(realmId, { title: "Second" });
    const { items } = await store.list(realmId);
    expect(items.length).toBe(2);
  });

  it("update title then get returns new title", async () => {
    const store = createMemoryThreadStore();
    const realmId = "realm-1";
    const created = await store.create(realmId, { title: "Old" });
    const updated = await store.update(realmId, created.threadId, { title: "New" });
    expect(updated!.title).toBe("New");
    const got = await store.get(realmId, created.threadId);
    expect(got!.title).toBe("New");
  });

  it("delete then get returns null", async () => {
    const store = createMemoryThreadStore();
    const realmId = "realm-1";
    const created = await store.create(realmId, { title: "To delete" });
    await store.delete(realmId, created.threadId);
    const got = await store.get(realmId, created.threadId);
    expect(got).toBeNull();
  });
});
