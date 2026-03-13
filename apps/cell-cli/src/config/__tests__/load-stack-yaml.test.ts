import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { loadStackYaml } from "../load-stack-yaml.js";

describe("loadStackYaml", () => {
  test("returns null when file does not exist", () => {
    const rootDir = join(import.meta.dir, "fixtures", "stack-nonexistent");
    const result = loadStackYaml(rootDir);
    expect(result).toBeNull();
  });

  test("returns parsed object with cells and domain when file exists", () => {
    const rootDir = join(import.meta.dir, "fixtures", "stack-valid");
    const result = loadStackYaml(rootDir);
    expect(result).not.toBeNull();
    expect(result!.cells).toEqual(["sso", "agent"]);
    expect(result!.domain).toBeDefined();
    expect(result!.domain!.host).toBe("casfa.shazhou.me");
  });
});
