#!/usr/bin/env bun
/**
 * CASFA v2 - Development Environment Setup
 *
 * One-command setup for local development:
 * 1. Checks if DynamoDB Local is running
 * 2. Creates required tables if they don't exist
 * 3. Copies .env.example to .env if needed
 *
 * Usage:
 *   bun run dev:setup
 */

import { copyFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DynamoDBClient, ListTablesCommand } from "@aws-sdk/client-dynamodb";
import { createAllTables, listTables } from "./create-local-tables.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "../..");

const DYNAMODB_ENDPOINT = process.env.DYNAMODB_ENDPOINT ?? "http://localhost:8700";
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 1000;

/**
 * Check if DynamoDB Local is running
 */
async function waitForDynamoDB(): Promise<boolean> {
  const client = new DynamoDBClient({
    region: "us-east-1",
    endpoint: DYNAMODB_ENDPOINT,
    credentials: {
      accessKeyId: "local",
      secretAccessKey: "local",
    },
  });

  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      await client.send(new ListTablesCommand({}));
      return true;
    } catch (_err) {
      if (i < MAX_RETRIES - 1) {
        console.log(`Waiting for DynamoDB at ${DYNAMODB_ENDPOINT}... (${i + 1}/${MAX_RETRIES})`);
        await Bun.sleep(RETRY_DELAY_MS);
      }
    }
  }
  return false;
}

/**
 * Setup .env file if it doesn't exist
 */
function setupEnvFile(): void {
  const envPath = resolve(projectRoot, ".env");
  const envExamplePath = resolve(projectRoot, ".env.example");

  if (!existsSync(envPath) && existsSync(envExamplePath)) {
    copyFileSync(envExamplePath, envPath);
    console.log("✓ Created .env from .env.example");
  } else if (existsSync(envPath)) {
    console.log("✓ .env file already exists");
  }
}

/**
 * Main setup function
 */
async function main(): Promise<void> {
  console.log("🚀 CASFA v2 - Development Setup\n");

  // Step 1: Setup .env file
  setupEnvFile();

  // Step 2: Check DynamoDB connection
  console.log(`\nChecking DynamoDB at ${DYNAMODB_ENDPOINT}...`);
  const isRunning = await waitForDynamoDB();

  if (!isRunning) {
    console.error("\n❌ DynamoDB Local is not running!");
    console.error("   Start it with: docker compose up -d dynamodb");
    console.error("   Then run this setup again: bun run dev:setup");
    process.exit(1);
  }
  console.log("✓ DynamoDB Local is running");

  // Step 3: Check/create tables
  console.log("\nChecking DynamoDB tables...");
  const existingTables = await listTables();
  const requiredTables = ["cas-tokens", "cas-realm", "cas-refcount", "cas-usage"];
  const missingTables = requiredTables.filter((t) => !existingTables.includes(t));

  if (missingTables.length > 0) {
    console.log(`Creating missing tables: ${missingTables.join(", ")}`);
    await createAllTables();
  } else {
    console.log("✓ All required tables exist");
  }

  // Done
  console.log("\n✅ Development environment ready!");
  console.log("   Start the server with: bun run dev");
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
