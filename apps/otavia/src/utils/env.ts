import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Parse .env file content into a key-value map. */
export function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

/**
 * Load .env files: root .env, then apps/<cellId>/.env, then apps/<cellId>/.env.local.
 * Later overrides earlier.
 * When stage is "cloud", .env.local is skipped (no local overrides for deploy).
 */
export function loadEnvForCell(
  rootDir: string,
  cellId: string,
  options?: { stage?: string }
): Record<string, string> {
  const merged: Record<string, string> = {};
  const rootEnv = resolve(rootDir, ".env");
  if (existsSync(rootEnv)) {
    Object.assign(merged, parseEnvFile(readFileSync(rootEnv, "utf-8")));
  }
  const cellDir = resolve(rootDir, "apps", cellId);
  const cellEnv = resolve(cellDir, ".env");
  if (existsSync(cellEnv)) {
    Object.assign(merged, parseEnvFile(readFileSync(cellEnv, "utf-8")));
  }
  if (options?.stage !== "cloud") {
    const cellEnvLocal = resolve(cellDir, ".env.local");
    if (existsSync(cellEnvLocal)) {
      Object.assign(merged, parseEnvFile(readFileSync(cellEnvLocal, "utf-8")));
    }
  }
  return merged;
}
