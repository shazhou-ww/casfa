import { describe, expect, test } from "bun:test";
import { generateDelegateId } from "../src/id.ts";

describe("generateDelegateId", () => {
  test("returns string starting with dlg_ and 26-char CB32 suffix", () => {
    const id = generateDelegateId();
    expect(id.startsWith("dlg_")).toBe(true);
    const suffix = id.slice(4);
    expect(suffix.length).toBe(26);
    expect(/^[0-9A-HJKMNP-TV-Z]+$/.test(suffix)).toBe(true);
  });

  test("two calls yield different ids", () => {
    const a = generateDelegateId();
    const b = generateDelegateId();
    expect(a).not.toBe(b);
  });
});
