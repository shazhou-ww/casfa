/**
 * Start local-dev with Cognito auth: serverless offline on 7101.
 * Uses serverless-dynamodb-local (port 7102) and serverless-s3-local (port 4569).
 * Run: sls dynamodb install  (once) then bun run dev:cognito.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const PORT = 7101;
const appRoot = process.cwd();
const rootEnvPath = resolve(appRoot, "../../.env");

if (existsSync(rootEnvPath)) {
  const content = readFileSync(rootEnvPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (process.env[key] === undefined || process.env[key] === "") {
      process.env[key] = value;
    }
  }
}

Bun.spawn(
  ["bunx", "serverless", "offline", "start", "--httpPort", String(PORT)],
  {
    cwd: appRoot,
    env: {
      ...process.env,
      DYNAMODB_ENDPOINT: process.env.DYNAMODB_ENDPOINT ?? "http://localhost:7102",
      S3_ENDPOINT: process.env.S3_ENDPOINT ?? "http://localhost:4569",
      S3_BUCKET: process.env.S3_BUCKET ?? "casfa-next-dev-blob",
    },
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  }
);
