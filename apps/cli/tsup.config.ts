import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  minify: false,
  target: "es2022",
  outDir: "dist",
  // Shebang is in src/cli.ts (#!/usr/bin/env bun), no need to add via banner
  // External workspace dependencies
  skipNodeModulesBundle: true,
  external: [/^@casfa\/.*/],
});
