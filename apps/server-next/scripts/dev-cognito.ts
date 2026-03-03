/**
 * Start local-dev with Cognito auth: Bun HTTP server (same Hono app as Lambda) on 7101.
 * Uses Docker DynamoDB (7102) and MinIO S3 (7104). Automatically runs dev-setup (DynamoDB + S3 bucket).
 */
import * as net from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isDynamoDBReady } from "./create-local-tables.ts";
import { runSetup } from "./dev-setup.ts";
import { ensureS3Bucket } from "./ensure-s3-bucket.ts";

const HTTP_PORT = 7101;
const S3_PORT = 7104;
const S3_ENDPOINT = "http://localhost:" + S3_PORT;
const DYNAMODB_ENDPOINT = "http://localhost:7102";
const S3_BUCKET_DEV = "casfa-next-dev-blob";
// Resolve app root from script location so docker compose finds docker-compose.yml even when run from repo root
const appRoot = resolve(import.meta.dir, "..");
const rootEnvPath = resolve(appRoot, "../../.env");

function loadEnv(filePath: string): void {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (process.env[key] === undefined || process.env[key] === "") {
      process.env[key] = value;
    }
  }
}

loadEnv(rootEnvPath);
loadEnv(resolve(appRoot, ".env"));

function ensureAwsSsoLogin(): void {
  const profile = process.env.AWS_PROFILE?.trim();
  if (!profile) {
    console.error(
      "dev:cognito requires AWS_PROFILE. Set AWS_PROFILE in .env (in apps/server-next or repo root), then run: bun run login:aws"
    );
    process.exit(1);
  }
  const checkResult = spawnSync("aws", ["sts", "get-caller-identity", "--profile", profile], {
    encoding: "utf-8",
    shell: true,
    stdio: "pipe",
  });
  if (checkResult.status === 0) return;
  const loginResult = spawnSync("bun", ["run", "login:aws"], {
    cwd: appRoot,
    stdio: "inherit",
    shell: true,
  });
  if (loginResult.status !== 0) {
    console.error("login:aws failed. Please run: bun run login:aws");
    process.exit(1);
  }
}

function isDockerRunning(): boolean {
  const result = spawnSync("docker", ["info"], {
    encoding: "utf-8",
    shell: true,
    stdio: "pipe",
  });
  return result.status === 0;
}

function startDockerService(serviceName: string): boolean {
  const result = spawnSync("docker", ["compose", "up", "-d", serviceName], {
    cwd: appRoot,
    encoding: "utf-8",
    shell: true,
    stdio: "inherit",
  });
  return result.status === 0;
}

async function waitForDynamoDB(
  endpoint: string,
  maxAttempts = 10,
  delayMs = 1000
): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    if (await isDynamoDBReady(endpoint)) return true;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}

function isPortOpen(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const onErr = () => {
      socket.destroy();
      resolve(false);
    };
    socket.setTimeout(1000);
    socket.once("error", onErr);
    socket.once("timeout", onErr);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.connect(port, host);
  });
}

async function waitForPort(
  port: number,
  label: string,
  maxAttempts = 30,
  delayMs = 1000
): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    if (await isPortOpen("127.0.0.1", port)) return true;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}

async function main(): Promise<void> {
  ensureAwsSsoLogin();

  if (!isDockerRunning()) {
    console.error("Error: Docker is not running. Please start Docker and try again.");
    process.exit(1);
  }

  if (!(await isDynamoDBReady(DYNAMODB_ENDPOINT))) {
    if (!startDockerService("dynamodb")) {
      console.error("Failed to start dynamodb container.");
      process.exit(1);
    }
    if (!(await waitForDynamoDB(DYNAMODB_ENDPOINT))) {
      console.error("DynamoDB failed to start properly.");
      process.exit(1);
    }
  }

  await runSetup("dev");

  if (!(await isPortOpen("127.0.0.1", S3_PORT))) {
    if (!startDockerService("minio")) {
      console.error("Failed to start minio container.");
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 3000));
    if (!(await waitForPort(S3_PORT, "MinIO (S3)", 60, 1000))) {
      console.error("MinIO did not become ready in time. Run: docker compose ps && docker compose logs minio");
      process.exit(1);
    }
  }

  await ensureS3Bucket(S3_ENDPOINT, S3_BUCKET_DEV);

  const env = {
    ...process.env,
    PORT: String(HTTP_PORT),
    DYNAMODB_ENDPOINT,
    S3_ENDPOINT: process.env.S3_ENDPOINT ?? S3_ENDPOINT,
    S3_BUCKET: process.env.S3_BUCKET ?? S3_BUCKET_DEV,
  };

  spawn("bun", ["run", "backend/index.ts"], {
    cwd: appRoot,
    env,
    stdio: "inherit",
    shell: true,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
