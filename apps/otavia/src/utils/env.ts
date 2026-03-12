import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Parse .env file content into a key-value map.
 * Skips comments and empty lines; strips optional surrounding quotes from values.
 */
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
 * Load .env for a cell: merge in order (later overrides):
 * - rootDir/.env (if exists)
 * - rootDir/apps/<cellId>/.env (if exists)
 * - rootDir/apps/<cellId>/.env.local (if exists)
 */
export function loadEnvForCell(rootDir: string, cellId: string): Record<string, string> {
  const merged: Record<string, string> = {};

  const rootEnvPath = join(rootDir, ".env");
  if (existsSync(rootEnvPath)) {
    Object.assign(merged, parseEnvFile(readFileSync(rootEnvPath, "utf-8")));
  }

  const cellDir = join(rootDir, "apps", cellId);
  const cellEnvPath = join(cellDir, ".env");
  if (existsSync(cellEnvPath)) {
    Object.assign(merged, parseEnvFile(readFileSync(cellEnvPath, "utf-8")));
  }

  const cellEnvLocalPath = join(cellDir, ".env.local");
  if (existsSync(cellEnvLocalPath)) {
    Object.assign(merged, parseEnvFile(readFileSync(cellEnvLocalPath, "utf-8")));
  }

  return merged;
}
