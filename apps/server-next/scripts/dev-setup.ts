#!/usr/bin/env bun
/**
 * server-next - Development environment setup
 *
 * One-command setup for local development:
 * 1. Optionally copy .env.example to .env if missing
 * 2. Check if DynamoDB Local (Docker) is running
 * 3. Create required tables if they don't exist
 *
 * Usage:
 *   bun run dev:setup                    # dev @ 7102
 *   bun run dev:setup -- --stage local-test   # local-test @ 7112
 *
 * bun run dev / dev:cognito / dev:test run this setup automatically after starting Docker.
 */
import { copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { ensureTables, isDynamoDBReady } from "./create-local-tables.ts";

const appRoot = process.cwd();
const MAX_RETRIES = 10;
const RETRY_DELAY_MS = 1000;

function parseStage(): "dev" | "local-test" {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--stage" && args[i + 1]) {
      const s = (args[i + 1] as string).toLowerCase();
      if (s === "local-test") return "local-test";
      return "dev";
    }
  }
  return (process.env.STAGE?.toLowerCase() === "local-test" ? "local-test" : "dev") as
    | "dev"
    | "local-test";
}

function getEndpoint(stage: "dev" | "local-test"): string {
  if (process.env.DYNAMODB_ENDPOINT) return process.env.DYNAMODB_ENDPOINT;
  return stage === "local-test" ? "http://localhost:7112" : "http://localhost:7102";
}

function getContainerName(stage: "dev" | "local-test"): string {
  return stage === "local-test" ? "dynamodb-test" : "dynamodb";
}

/**
 * Copy .env.example to .env if .env does not exist
 */
function setupEnvFile(): void {
  const envPath = resolve(appRoot, ".env");
  const examplePath = resolve(appRoot, ".env.example");
  if (!existsSync(envPath) && existsSync(examplePath)) {
    copyFileSync(examplePath, envPath);
  }
}

/**
 * Wait for DynamoDB to become reachable
 */
async function waitForDynamoDB(endpoint: string, maxAttempts = MAX_RETRIES): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    if (await isDynamoDBReady(endpoint)) return true;
    if (i < maxAttempts - 1) await Bun.sleep(RETRY_DELAY_MS);
  }
  return false;
}

/**
 * Check and initialize DynamoDB: ensure endpoint is reachable and tables exist.
 * Exported for use by dev.ts / dev-test.ts after they have started Docker.
 * Assumes DynamoDB is already running (caller starts Docker and waits if needed).
 */
export async function runSetup(stage: "dev" | "local-test"): Promise<void> {
  const endpoint = getEndpoint(stage);
  await ensureTables(endpoint, stage);
}

/**
 * CLI entry: setup .env, wait for DynamoDB, then create tables.
 */
async function main(): Promise<void> {
  const stage = parseStage();
  const endpoint = getEndpoint(stage);
  const container = getContainerName(stage);

  setupEnvFile();
  const isRunning = await waitForDynamoDB(endpoint);

  if (!isRunning) {
    console.error(
      "DynamoDB Local is not running. Start it with: docker compose up -d " +
        container +
        ", then run bun run dev:setup"
    );
    process.exit(1);
  }
  await runSetup(stage);
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
