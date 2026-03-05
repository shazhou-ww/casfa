import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { loadEnvFiles } from "../utils/env.js";

function getProfile(options?: { cellDir?: string }): string {
  const cellDir = resolve(options?.cellDir ?? process.cwd());
  const envMap = loadEnvFiles(cellDir);
  return envMap.AWS_PROFILE ?? process.env.AWS_PROFILE ?? "default";
}

/**
 * Run `aws sso login` using AWS_PROFILE from .env.
 * Usage: cell aws login
 */
export async function awsLoginCommand(options?: { cellDir?: string }): Promise<void> {
  const profile = getProfile(options);
  const result = spawnSync("aws", ["sso", "login", "--profile", profile], {
    stdio: "inherit",
    shell: true,
  });
  process.exit(result.status ?? 1);
}

/**
 * Run `aws sso logout` using AWS_PROFILE from .env.
 * Usage: cell aws logout
 */
export async function awsLogoutCommand(options?: { cellDir?: string }): Promise<void> {
  const profile = getProfile(options);
  const result = spawnSync("aws", ["sso", "logout", "--profile", profile], {
    stdio: "inherit",
    shell: true,
  });
  process.exit(result.status ?? 1);
}
