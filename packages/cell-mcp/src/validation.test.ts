import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { formatToolValidationError } from "./validation.js";

describe("formatToolValidationError", () => {
  const schema = z.object({ required: z.string(), num: z.number() });

  it("includes tool name and field messages", () => {
    const result = schema.safeParse({});
    expect(result.success).toBe(false);
    if (result.success) return;
    const text = formatToolValidationError("my_tool", result.error);
    expect(text).toContain("my_tool");
    expect(text).toContain("required");
    expect(text).toContain("num");
  });
});
