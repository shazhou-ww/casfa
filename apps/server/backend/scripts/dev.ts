#!/usr/bin/env bun

/**
 * CASFA v2 Development Server CLI
 *
 * This script starts both the backend API server and the frontend Vite dev server.
 *
 * Usage:
 *   bun run backend/scripts/dev.ts                     # Default: Docker (DynamoDB + Redis) + fs storage + Cognito auth
 *   bun run backend/scripts/dev.ts --preset e2e        # All in-memory + mock auth (for tests)
 *   bun run backend/scripts/dev.ts --preset local      # Persistent DB + fs storage + Cognito auth (same as default)
 *   bun run backend/scripts/dev.ts --preset dev        # Connect to AWS services (Cognito + S3)
 *   bun run backend/scripts/dev.ts --no-frontend       # Backend only
 *
 *   # Custom configuration:
 *   bun run backend/scripts/dev.ts --db memory --storage memory --auth mock
 *
 * Presets:
 *   e2e   - All in-memory (DynamoDB port 8701) + mock JWT (for tests)
 *   local - Persistent DynamoDB (port 8700) + Redis (port 6379) + fs storage + Cognito auth (default)
 *   dev   - Connect to real AWS services (Cognito + S3)
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Load .env from monorepo root if it exists
const monorepoRoot = resolve(import.meta.dir, "../../../../");
const envPath = resolve(monorepoRoot, ".env");
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed
      .slice(eqIndex + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

import * as readline from "node:readline";
import { Command } from "commander";
import { createAllTables, createClient, listTables } from "./create-local-tables.ts";

// ============================================================================
// CLI Configuration
// ============================================================================

type DbType = "memory" | "persistent" | "aws";
type StorageType = "memory" | "fs" | "s3";
type AuthType = "mock" | "cognito";
type PresetType = "e2e" | "local" | "dev";

interface DevConfig {
  db: DbType;
  storage: StorageType;
  auth: AuthType;
  port: number;
  skipTableCreation: boolean;
}

// Preset configurations
const presets: Record<PresetType, Partial<DevConfig>> = {
  e2e: {
    db: "memory",
    storage: "memory",
    auth: "mock",
  },
  local: {
    db: "persistent",
    storage: "fs",
    auth: "cognito",
  },
  dev: {
    db: "aws",
    storage: "s3",
    auth: "cognito",
  },
};

// ============================================================================
// DynamoDB Port Mapping
// ============================================================================

const DB_PORTS: Record<DbType, string | undefined> = {
  memory: "http://localhost:8701", // In-memory DynamoDB (dynamodb-test container)
  persistent: "http://localhost:8700", // Persistent DynamoDB (dynamodb container)
  aws: undefined, // Use AWS default
};

// ============================================================================
// Helpers
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

/**
 * Prompt user for yes/no confirmation
 */
