/**
 * Start local-test: serverless offline on 7111 (API) and 7113 (lambda), mock auth.
 * Uses Docker dynamodb-test (7112, in-memory) and serverless-s3-local (4569).
 */
import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { ensureTables, isDynamoDBReady } from "./create-local-tables.ts";

const HTTP_PORT = 7111;
const LAMBDA_PORT = 7113;
const DYNAMODB_ENDPOINT = "http://localhost:7112";
const appRoot = process.cwd();

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
    if (!startDockerService("dynamodb-test")) {
      console.error("Failed to start dynamodb-test container.");
      process.exit(1);
    }
    console.log("\nWaiting for DynamoDB to be ready...");
    if (!(await waitForDynamoDB(DYNAMODB_ENDPOINT))) {
      console.error("DynamoDB failed to start properly.");
      process.exit(1);
    }
  }

  console.log("\nEnsuring DynamoDB tables exist (stage=local-test)...");
  await ensureTables(DYNAMODB_ENDPOINT, "local-test");

  const env = {
    ...process.env,
    STAGE: "local-test",
    MOCK_JWT_SECRET: process.env.MOCK_JWT_SECRET ?? "test-secret-e2e",
    DYNAMODB_ENDPOINT,
    S3_ENDPOINT: process.env.S3_ENDPOINT ?? "http://localhost:4569",
    S3_BUCKET: process.env.S3_BUCKET ?? "casfa-next-local-test-blob",
  };

  spawn(
    "bunx",
    [
      "serverless",
      "offline",
      "start",
      "--httpPort",
      String(HTTP_PORT),
      "--lambdaPort",
      String(LAMBDA_PORT),
      "--stage",
      "local-test",
    ],
    {
      cwd: appRoot,
      env,
      stdio: "inherit",
      shell: true,
    }
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
