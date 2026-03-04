import { describe, expect, test } from "bun:test";
import { parseEnvFile } from "../env.js";

describe("parseEnvFile", () => {
  test("simple key=value", () => {
    expect(parseEnvFile("FOO=bar")).toEqual({ FOO: "bar" });
  });

  test("skips comments and blank lines", () => {
    const result = parseEnvFile(`
# this is a comment
FOO=bar

# another comment
BAZ=qux
    `);
    expect(result).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  test("double-quoted values strip quotes", () => {
    expect(parseEnvFile('KEY="value"')).toEqual({ KEY: "value" });
  });

  test("single-quoted values strip quotes", () => {
    expect(parseEnvFile("KEY='value'")).toEqual({ KEY: "value" });
  });

  test("values with = sign are preserved", () => {
    expect(parseEnvFile("KEY=a=b")).toEqual({ KEY: "a=b" });
  });

  test("whitespace trimming on key and value", () => {
    expect(parseEnvFile("  KEY  =  value  ")).toEqual({ KEY: "value" });
  });

  test("empty value", () => {
    expect(parseEnvFile("KEY=")).toEqual({ KEY: "" });
  });

  test("multiple entries", () => {
    const result = parseEnvFile(`
A=1
B=2
C=3
    `);
    expect(result).toEqual({ A: "1", B: "2", C: "3" });
  });
});
