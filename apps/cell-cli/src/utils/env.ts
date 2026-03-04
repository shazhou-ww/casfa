import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

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
 * Load .env files from the cell directory and the monorepo root.
 * Cell-level values take precedence over root-level values.
 */
export function loadEnvFiles(cellDir: string): Record<string, string> {
  const merged: Record<string, string> = {};

  const cellEnvPath = resolve(cellDir, ".env");
  if (existsSync(cellEnvPath)) {
    const cellVars = parseEnvFile(readFileSync(cellEnvPath, "utf-8"));
    Object.assign(merged, cellVars);
  }

  let dir = dirname(resolve(cellDir));
  const root = resolve("/");
  while (dir !== root) {
    const rootEnvPath = resolve(dir, ".env");
    const pkgPath = resolve(dir, "package.json");
    if (existsSync(pkgPath) && existsSync(rootEnvPath)) {
      const rootVars = parseEnvFile(readFileSync(rootEnvPath, "utf-8"));
      for (const [k, v] of Object.entries(rootVars)) {
        if (!(k in merged)) merged[k] = v;
      }
      break;
    }
    dir = dirname(dir);
  }

  return merged;
}
