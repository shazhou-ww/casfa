/**
 * Unit tests for createMemoryStorage (del)
 */
import { describe, expect, it } from "bun:test";
import { createMemoryStorage } from "../src/memory-storage.ts";

const KEY = "ABCDEFGHIJKLMNOPQRSTUVWXY0";
const DATA = new Uint8Array([1, 2, 3, 4, 5]);

describe("createMemoryStorage — del", () => {
  it("put then del then get returns null", async () => {
    const storage = createMemoryStorage();
    await storage.put(KEY, DATA);
    expect(await storage.get(KEY)).toEqual(DATA);

    await storage.del(KEY);
    expect(await storage.get(KEY)).toBeNull();
  });

  it("del on missing key is a no-op", async () => {
    const storage = createMemoryStorage();
    await storage.del(KEY);
    expect(await storage.get(KEY)).toBeNull();
  });
});
