#!/usr/bin/env bun
/**
 * CASFA v2 Integration Test Runner
 *
 * This script:
 * 1. Automatically starts the dynamodb-test container (port 8701, in-memory)
 * 2. Creates test tables
 * 3. Runs e2e tests
 * 4. Cleans up (tables and file storage)
 * 5. Automatically stops and removes the dynamodb-test container
 *
 * No prerequisites needed - the container is managed automatically!
 *
 * Usage:
 *   bun run backend/scripts/integration-test.ts
 *   bun run backend/scripts/integration-test.ts --no-cleanup   # Skip cleanup (for debugging)
 *   bun run backend/scripts/integration-test.ts --skip-tables  # Skip table creation (tables already exist)
 *   bun run backend/scripts/integration-test.ts --keep-container # Don't stop container after tests
 *
 * Environment variables (defaults for testing):
 *   DYNAMODB_ENDPOINT=http://localhost:8701
 *   STORAGE_TYPE=memory
 *   MOCK_JWT_SECRET=test-secret-key-for-e2e
 */

import { spawn, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import {
  createAllTables,
  createClient,
  deleteAllTables,
  listTables,
} from "./create-local-tables.ts";

// ============================================================================
// Configuration
// ============================================================================

// Use port 8701 for test DynamoDB (in-memory, isolated)
const DYNAMODB_ENDPOINT = process.env.DYNAMODB_ENDPOINT ?? "http://localhost:8701";
const STORAGE_TYPE = process.env.STORAGE_TYPE ?? "memory";
const STORAGE_FS_PATH = process.env.STORAGE_FS_PATH ?? "./test-storage";
const MOCK_JWT_SECRET = process.env.MOCK_JWT_SECRET ?? "test-secret-key-for-e2e";

const args = process.argv.slice(2);
const shouldCleanup = !args.includes("--no-cleanup"); // Default: cleanup
const shouldSkipTableCreation = args.includes("--skip-tables");
const shouldKeepContainer = args.includes("--keep-container");

// Container name
const CONTAINER_NAME = "dynamodb-test";

// ============================================================================
// Docker Container Management
// ============================================================================

/**
 * Check if Docker daemon is running
 */
function isDockerRunning(): boolean {
  const result = spawnSync("docker", ["info"], {
    encoding: "utf-8",
    shell: true,
    stdio: "pipe",
  });
  return result.status === 0;
}

function isContainerRunning(): boolean {
  const result = spawnSync(
    "docker",
    ["ps", "--filter", `name=${CONTAINER_NAME}`, "--format", "{{.Names}}"],
    {
      encoding: "utf-8",
      shell: true,
    }
  );
  return result.stdout?.trim() === CONTAINER_NAME;
}

function startContainer(): boolean {
  console.log(`Starting ${CONTAINER_NAME} container...`);

  // Try docker compose up first
  const result = spawnSync("docker", ["compose", "up", "-d", CONTAINER_NAME], {
    cwd: process.cwd().replace(/[/\\]apps[/\\]casfa-v2$/, ""), // Go to repo root
    encoding: "utf-8",
    shell: true,
    stdio: "inherit",
  });

  return result.status === 0;
}

function stopAndRemoveContainer(): void {
  console.log(`Stopping and removing ${CONTAINER_NAME} container...`);

  const repoRoot = process.cwd().replace(/[/\\]apps[/\\]casfa-v2$/, "");

  // Stop the container
  spawnSync("docker", ["compose", "stop", CONTAINER_NAME], {
    cwd: repoRoot,
    encoding: "utf-8",
    shell: true,
    stdio: "inherit",
  });

  // Remove the container
  spawnSync("docker", ["compose", "rm", "-f", CONTAINER_NAME], {
    cwd: repoRoot,
    encoding: "utf-8",
    shell: true,
    stdio: "inherit",
  });
}

// Create DynamoDB client for the test endpoint
const dbClient = createClient(DYNAMODB_ENDPOINT);

// ============================================================================
// Helpers
// ============================================================================

async function checkDynamoDBConnection(): Promise<boolean> {
  try {
    await listTables(dbClient);
    return true;
  } catch (_error) {
    return false;
  }
}

async function waitForDynamoDB(maxAttempts = 10, delayMs = 1000): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    console.log(`Checking DynamoDB connection... (attempt ${i + 1}/${maxAttempts})`);
    if (await checkDynamoDBConnection()) {
      console.log("DynamoDB is ready!\n");
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

function runTests(): Promise<number> {
  return new Promise((resolve) => {
    console.log("Running e2e tests...\n");

    const testProcess = spawn("bun", ["test", "backend/e2e"], {
      cwd: process.cwd(),
      stdio: "inherit",
      env: {
        ...process.env,
        DYNAMODB_ENDPOINT,
        STORAGE_TYPE,
        STORAGE_FS_PATH,
        MOCK_JWT_SECRET,
      },
      shell: true,
    });

    testProcess.on("close", (code) => {
      resolve(code ?? 1);
    });

    testProcess.on("error", (err) => {
      console.error("Failed to run tests:", err);
      resolve(1);
    });
  });
}

function cleanupFileStorage(): void {
  if (STORAGE_TYPE === "fs" && STORAGE_FS_PATH) {
    try {
      rmSync(STORAGE_FS_PATH, { recursive: true, force: true });
      console.log(`Cleaned up file storage: ${STORAGE_FS_PATH}`);
    } catch {
      // Ignore cleanup errors
    }
  }
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  let containerStartedByUs = false;
  let exitCode = 1;

  try {
    console.log("=".repeat(60));
    console.log("CASFA v2 Integration Test Runner");
    console.log("=".repeat(60));
    console.log();

    // Check if Docker is running
    if (!isDockerRunning()) {
      console.error("Error: Docker is not running.");
      console.error("Please start Docker Desktop and try again.");
      process.exit(1);
    }

    console.log("Configuration:");
    console.log(`  DYNAMODB_ENDPOINT: ${DYNAMODB_ENDPOINT}`);
    console.log(`  STORAGE_TYPE: ${STORAGE_TYPE}`);
    console.log(`  MOCK_JWT_SECRET: ${MOCK_JWT_SECRET ? "(set)" : "(not set)"}`);
    if (STORAGE_TYPE === "fs") {
      console.log(`  STORAGE_FS_PATH: ${STORAGE_FS_PATH}`);
    }
    console.log();

    // Check if container is already running
    if (isContainerRunning()) {
      console.log(`Container ${CONTAINER_NAME} is already running.`);
    } else {
      // Start the container
      if (!startContainer()) {
        console.error(`\nError: Failed to start ${CONTAINER_NAME} container!`);
        console.error(
          "Make sure Docker is running and docker-compose.yml is configured correctly."
        );
        process.exit(1);
      }
      containerStartedByUs = true;
    }

    // Wait for DynamoDB to be ready
    console.log("\nWaiting for DynamoDB to be ready...");
    const isReady = await waitForDynamoDB();

    if (!isReady) {
      console.error("\nError: DynamoDB is not responding!");
      process.exit(1);
    }

    // Create tables
    if (!shouldSkipTableCreation) {
      console.log("Creating test tables...");
      await createAllTables(dbClient);
      console.log();
    }

    // Run tests
    exitCode = await runTests();

    // Cleanup tables and storage
    if (shouldCleanup) {
      console.log("\nCleaning up...");
      await deleteAllTables(dbClient);
      cleanupFileStorage();
    }

    console.log();
    console.log("=".repeat(60));
    if (exitCode === 0) {
      console.log("All tests passed!");
    } else {
      console.log(`Tests failed with exit code: ${exitCode}`);
    }
    console.log("=".repeat(60));
  } finally {
    // Always stop and remove container if we started it (unless --keep-container)
    if (containerStartedByUs && !shouldKeepContainer) {
      console.log();
      stopAndRemoveContainer();
    }
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error("Integration test runner failed:", err);
  // Try to cleanup container on error
  if (!shouldKeepContainer) {
    try {
      stopAndRemoveContainer();
    } catch {
      // Ignore cleanup errors
    }
  }
  process.exit(1);
});
