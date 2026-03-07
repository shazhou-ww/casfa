import { describe, expect, test, mock, beforeEach } from "bun:test";
import { maskSecret } from "../shared.js";

describe("maskSecret", () => {
  test("short secrets are fully masked", () => {
    expect(maskSecret("abc")).toBe("****");
    expect(maskSecret("12345678")).toBe("****");
  });

  test("longer secrets show first 4 and last 4 chars", () => {
    expect(maskSecret("123456789")).toBe("1234...6789");
    expect(maskSecret("abcdefghijklmnop")).toBe("abcd...mnop");
  });

  test("empty string returns mask", () => {
    expect(maskSecret("")).toBe("****");
  });
});
