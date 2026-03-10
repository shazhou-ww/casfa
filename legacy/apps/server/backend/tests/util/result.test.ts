/**
 * Unit tests for Result type utilities
 */

import { describe, expect, it } from "bun:test";
import { err, flatMap, map, ok, type Result, unwrap, unwrapOr } from "../../src/util/result.ts";

describe("Result Utilities", () => {
  describe("ok", () => {
    it("should create a successful result", () => {
      const result = ok(42);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(42);
      }
    });

    it("should work with different types", () => {
      const stringResult = ok("hello");
      const objectResult = ok({ name: "test" });
      const arrayResult = ok([1, 2, 3]);

      expect(stringResult.ok).toBe(true);
      expect(objectResult.ok).toBe(true);
      expect(arrayResult.ok).toBe(true);
    });
  });

  describe("err", () => {
    it("should create an error result", () => {
      const result = err("something went wrong");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("something went wrong");
      }
    });

    it("should work with custom error types", () => {
      const result = err({ code: 404, message: "Not found" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toEqual({ code: 404, message: "Not found" });
      }
    });
  });

  describe("map", () => {
    it("should transform successful result", () => {
      const result = ok(5);
      const mapped = map(result, (x) => x * 2);
      expect(mapped.ok).toBe(true);
      if (mapped.ok) {
        expect(mapped.value).toBe(10);
      }
    });

    it("should pass through error result", () => {
      const result: Result<number, string> = err("error");
      const mapped = map(result, (x) => x * 2);
      expect(mapped.ok).toBe(false);
      if (!mapped.ok) {
        expect(mapped.error).toBe("error");
      }
    });

    it("should allow type transformation", () => {
      const result = ok(42);
      const mapped = map(result, (x) => x.toString());
      expect(mapped.ok).toBe(true);
      if (mapped.ok) {
        expect(mapped.value).toBe("42");
      }
    });
  });

  describe("flatMap", () => {
    it("should chain successful results", () => {
      const result = ok(5);
      const chained = flatMap(result, (x) => ok(x * 2));
      expect(chained.ok).toBe(true);
      if (chained.ok) {
        expect(chained.value).toBe(10);
      }
    });

    it("should pass through original error", () => {
      const result: Result<number, string> = err("first error");
      const chained = flatMap(result, (x) => ok(x * 2));
      expect(chained.ok).toBe(false);
      if (!chained.ok) {
        expect(chained.error).toBe("first error");
      }
    });

    it("should propagate chained error", () => {
      const result = ok(5);
      const chained = flatMap(result, (_) => err("chained error"));
      expect(chained.ok).toBe(false);
      if (!chained.ok) {
        expect(chained.error).toBe("chained error");
      }
    });

    it("should support complex chaining", () => {
      const divide = (a: number, b: number): Result<number, string> =>
        b === 0 ? err("division by zero") : ok(a / b);

      const result = flatMap(ok(10), (x) => flatMap(divide(x, 2), (y) => divide(y, 2)));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(2.5);
      }
    });
  });

  describe("unwrap", () => {
    it("should return value for successful result", () => {
      const result = ok(42);
      expect(unwrap(result)).toBe(42);
    });

    it("should throw for error result", () => {
      const result = err("something went wrong");
      expect(() => unwrap(result)).toThrow("something went wrong");
    });

    it("should convert error to string when throwing", () => {
      const result = err({ code: 500 });
      expect(() => unwrap(result)).toThrow("[object Object]");
    });
  });

  describe("unwrapOr", () => {
    it("should return value for successful result", () => {
      const result = ok(42);
      expect(unwrapOr(result, 0)).toBe(42);
    });

    it("should return default for error result", () => {
      const result: Result<number, string> = err("error");
      expect(unwrapOr(result, 0)).toBe(0);
    });

    it("should work with complex types", () => {
      const result: Result<string[], string> = err("error");
      expect(unwrapOr(result, ["default"])).toEqual(["default"]);
    });
  });

  describe("type guards", () => {
    it("should narrow types correctly", () => {
      const result: Result<number, string> = ok(42);

      if (result.ok) {
        // TypeScript should know this is number
        const value: number = result.value;
        expect(value).toBe(42);
      } else {
        // TypeScript should know this is string
        const error: string = result.error;
        expect(error).toBeDefined();
      }
    });
  });
});
