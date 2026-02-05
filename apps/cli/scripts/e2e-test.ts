#!/usr/bin/env bun
/**
 * CLI E2E Test Runner
 *
 * This script:
 * 1. Starts DynamoDB Local container if not running
 * 2. Creates test tables
 * 3. Runs CLI e2e tests
 * 4. Cleans up (tables)
 *
 * Usage:
 *   bun run scripts/e2e-test.ts
 *   bun run scripts/e2e-test.ts --no-cleanup      # Skip cleanup (for debugging)
 *   bun run scripts/e2e-test.ts --skip-tables     # Skip table creation (tables already exist)
 *   bun run scripts/e2e-test.ts --skip-dynamodb   # Skip DynamoDB container check/start
 *
 * Environment variables (defaults for testing):
 *   DYNAMODB_ENDPOINT=http://localhost:8701
 *   STORAGE_TYPE=memory
 *   MOCK_JWT_SECRET=test-secret-key-for-e2e
 *   CAS_NODE_LIMIT=1024 (1KB for testing)
 */

import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================================
// Configuration
// ============================================================================

// Use port 8701 for test DynamoDB (in-memory, isolated from dev)
const DYNAMODB_ENDPOINT = process.env.DYNAMODB_ENDPOINT ?? "http://localhost:8701";
const DYNAMODB_PORT = new URL(DYNAMODB_ENDPOINT).port || "8701";
const STORAGE_TYPE = process.env.STORAGE_TYPE ?? "memory";
const MOCK_JWT_SECRET = process.env.MOCK_JWT_SECRET ?? "test-secret-key-for-e2e";
const CAS_NODE_LIMIT = process.env.CAS_NODE_LIMIT ?? "1024"; // 1KB for testing chunking

const args = process.argv.slice(2);
const shouldCleanup = !args.includes("--no-cleanup");
const shouldSkipTableCreation = args.includes("--skip-tables");
const shouldSkipDynamoDB = args.includes("--skip-dynamodb");

// Container name
const CONTAINER_NAME = "dynamodb-e2e-test";

// Path to server's create-local-tables script
const SERVER_DIR = resolve(__dirname, "../../server");
const CREATE_TABLES_SCRIPT = resolve(SERVER_DIR, "backend/scripts/create-local-tables.ts");

// ============================================================================
// Docker Container Management
// ============================================================================

function isDockerRunning(): boolean {
  const result = spawnSync("docker", ["info"], {
    encoding: "utf-8",
    stdio: "pipe",
  });
  return result.status === 0;
}

function isContainerRunning(): boolean {
  const result = spawnSync(
    "docker",
    ["ps", "--filter", `name=^${CONTAINER_NAME}$`, "--format", "{{.Names}}"],
    {
      encoding: "utf-8",
      stdio: "pipe",
    }
  );
  return result.stdout?.trim() === CONTAINER_NAME;
}

function isPortInUse(): boolean {
  // Check if something is listening on the port
  const result = spawnSync("lsof", ["-i", `:${DYNAMODB_PORT}`, "-t"], {
    encoding: "utf-8",
    stdio: "pipe",
  });
  return result.status === 0 && result.stdout?.trim().length > 0;
}

function removeExistingContainer(): void {
  // Try to stop and remove any existing container with the same name
  spawnSync("docker", ["stop", CONTAINER_NAME], {
    encoding: "utf-8",
    stdio: "pipe",
  });
  spawnSync("docker", ["rm", "-f", CONTAINER_NAME], {
    encoding: "utf-8",
    stdio: "pipe",
  });
}

function startDynamoDBContainer(): boolean {
  console.log(`Starting DynamoDB Local container (${CONTAINER_NAME}) on port ${DYNAMODB_PORT}...`);

  // Clean up any existing container with the same name first
  removeExistingContainer();

  // Start DynamoDB Local directly using docker run
  const result = spawnSync(
    "docker",
    [
      "run",
      "-d",
      "--rm",
      "--name",
      CONTAINER_NAME,
      "-p",
      `${DYNAMODB_PORT}:8000`,
      "amazon/dynamodb-local:latest",
      "-jar",
      "DynamoDBLocal.jar",
      "-inMemory",
      "-sharedDb",
    ],
    {
      encoding: "utf-8",
      stdio: "inherit",
    }
  );

  return result.status === 0;
}

function stopContainer(): void {
  console.log(`Stopping ${CONTAINER_NAME} container...`);

  spawnSync("docker", ["stop", CONTAINER_NAME], {
    encoding: "utf-8",
    stdio: "inherit",
  });
}

// ============================================================================
// DynamoDB Table Management
// ============================================================================

async function createTables(): Promise<boolean> {
  console.log("Creating test tables...");

  return new Promise((resolvePromise) => {
    const proc = spawn("bun", ["run", CREATE_TABLES_SCRIPT], {
      cwd: SERVER_DIR,
      stdio: "inherit",
      env: {
        ...process.env,
        DYNAMODB_ENDPOINT,
      },
    });

    proc.on("close", (code) => {
      resolvePromise(code === 0);
    });

    proc.on("error", () => {
      resolvePromise(false);
    });
  });
}

