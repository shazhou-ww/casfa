import { describe, expect, test } from "bun:test";
import {
  bucketPhysicalName,
  tablePhysicalName,
} from "../resource-names.js";

describe("tablePhysicalName", () => {
  test("returns myapp-server-next-realms for (myapp, server-next, realms)", () => {
    expect(tablePhysicalName("myapp", "server-next", "realms")).toBe(
      "myapp-server-next-realms",
    );
  });

  test("normalizes uppercase to lowercase", () => {
    expect(tablePhysicalName("MyApp", "Server-Next", "Realms")).toBe(
      "myapp-server-next-realms",
    );
  });

  test("normalizes underscore to hyphen", () => {
    expect(tablePhysicalName("my_app", "server_next", "realms_table")).toBe(
      "my-app-server-next-realms-table",
    );
  });
});

describe("bucketPhysicalName", () => {
  test("returns normalized name when length ≤63", () => {
    const name = bucketPhysicalName("myapp", "server-next", "assets");
    expect(name).toBe("myapp-server-next-assets");
    expect(name.length).toBeLessThanOrEqual(63);
  });

  test("normalizes uppercase and underscore like table", () => {
    expect(bucketPhysicalName("MyApp", "server_next", "Assets")).toBe(
      "myapp-server-next-assets",
    );
  });

  test("when total length > 63, result ≤63 and includes hash suffix", () => {
    const stackName = "myapp";
    const cellId = "server-next";
    const bucketKey = "a".repeat(60);
    const full = `${stackName}-${cellId}-${bucketKey}`;
    expect(full.length).toBeGreaterThan(63);

    const name = bucketPhysicalName(stackName, cellId, bucketKey);
    expect(name.length).toBeLessThanOrEqual(63);
    expect(name.length).toBe(63);
    expect(name).toMatch(/^[a-z0-9-]+$/);
    expect(name).toMatch(/-[a-f0-9]{8}$/);
  });

  test("same inputs produce same bucket name (deterministic)", () => {
    const stackName = "longstack";
    const cellId = "longcell";
    const bucketKey = "x".repeat(50);
    const a = bucketPhysicalName(stackName, cellId, bucketKey);
    const b = bucketPhysicalName(stackName, cellId, bucketKey);
    expect(a).toBe(b);
  });
});
