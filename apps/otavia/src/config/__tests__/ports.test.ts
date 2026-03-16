import { describe, expect, test } from "bun:test";
import { resolvePortsFromEnv, resolvePortsFromPortBase } from "../ports.js";

describe("resolvePortsFromPortBase", () => {
  test("derives dev ports from PORT_BASE + dev offsets", () => {
    expect(resolvePortsFromPortBase("dev", 7000)).toEqual({
      portBase: 7000,
      frontend: 7100,
      backend: 8900,
      dynamodb: 9001,
      minio: 9000,
    });
  });

  test("derives test ports from PORT_BASE + test offsets", () => {
    expect(resolvePortsFromPortBase("test", 8000)).toEqual({
      portBase: 8000,
      frontend: 8100,
      backend: 8910,
      dynamodb: 8012,
      minio: 9014,
    });
  });
});

describe("resolvePortsFromEnv", () => {
  test("reads PORT_BASE from env map", () => {
    expect(resolvePortsFromEnv("dev", { PORT_BASE: "7000" })).toEqual({
      portBase: 7000,
      frontend: 7100,
      backend: 8900,
      dynamodb: 9001,
      minio: 9000,
    });
  });

  test("throws when PORT_BASE is missing", () => {
    expect(() => resolvePortsFromEnv("dev", {})).toThrow(
      'Missing PORT_BASE for stage "dev". Define it in .env.dev/.env.test or process env.'
    );
  });

  test("throws when PORT_BASE is invalid", () => {
    expect(() => resolvePortsFromEnv("test", { PORT_BASE: "abc" })).toThrow(
      'Invalid PORT_BASE for stage "test": "abc"'
    );
  });
});
