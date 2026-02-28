import { describe, expect, test } from "bun:test";
import type { RealmError } from "../src/errors.ts";
import { isRealmError } from "../src/errors.ts";

describe("RealmError", () => {
  test("has expected error codes", () => {
    const codes = ["NotFound", "InvalidPath", "CommitConflict", "NoRoot"] as const;
    for (const code of codes) {
      const e: RealmError = { code, message: "test" };
      expect(e.code).toBe(code);
      expect(isRealmError(e)).toBe(true);
    }
  });

  test("isRealmError returns true for RealmError", () => {
    expect(isRealmError({ code: "NotFound" })).toBe(true);
    expect(isRealmError({ code: "CommitConflict", message: "x" })).toBe(true);
  });

  test("isRealmError returns false for non-RealmError", () => {
    expect(isRealmError(new Error("x"))).toBe(false);
    expect(isRealmError(null)).toBe(false);
    expect(isRealmError({ code: "Other" })).toBe(false);
  });
});
