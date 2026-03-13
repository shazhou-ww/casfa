/**
 * Settings store contract tests using in-memory implementation.
 */
import { describe, expect, it } from "bun:test";
import { createMemorySettingsStore } from "./memory-settings-store.ts";

describe("settings store", () => {
  it("set then get returns value and updatedAt", async () => {
    const store = createMemorySettingsStore();
    const realmId = "realm-1";
    const set = await store.set(realmId, "llm.providers", [{ id: "p1", baseUrl: "https://api.example.com", apiKey: "key", models: [] }]);
    expect(set.key).toBe("llm.providers");
    expect(set.updatedAt).toBeGreaterThan(0);
    const got = await store.get(realmId, "llm.providers");
    expect(got).not.toBeNull();
    expect(got!.value).toEqual([{ id: "p1", baseUrl: "https://api.example.com", apiKey: "key", models: [] }]);
    expect(got!.updatedAt).toBe(set.updatedAt);
  });

  it("list returns items", async () => {
    const store = createMemorySettingsStore();
    const realmId = "realm-1";
    await store.set(realmId, "key1", "v1");
    await store.set(realmId, "key2", "v2");
    const items = await store.list(realmId);
    expect(items.length).toBe(2);
  });

  it("set same key again updates updatedAt", async () => {
    const store = createMemorySettingsStore();
    const realmId = "realm-1";
    await store.set(realmId, "k", "v1");
    const first = await store.get(realmId, "k");
    await new Promise((r) => setTimeout(r, 2));
    await store.set(realmId, "k", "v2");
    const second = await store.get(realmId, "k");
    expect(second!.updatedAt).toBeGreaterThanOrEqual(first!.updatedAt);
    expect(second!.value).toBe("v2");
  });
});