async function promptYesNo(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${question} (y/n): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

/**
 * Start a docker compose service
 */
function startDockerService(serviceName: string): boolean {
  console.log(`\nStarting ${serviceName} container...`);

  const result = spawnSync("docker", ["compose", "up", "-d", serviceName], {
    cwd: process.cwd(),
    encoding: "utf-8",
    shell: true,
    stdio: "inherit",
  });

  return result.status === 0;
}

async function checkDynamoDBConnection(endpoint: string): Promise<boolean> {
  try {
    const client = createClient(endpoint);
    await listTables(client);
    return true;
  } catch {
    return false;
  }
}

async function waitForDynamoDB(
  endpoint: string,
  maxAttempts = 10,
  delayMs = 1000
): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    console.log(`  Attempt ${i + 1}/${maxAttempts}...`);
    if (await checkDynamoDBConnection(endpoint)) {
      console.log("DynamoDB is ready!");
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

function buildEnvVars(config: DevConfig): Record<string, string> {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: config.port.toString(),
    STORAGE_TYPE: config.storage,
  };

  // DynamoDB endpoint
  const dbEndpoint = DB_PORTS[config.db];
  if (dbEndpoint) {
    env.DYNAMODB_ENDPOINT = dbEndpoint;
  } else if (config.db === "aws") {
    // When using AWS, remove any local DYNAMODB_ENDPOINT from .env
    delete env.DYNAMODB_ENDPOINT;
  }

  // Storage configuration
  if (config.storage === "fs") {
    env.STORAGE_FS_PATH = process.env.STORAGE_FS_PATH ?? "./.local-storage";
  }

  // Auth configuration
  if (config.auth === "mock") {
    env.MOCK_JWT_SECRET = process.env.MOCK_JWT_SECRET ?? "dev-secret-key";
  } else if (config.auth === "cognito") {
    // When using Cognito, remove mock JWT secret
    delete env.MOCK_JWT_SECRET;
  }

  // Redis configuration (enabled for local Docker presets)
  if (config.db !== "aws") {
    const redisPort = config.db === "memory" ? 6380 : 6379;
    env.REDIS_ENABLED = "true";
    env.REDIS_URL = `redis://localhost:${redisPort}`;
  } else {
    // AWS preset: Redis only if explicitly configured via env
    if (!env.REDIS_URL) {
      env.REDIS_ENABLED = "false";
    }
  }

  return env;
}

function prefixOutput(proc: ReturnType<typeof spawn>, prefix: string) {
  proc.stdout?.on("data", (data: Buffer) => {
    for (const line of data.toString().split("\n")) {
      if (line) console.log(`${prefix} ${line}`);
    }
  });
  proc.stderr?.on("data", (data: Buffer) => {
    for (const line of data.toString().split("\n")) {
      if (line) console.error(`${prefix} ${line}`);
    }
  });
}

function startFullstack(env: Record<string, string>, noFrontend: boolean): Promise<number> {
  return new Promise((resolve) => {
    // Start backend
    const backendProcess = spawn("bun", ["run", "backend/server.ts"], {
      cwd: process.cwd(),
      stdio: noFrontend ? "inherit" : ["ignore", "pipe", "pipe"],
      env,
      shell: true,
    });

    if (!noFrontend) {
      prefixOutput(backendProcess, "[backend]");
    }

    let frontendProcess: ReturnType<typeof spawn> | null = null;

    if (!noFrontend) {
      // Start frontend Vite dev server
      frontendProcess = spawn("bunx", ["vite", "dev", "--config", "frontend/vite.config.ts"], {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...env, FORCE_COLOR: "1" },
        shell: true,
      });

      prefixOutput(frontendProcess, "[frontend]");

      frontendProcess.on("close", (code) => {
        console.log(`[frontend] Vite dev server exited (code ${code})`);
        backendProcess.kill();
      });

      frontendProcess.on("error", (err) => {
        console.error("[frontend] Failed to start Vite:", err);
      });
    }

    backendProcess.on("close", (code) => {
      if (!noFrontend) console.log(`[backend] Server exited (code ${code})`);
      frontendProcess?.kill();
      resolve(code ?? 0);
    });

    backendProcess.on("error", (err) => {
      console.error("Failed to start server:", err);
      frontendProcess?.kill();
      resolve(1);
    });

    // Handle process exit
    process.on("SIGINT", () => {
      backendProcess.kill("SIGINT");
      frontendProcess?.kill("SIGINT");
    });
    process.on("SIGTERM", () => {
      backendProcess.kill("SIGTERM");
      frontendProcess?.kill("SIGTERM");
    });
  });
}

// ============================================================================
// Main
// ============================================================================

const program = new Command();

