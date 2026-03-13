import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

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

type EnvStage = "dev" | "test" | "deploy";

function normalizeStage(stage?: string): EnvStage | undefined {
  if (!stage) return undefined;
  if (stage === "cloud") return "deploy";
  if (stage === "dev" || stage === "test" || stage === "deploy") return stage;
  return undefined;
}

function resolveCellDir(rootDir: string, cellIdOrDir: string): string {
  return isAbsolute(cellIdOrDir) ? cellIdOrDir : resolve(rootDir, "apps", cellIdOrDir);
}

function loadEnvFile(path: string, target: Record<string, string>): void {
  if (!existsSync(path)) return;
  Object.assign(target, parseEnvFile(readFileSync(path, "utf-8")));
}

/**
 * Load layered env files with stage overrides.
 * Order (later overrides earlier):
 *   1) root: .env, .env.<stage>, .env.local (dev/default only)
 *   2) cell: .env, .env.<stage>, .env.local (dev/default only)
 */
export function loadEnvForCell(
  rootDir: string,
  cellIdOrDir: string,
  options?: { stage?: string }
): Record<string, string> {
  const merged: Record<string, string> = {};
  const stage = normalizeStage(options?.stage);
  const useLocalOverrides = stage !== "deploy" && stage !== "test";
  const rootEnv = resolve(rootDir, ".env");
  const rootStageEnv = stage ? resolve(rootDir, `.env.${stage}`) : "";
  const rootEnvLocal = resolve(rootDir, ".env.local");
  const cellDir = resolveCellDir(rootDir, cellIdOrDir);
  const cellEnv = resolve(cellDir, ".env");
  const cellStageEnv = stage ? resolve(cellDir, `.env.${stage}`) : "";
  const cellEnvLocal = resolve(cellDir, ".env.local");

  loadEnvFile(rootEnv, merged);
  if (rootStageEnv) loadEnvFile(rootStageEnv, merged);
  if (useLocalOverrides) loadEnvFile(rootEnvLocal, merged);

  loadEnvFile(cellEnv, merged);
  if (cellStageEnv) loadEnvFile(cellStageEnv, merged);
  if (useLocalOverrides) loadEnvFile(cellEnvLocal, merged);

  return merged;
}
