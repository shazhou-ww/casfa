import { describe, expect, test } from "bun:test";
import {
  assertDeclaredParamsProvided,
  MissingDeclaredParamsError,
  MissingParamsError,
  mergeParams,
  resolveParams,
} from "../resolve-params.js";

describe("mergeParams", () => {
  test("stack has A, B; cell has B, C → result has A(from stack), B(from cell), C(from cell)", () => {
    const stack = { A: "stackA", B: "stackB" };
    const cell = { B: "cellB", C: "cellC" };
    const result = mergeParams(stack, cell);
    expect(result.A).toBe("stackA");
    expect(result.B).toBe("cellB");
    expect(result.C).toBe("cellC");
  });

  test("empty stack and cell returns empty object", () => {
    expect(mergeParams(undefined, undefined)).toEqual({});
    expect(mergeParams({}, {})).toEqual({});
  });

  test("cell-only params", () => {
    expect(mergeParams(undefined, { x: 1 })).toEqual({ x: 1 });
  });

  test("stack-only params", () => {
    expect(mergeParams({ x: 1 }, undefined)).toEqual({ x: 1 });
  });

  test("cell !Param references top-level params", () => {
    const stack = { REGION: "us-east-1", API_KEY: { secret: "BFL_API_KEY" } };
    const cell = {
      REGION: { param: "REGION" },
      BFL_API_KEY: { param: "API_KEY" },
    };
    expect(mergeParams(stack, cell)).toEqual({
      REGION: "us-east-1",
      API_KEY: { secret: "BFL_API_KEY" },
      BFL_API_KEY: { secret: "BFL_API_KEY" },
    });
  });
});

describe("resolveParams", () => {
  test("all EnvRef/SecretRef present in envMap → replaced with strings", () => {
    const merged = {
      API_URL: { env: "API_URL" },
      TOKEN: { secret: "API_TOKEN" },
      plain: "hello",
    };
    const envMap = { API_URL: "https://api.example.com", API_TOKEN: "s3cret" };
    const result = resolveParams(merged, envMap);
    expect(result.API_URL).toBe("https://api.example.com");
    expect(result.TOKEN).toBe("s3cret");
    expect(result.plain).toBe("hello");
  });

  test("nested object: EnvRef inside object is resolved", () => {
    const merged = {
      dns: {
        provider: "cloudflare",
        zoneId: { env: "ZONE_ID" },
      },
    };
    const envMap = { ZONE_ID: "zone-123" };
    const result = resolveParams(merged, envMap);
    expect(result).toEqual({
      dns: {
        provider: "cloudflare",
        zoneId: "zone-123",
      },
    });
  });

  test("missing env key with onMissingParam throw → throws MissingParamsError with missing key listed", () => {
    const merged = {
      API_URL: { env: "API_URL" },
      KEY: { env: "MISSING_VAR" },
    };
    const envMap = { API_URL: "https://api.example.com" };
    expect(() => resolveParams(merged, envMap)).toThrow(MissingParamsError);
    try {
      resolveParams(merged, envMap);
    } catch (e) {
      expect(e).toBeInstanceOf(MissingParamsError);
      expect((e as MissingParamsError).missingKeys).toContain("MISSING_VAR");
    }
  });

  test("missing secret with onMissingParam throw → throws MissingParamsError", () => {
    const merged = { TOKEN: { secret: "MISSING_SECRET" } };
    const envMap = {};
    expect(() => resolveParams(merged, envMap)).toThrow(MissingParamsError);
    try {
      resolveParams(merged, envMap);
    } catch (e) {
      expect((e as MissingParamsError).missingKeys).toContain("MISSING_SECRET");
    }
  });

  test("missing with onMissingParam placeholder → use placeholder for missing", () => {
    const merged = {
      API_URL: { env: "API_URL" },
      MISSING: { env: "MISSING_VAR" },
      TOKEN: { secret: "API_TOKEN" },
    };
    const envMap = { API_URL: "https://api.example.com" };
    const result = resolveParams(merged, envMap, {
      onMissingParam: "placeholder",
    });
    expect(result.API_URL).toBe("https://api.example.com");
    expect(result.MISSING).toBe("[missing]");
    expect(result.TOKEN).toBe("[missing]");
  });

  test("default onMissingParam is throw", () => {
    const merged = { X: { env: "NOT_IN_ENV" } };
    expect(() => resolveParams(merged, {})).toThrow(MissingParamsError);
  });
});

describe("assertDeclaredParamsProvided", () => {
  test("passes when all declared params are present", () => {
    expect(() =>
      assertDeclaredParamsProvided(["A", "B"], { A: 1, B: { env: "B" } }, "cell-a")
    ).not.toThrow();
  });

  test("throws when declared params are missing", () => {
    expect(() =>
      assertDeclaredParamsProvided(["A", "B"], { A: 1 }, "cell-a")
    ).toThrow(MissingDeclaredParamsError);
  });
});