async function deleteTables(): Promise<boolean> {
  console.log("Deleting test tables...");

  return new Promise((resolvePromise) => {
    const proc = spawn("bun", ["run", CREATE_TABLES_SCRIPT, "--delete"], {
      cwd: SERVER_DIR,
      stdio: "inherit",
      env: {
        ...process.env,
        DYNAMODB_ENDPOINT,
      },
    });

    proc.on("close", (code) => {
      resolvePromise(code === 0);
    });

    proc.on("error", () => {
      resolvePromise(false);
    });
  });
}

// ============================================================================
// DynamoDB Connection Check
// ============================================================================

async function waitForDynamoDB(maxAttempts = 30, delayMs = 1000): Promise<boolean> {
  const { DynamoDBClient, ListTablesCommand } = await import("@aws-sdk/client-dynamodb");

  const client = new DynamoDBClient({
    region: "us-east-1",
    endpoint: DYNAMODB_ENDPOINT,
    credentials: {
      accessKeyId: "local",
      secretAccessKey: "local",
    },
  });

  for (let i = 0; i < maxAttempts; i++) {
    process.stdout.write(`\rChecking DynamoDB connection... (attempt ${i + 1}/${maxAttempts})`);
    try {
      await client.send(new ListTablesCommand({}));
      console.log("\nDynamoDB is ready!");
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  console.log("\nDynamoDB connection failed.");
  return false;
}

// ============================================================================
// Test Runner
// ============================================================================

function runTests(): Promise<number> {
  return new Promise((resolvePromise) => {
    console.log("\nRunning CLI e2e tests...\n");

    const cliDir = resolve(__dirname, "..");

    const testProcess = spawn("bun", ["test", "e2e"], {
      cwd: cliDir,
      stdio: "inherit",
      env: {
        ...process.env,
        DYNAMODB_ENDPOINT,
        STORAGE_TYPE,
        MOCK_JWT_SECRET,
        CAS_NODE_LIMIT,
      },
    });

    testProcess.on("close", (code) => {
      resolvePromise(code ?? 1);
    });

    testProcess.on("error", (err) => {
      console.error("Failed to run tests:", err);
      resolvePromise(1);
    });
  });
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  let containerStartedByUs = false;
  let exitCode = 1;

  try {
    console.log("=".repeat(60));
    console.log("CLI E2E Test Runner");
    console.log("=".repeat(60));
    console.log();

    console.log("Configuration:");
    console.log(`  DYNAMODB_ENDPOINT: ${DYNAMODB_ENDPOINT}`);
    console.log(`  STORAGE_TYPE: ${STORAGE_TYPE}`);
    console.log(`  CAS_NODE_LIMIT: ${CAS_NODE_LIMIT}`);
    console.log(`  MOCK_JWT_SECRET: ${MOCK_JWT_SECRET ? "(set)" : "(not set)"}`);
    console.log();

    if (!shouldSkipDynamoDB) {
      // Check if Docker is running
      if (!isDockerRunning()) {
        console.error("Error: Docker is not running.");
        console.error("Please start Docker Desktop and try again.");
        console.error("Or use --skip-dynamodb if DynamoDB is already running.");
        process.exit(1);
      }

      // Check if container is already running
      if (isContainerRunning()) {
        console.log(`Container ${CONTAINER_NAME} is already running.`);
      } else if (isPortInUse()) {
        // Port is in use but not by our container - maybe another DynamoDB instance
        console.log(`Port ${DYNAMODB_PORT} is already in use. Assuming DynamoDB is running.`);
        console.log("If this is not a DynamoDB instance, stop it and try again.");
      } else {
        // Start the container
        if (!startDynamoDBContainer()) {
          console.error(`\nError: Failed to start DynamoDB container!`);
          console.error("You can start it manually:");
          console.error(
            `  docker run -d --rm --name ${CONTAINER_NAME} -p ${DYNAMODB_PORT}:8000 amazon/dynamodb-local:latest -jar DynamoDBLocal.jar -inMemory -sharedDb`
          );
          process.exit(1);
        }
        containerStartedByUs = true;
      }

      // Wait for DynamoDB to be ready
      console.log();
      const isReady = await waitForDynamoDB();

      if (!isReady) {
        console.error("\nError: DynamoDB is not responding!");
        console.error(`Check if the container is running: docker ps -a | grep ${CONTAINER_NAME}`);
        process.exit(1);
      }
    } else {
      console.log("Skipping DynamoDB container check (--skip-dynamodb)");
    }

    // Create tables
    if (!shouldSkipTableCreation) {
      console.log();
      const tablesCreated = await createTables();
      if (!tablesCreated) {
        console.error("Warning: Failed to create tables, but continuing...");
      }
    }

    // Run tests
    exitCode = await runTests();

    // Cleanup tables
    if (shouldCleanup && !shouldSkipTableCreation) {
      console.log("\nCleaning up tables...");
      await deleteTables();
    }

    console.log();
    console.log("=".repeat(60));
    if (exitCode === 0) {
      console.log("All CLI e2e tests passed!");
    } else {
      console.log(`Tests failed with exit code: ${exitCode}`);
    }
    console.log("=".repeat(60));
  } finally {
    // Stop container if we started it
    if (containerStartedByUs) {
      console.log();
      stopContainer();
    }
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error("CLI E2E test runner failed:", err);
  process.exit(1);
});
