import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Parse .env file content into a key-value map. */
function parseEnvFile(content: string): Record<string, string> {
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
 * Load AWS_PROFILE from rootDir/.env only.
 * Returns process.env.AWS_PROFILE ?? envMap.AWS_PROFILE ?? "default".
 */
export function getAwsProfile(rootDir: string): string {
  const envPath = resolve(rootDir, ".env");
  let envMap: Record<string, string> = {};
  if (existsSync(envPath)) {
    envMap = parseEnvFile(readFileSync(envPath, "utf-8"));
  }
  return process.env.AWS_PROFILE ?? envMap.AWS_PROFILE ?? "default";
}

/**
 * Run `aws sso login --profile <profile>` with stdio inherit; exit with same code as aws.
 */
export async function awsLoginCommand(rootDir: string): Promise<void> {
  const profile = getAwsProfile(rootDir);
  const result = spawnSync("aws", ["sso", "login", "--profile", profile], {
    stdio: "inherit",
  });
  process.exit(result.status ?? 1);
}

/**
 * Run `aws sso logout --profile <profile>` with stdio inherit; exit with same code as aws.
 */
export async function awsLogoutCommand(rootDir: string): Promise<void> {
  const profile = getAwsProfile(rootDir);
  const result = spawnSync("aws", ["sso", "logout", "--profile", profile], {
    stdio: "inherit",
  });
  process.exit(result.status ?? 1);
}
