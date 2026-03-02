/**
 * Start local-dev: serverless offline on 7101, mock auth (MOCK_JWT_SECRET).
 * Uses Docker DynamoDB (7102) and serverless-s3-local (4569).
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureTables, isDynamoDBReady } from "./create-local-tables.ts";

const HTTP_PORT = 7101;
const DYNAMODB_ENDPOINT = "http://localhost:7102";
const appRoot = process.cwd();

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

loadEnv(resolve(appRoot, ".env"));
loadEnv(resolve(appRoot, "../../.env"));

function isDockerRunning(): boolean {
  const result = spawnSync("docker", ["info"], {
    encoding: "utf-8",
    shell: true,
    stdio: "pipe",
  });
  return result.status === 0;
}

function startDockerService(serviceName: string): boolean {
  console.log(`\nStarting ${serviceName} container...`);
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
    console.log(`  Attempt ${i + 1}/${maxAttempts}...`);
    if (await isDynamoDBReady(endpoint)) {
      console.log("DynamoDB is ready!");
      return true;
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}

async function main(): Promise<void> {
  if (!isDockerRunning()) {
    console.error("Error: Docker is not running. Please start Docker and try again.");
    process.exit(1);
  }

  if (!(await isDynamoDBReady(DYNAMODB_ENDPOINT))) {
    console.log(`\nDynamoDB is not running at ${DYNAMODB_ENDPOINT}`);
    if (!startDockerService("dynamodb")) {
      console.error("Failed to start dynamodb container.");
      process.exit(1);
    }
    console.log("\nWaiting for DynamoDB to be ready...");
    if (!(await waitForDynamoDB(DYNAMODB_ENDPOINT))) {
      console.error("DynamoDB failed to start properly.");
      process.exit(1);
    }
  }

  console.log("\nEnsuring DynamoDB tables exist...");
  await ensureTables(DYNAMODB_ENDPOINT, "dev");

  const env = {
    ...process.env,
    MOCK_JWT_SECRET: process.env.MOCK_JWT_SECRET ?? "dev-mock-secret",
    DYNAMODB_ENDPOINT,
    S3_ENDPOINT: process.env.S3_ENDPOINT ?? "http://localhost:4569",
    S3_BUCKET: process.env.S3_BUCKET ?? "casfa-next-dev-blob",
  };

  spawn("bunx", ["serverless", "offline", "start", "--httpPort", String(HTTP_PORT)], {
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
