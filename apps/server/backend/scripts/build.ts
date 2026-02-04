#!/usr/bin/env bun
/**
 * CASFA v2 - Cross-platform Build Script
 *
 * Builds the Lambda handler with proper ESM output.
 * Works on both Windows and Unix systems.
 *
 * Usage:
 *   bun run build:backend
 */

import { existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "../..");
const srcPath = resolve(projectRoot, "backend/src/handler.ts");
const outDir = resolve(projectRoot, "backend/dist");

async function build(): Promise<void> {
  console.log("Building CASFA v2 Lambda handler...\n");

  // Ensure output directory exists
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  // Build with Bun
  const result = await Bun.build({
    entrypoints: [srcPath],
    outdir: outDir,
    format: "esm",
    target: "node",
    external: ["@aws-sdk/*"],
    naming: "[name].js",
  });

  if (!result.success) {
    console.error("Build failed:");
    for (const log of result.logs) {
      console.error(log);
    }
    process.exit(1);
  }

  // Rename to .mjs for Lambda ESM compatibility
  const jsPath = resolve(outDir, "handler.js");
  const mjsPath = resolve(outDir, "handler.mjs");

  if (existsSync(jsPath)) {
    if (existsSync(mjsPath)) {
      // Remove existing .mjs file first (for Windows compatibility)
      await Bun.write(mjsPath, ""); // Clear file
    }
    renameSync(jsPath, mjsPath);
  }

  console.log("✓ Build complete: backend/dist/handler.mjs");
}

build().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
