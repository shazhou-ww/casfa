import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("dist bundle uses production JSX runtime", () => {
  const distPath = resolve(import.meta.dir, "../dist/index.js");
  const bundle = readFileSync(distPath, "utf8");

  expect(bundle.includes("jsxDEV")).toBeFalse();
  expect(bundle.includes("react/jsx-runtime")).toBeTrue();
});
