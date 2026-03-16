import { describe, expect, test } from "bun:test";
import { createMemoryRefreshSessionStore } from "./refresh-session-store.ts";

describe("createMemoryRefreshSessionStore", () => {
  test("stores and fetches by handle", async () => {
    const store = createMemoryRefreshSessionStore();
    await store.putByHandle("handle-1", { refreshToken: "rt-1" });
    await expect(store.getByHandle("handle-1")).resolves.toEqual({
      refreshToken: "rt-1",
      expiresAt: undefined,
    });
  });

  test("returns null for expired session", async () => {
    const store = createMemoryRefreshSessionStore();
    const now = Math.floor(Date.now() / 1000);
    await store.putByHandle("handle-2", {
      refreshToken: "rt-2",
      expiresAt: now - 1,
    });
    await expect(store.getByHandle("handle-2")).resolves.toBeNull();
  });

  test("removes session by handle", async () => {
    const store = createMemoryRefreshSessionStore();
    await store.putByHandle("handle-3", { refreshToken: "rt-3" });
    await store.removeByHandle("handle-3");
    await expect(store.getByHandle("handle-3")).resolves.toBeNull();
  });
});
