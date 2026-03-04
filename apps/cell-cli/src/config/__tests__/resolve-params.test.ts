import { describe, expect, test } from "bun:test";
import { resolveParams } from "../resolve-params.js";

describe("resolveParams", () => {
  test("plain string params resolve to themselves", () => {
    const result = resolveParams({
      A: "hello",
      B: "world",
    });
    expect(result).toEqual({ A: "hello", B: "world" });
  });

  test("single $ref resolves to referenced value", () => {
    const result = resolveParams({
      A: "hello",
      B: { $ref: "A" },
    });
    expect(result).toEqual({ A: "hello", B: "hello" });
  });

  test("chain A→B→C resolves correctly", () => {
    const result = resolveParams({
      C: { $ref: "B" },
      B: { $ref: "A" },
      A: "root",
    });
    expect(result).toEqual({ A: "root", B: "root", C: "root" });
  });

  test("circular reference throws with useful error message", () => {
    expect(() =>
      resolveParams({
        A: { $ref: "B" },
        B: { $ref: "A" },
      })
    ).toThrow(/[Cc]ircular/);
  });

  test("missing reference throws with useful error message", () => {
    expect(() =>
      resolveParams({
        A: { $ref: "NONEXISTENT" },
      })
    ).toThrow(/non-existent/i);
  });

  test("secret values pass through unchanged", () => {
    const result = resolveParams({
      A: { secret: "my-secret" },
      B: "plain",
    });
    expect(result).toEqual({
      A: { secret: "my-secret" },
      B: "plain",
    });
  });

  test("$ref referencing a secret resolves to the secret ref", () => {
    const result = resolveParams({
      DB_PASSWORD: { secret: "DB_PASSWORD" },
      ALIAS: { $ref: "DB_PASSWORD" },
    });
    expect(result).toEqual({
      DB_PASSWORD: { secret: "DB_PASSWORD" },
      ALIAS: { secret: "DB_PASSWORD" },
    });
  });
});
