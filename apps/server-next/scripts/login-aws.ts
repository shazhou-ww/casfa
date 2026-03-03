/**
 * Run `aws sso login` using AWS_PROFILE from .env (current directory and parents up to repo root).
 * Usage: bun run login:aws
 */
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const CWD = process.cwd();

function findRepoRoot(startDir: string): string {
  let dir = resolve(startDir);
  for (;;) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = resolve(dir, "..");
    if (parent === dir) return dir;
    dir = parent;
  }
}

function parseEnvFile(filePath: string): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const text = readFileSync(filePath, "utf-8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
        val = val.slice(1, -1);
      out[key] = val;
    }
  } catch {
    // ignore
  }
  return out;
}

function loadAwsProfile(): string | undefined {
  const repoRoot = findRepoRoot(CWD);
  let d = resolve(CWD);
  const dirs: string[] = [];
  while (true) {
    dirs.push(d);
    if (d === repoRoot) break;
    const parent = resolve(d, "..");
    if (parent === d) break;
    d = parent;
  }
  for (const dir of dirs) {
    const envPath = join(dir, ".env");
    if (existsSync(envPath)) {
      const env = parseEnvFile(envPath);
      if (env.AWS_PROFILE != null && env.AWS_PROFILE.trim() !== "")
        return env.AWS_PROFILE.trim();
    }
  }
  return undefined;
}

const profile = loadAwsProfile();
if (!profile) {
  console.error("AWS_PROFILE not set in .env. Add AWS_PROFILE=your-profile in .env (in this directory or a parent up to repo root).");
  process.exit(1);
}

const result = spawnSync("aws", ["sso", "login", "--profile", profile], {
  stdio: "inherit",
  shell: true,
});
process.exit(result.status ?? 1);
