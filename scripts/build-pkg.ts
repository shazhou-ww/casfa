#!/usr/bin/env bun
/**
 * Shared package build script: JS (bun build) + DTS (tsc).
 *
 * Usage — run from any package directory:
 *   bun ../../scripts/build-pkg.ts
 *
 * Entry points are read from package.json `exports.*.bun`.
 * Extra bun-build flags can be specified via `buildConfig.bunFlags` in package.json.
 */
import { rmSync, unlinkSync, writeFileSync } from "node:fs";

const pkg = await Bun.file("package.json").json();

// ── Collect entry points from exports.*.bun ──────────────────────────
const entries: string[] = pkg.buildConfig?.entry ?? [];
if (!entries.length && pkg.exports) {
  for (const value of Object.values<Record<string, string> | string>(pkg.exports)) {
    const src = typeof value === "string" ? value : value?.bun;
    if (typeof src === "string" && src.startsWith("./src/")) entries.push(src);
  }
}
if (!entries.length) entries.push("./src/index.ts");

// ── Optional extra bun build flags (e.g. --target=browser --production) ──
const extraFlags: string[] = pkg.buildConfig?.bunFlags ?? [];

// ── 1. Clean ─────────────────────────────────────────────────────────
rmSync("dist", { recursive: true, force: true });

// ── 2. Bundle JS via bun build ───────────────────────────────────────
const jsResult = Bun.spawnSync(
  [
    "bun",
    "build",
    ...entries,
    "--outdir",
    "dist",
    "--format",
    "esm",
    "--sourcemap=external",
    "--packages=external",
    ...extraFlags,
  ],
  { stdio: ["inherit", "inherit", "inherit"] }
);
if (jsResult.exitCode) process.exit(jsResult.exitCode);

// ── 3. Generate .d.ts via tsc ────────────────────────────────────────
// Temp tsconfig that overrides noEmit → declaration-only output.
const buildTsconfig = "tsconfig.build.json";
writeFileSync(
  buildTsconfig,
  JSON.stringify({
    extends: "./tsconfig.json",
    compilerOptions: {
      noEmit: false,
      declaration: true,
      emitDeclarationOnly: true,
      declarationMap: true,
      outDir: "dist",
      rootDir: "src",
      // Rewrite ./foo.ts → ./foo.js in emitted declarations
      rewriteRelativeImportExtensions: true,
      // Clear workspace paths so tsc resolves @casfa/* via exports.types
      // (the dist .d.ts files) instead of following source paths.
      paths: {},
    },
    include: ["src/**/*"],
    exclude: ["src/**/*.test.ts", "src/**/*.spec.ts", "src/**/*.test.tsx"],
  })
);
try {
  const dtsResult = Bun.spawnSync(["bunx", "tsc", "-p", buildTsconfig, "--noCheck"], {
    stdio: ["inherit", "inherit", "inherit"],
  });
  if (dtsResult.exitCode) process.exit(dtsResult.exitCode);
} finally {
  try {
    unlinkSync(buildTsconfig);
  } catch {}
}
