import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { loadOtaviaYaml } from "../config/load-otavia-yaml.js";
import { loadCellConfig } from "../config/load-cell-yaml.js";
import { mergeParams } from "../config/resolve-params.js";
import { isEnvRef, isSecretRef } from "../config/cell-yaml-schema.js";
import { loadEnvForCell } from "../utils/env.js";

/**
 * Collect all env var names referenced by !Env and !Secret in a params tree.
 */
function collectRefKeys(params: Record<string, unknown>): string[] {
  const keys = new Set<string>();

  function walk(value: unknown): void {
    if (value === null || value === undefined) return;
    if (isEnvRef(value)) {
      keys.add(value.env);
      return;
    }
    if (isSecretRef(value)) {
      keys.add(value.secret);
      return;
    }
    if (typeof value === "object" && !Array.isArray(value)) {
      for (const v of Object.values(value as Record<string, unknown>)) {
        walk(v);
      }
    }
  }

  for (const v of Object.values(params)) {
    walk(v);
  }
  return [...keys];
}

/**
 * Setup command: check bun, otavia.yaml, each cell's cell.yaml; copy .env.example → .env when missing;
 * optionally warn on missing !Env/!Secret in params (do not block).
 * options.tunnel is ignored in this task.
 */
export async function setupCommand(
  rootDir: string,
  _options?: { tunnel?: boolean }
): Promise<void> {
  // 1. Check bun is available
  try {
    const proc = await Bun.spawn(["bun", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exit = await proc.exited;
    if (exit !== 0) {
      console.error("bun --version failed (exit code ", exit, ")");
      throw new Error("bun is not available");
    }
  } catch (err) {
    if (err instanceof Error && err.message === "bun is not available") throw err;
    console.error("Failed to run bun --version:", err);
    throw new Error("bun is not available");
  }

  // 2. Load otavia.yaml (rethrow on error)
  const otavia = loadOtaviaYaml(rootDir);

  const appsDir = path.join(rootDir, "apps");

  for (const cellId of otavia.cells) {
    const cellYamlPath = path.join(appsDir, cellId, "cell.yaml");
    if (!existsSync(cellYamlPath)) {
      console.warn(`Warning: cell "${cellId}" not found (missing ${cellYamlPath}), skipping.`);
      continue;
    }

    const cellDir = path.join(appsDir, cellId);
    const envPath = path.join(cellDir, ".env");
    const envExamplePath = path.join(cellDir, ".env.example");

    if (existsSync(envPath)) {
      console.log(`Skip .env: already exists (apps/${cellId}/.env)`);
    } else if (existsSync(envExamplePath)) {
      copyFileSync(envExamplePath, envPath);
      console.log(`Created .env from .env.example (apps/${cellId}/.env)`);
    } else {
      console.log(`Skip .env: no .env.example (apps/${cellId})`);
    }

    // Optional: warn on missing !Env/!Secret in params
    try {
      const cellConfig = loadCellConfig(cellDir);
      const merged = mergeParams(
        otavia.params as Record<string, unknown> | undefined,
        cellConfig.params as Record<string, unknown> | undefined
      );
      const refKeys = collectRefKeys(merged);
      if (refKeys.length === 0) continue;

      const env = loadEnvForCell(rootDir, cellId);
      const missing = refKeys.filter((k) => env[k] === undefined || env[k] === "");
      if (missing.length > 0) {
        console.warn(`Warning: missing env for cell ${cellId}: ${missing.join(", ")}`);
      }
    } catch {
      // Do not block: if cell.yaml fails to load or merge fails, skip warning
    }
  }
}