program
  .name("dev")
  .description("CASFA v2 Development Server with configurable options")
  .option("--db <type>", "DynamoDB type: memory (8701), persistent (8700), aws", "persistent")
  .option("--storage <type>", "Storage type: memory, fs, s3", "fs")
  .option("--auth <type>", "Auth type: mock, cognito", "cognito")
  .option("--preset <name>", "Use preset configuration: e2e, local, dev")
  .option("--port <number>", "Server port", "8801")
  .option("--no-frontend", "Skip starting the frontend Vite dev server", false)
  .option("--skip-tables", "Skip table creation/verification", false)
  .option("-y, --yes", "Auto-answer yes to all prompts (non-interactive)", false)
  .action(async (options) => {
    const autoYes = options.yes;
    const noFrontend = options.noFrontend ?? false;

    // Apply preset if specified
    let config: DevConfig = {
      db: options.db as DbType,
      storage: options.storage as StorageType,
      auth: options.auth as AuthType,
      port: Number.parseInt(options.port, 10),
      skipTableCreation: options.skipTables,
    };

    if (options.preset) {
      const preset = presets[options.preset as PresetType];
      if (!preset) {
        console.error(`Unknown preset: ${options.preset}`);
        console.error("Available presets: e2e, local, dev");
        process.exit(1);
      }
      config = { ...config, ...preset };
    }

    console.log("=".repeat(60));
    console.log("CASFA v2 Development Server");
    console.log("=".repeat(60));
    console.log();
    console.log("Configuration:");
    console.log(`  Database: ${config.db} (${DB_PORTS[config.db] ?? "AWS default"})`);
    console.log(`  Storage:  ${config.storage}`);
    console.log(`  Auth:     ${config.auth}`);
    console.log(`  Port:     ${config.port}`);
    console.log(`  Redis:    ${config.db !== "aws" ? "redis://localhost:6379" : "disabled"}`);
    console.log(`  Frontend: ${noFrontend ? "disabled" : "http://localhost:8901"}`);
    console.log();

    // If using local DynamoDB, check Docker is running first
    if (config.db !== "aws") {
      if (!isDockerRunning()) {
        console.error("Error: Docker is not running.");
        console.error("Please start Docker Desktop and try again.");
        process.exit(1);
      }
    }

    // If using local DynamoDB, ensure it's running and tables exist
    if (config.db !== "aws" && !config.skipTableCreation) {
      const endpoint = DB_PORTS[config.db]!;
      const containerName = config.db === "memory" ? "dynamodb-test" : "dynamodb";

      console.log(`Checking DynamoDB at ${endpoint}...`);
      let isReady = await waitForDynamoDB(endpoint, 3, 1000);

      // If DynamoDB is not running, prompt to start it
      if (!isReady) {
        console.log(`\nDynamoDB is not running at ${endpoint}`);
        const shouldStart =
          autoYes || (await promptYesNo(`Do you want to start the ${containerName} container?`));

        if (!shouldStart) {
          console.log("\nExiting. Please start DynamoDB manually:");
          console.log(`  docker compose up -d ${containerName}`);
          process.exit(1);
        }

        // Start the container
        if (!startDockerService(containerName)) {
          console.error(`\nFailed to start ${containerName} container.`);
          console.error("Make sure Docker is running.");
          process.exit(1);
        }

        // Wait for DynamoDB to be ready after starting
        console.log("\nWaiting for DynamoDB to be ready...");
        isReady = await waitForDynamoDB(endpoint, 10, 1000);

        if (!isReady) {
          console.error("\nDynamoDB failed to start properly.");
          process.exit(1);
        }
      }

      // Check if tables exist
      const client = createClient(endpoint);
      const existingTables = await listTables(client);
      const requiredTables = ["cas-tokens", "cas-realm", "cas-refcount", "cas-usage"];
      const missingTables = requiredTables.filter((t) => !existingTables.includes(t));

      if (missingTables.length > 0) {
        console.log(`\nMissing tables: ${missingTables.join(", ")}`);
        const shouldCreate =
          autoYes || (await promptYesNo("Do you want to create the missing tables?"));

        if (!shouldCreate) {
          console.log("\nExiting. Please create tables manually:");
          console.log("  bun run db:create");
          process.exit(1);
        }

        console.log("\nCreating tables...");
        await createAllTables(client);
        console.log("Tables created successfully!");
      } else {
        console.log("All tables exist.");
      }
      console.log();

      // Start Redis container alongside DynamoDB
      const redisContainer = config.db === "memory" ? "redis-test" : "redis";
      const redisPort = config.db === "memory" ? 6380 : 6379;
      console.log(`Starting Redis (${redisContainer}) on port ${redisPort}...`);
      if (!startDockerService(redisContainer)) {
        console.warn(`⚠️  Failed to start ${redisContainer} — Redis caching will be disabled.`);
      } else {
        console.log("Redis is ready!");
      }
      console.log();
    }

    // If using AWS DynamoDB, check tables exist and create if missing
    if (config.db === "aws" && !config.skipTableCreation) {
      console.log("Checking AWS DynamoDB tables...");
      try {
        const awsClient = createClient(); // no endpoint = AWS default
        const existingTables = await listTables(awsClient);
        const requiredTables = ["cas-tokens", "cas-realm", "cas-refcount", "cas-usage"];
        const missingTables = requiredTables.filter((t) => !existingTables.includes(t));

        if (missingTables.length > 0) {
          console.log(`\nMissing AWS DynamoDB tables: ${missingTables.join(", ")}`);
          const shouldCreate = autoYes || (await promptYesNo("Do you want to create them on AWS?"));

          if (!shouldCreate) {
            console.log("\nExiting. Create tables with: bun run setup:aws");
            process.exit(1);
          }

          console.log("\nCreating AWS DynamoDB tables...");
          await createAllTables(awsClient);
          console.log("AWS DynamoDB tables created successfully!");
        } else {
          console.log("All AWS DynamoDB tables exist.");
        }
      } catch (err) {
        console.warn(`\n⚠️  Could not check AWS DynamoDB tables: ${(err as Error).message}`);
        console.warn("   Continuing anyway — ensure tables exist or run: bun run setup:aws\n");
      }
      console.log();
    }

    // Build environment variables
    const env = buildEnvVars(config);

    // Start backend (and optionally frontend)
    if (noFrontend) {
      console.log("Starting backend server...\n");
    } else {
      console.log("Starting backend + frontend...\n");
    }
    const exitCode = await startFullstack(env, noFrontend);
    process.exit(exitCode);
  });

program.parse();
