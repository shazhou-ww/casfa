/**
 * Start local-test: serverless offline on 7111 (API) and 7113 (lambda), mock auth.
 * Uses Docker dynamodb-test (7112) and MinIO (7104) with bucket cleared each run.
 * Automatically runs dev-setup (check + init DynamoDB) before starting.
 */
import { spawn, spawnSync } from "node:child_process";
import { createConnection } from "node:net";
import { resolve } from "node:path";
import { isDynamoDBReady } from "./create-local-tables.ts";
import { clearS3Bucket, ensureS3Bucket } from "./ensure-s3-bucket.ts";
import { runSetup } from "./dev-setup.ts";

const HTTP_PORT = 7111;
const LAMBDA_PORT = 7113;
const S3_PORT = 7104; // MinIO (same as dev)
const S3_ENDPOINT = `http://localhost:${S3_PORT}`;
const S3_BUCKET_TEST = "casfa-next-local-test-blob";
const DYNAMODB_ENDPOINT = "http://localhost:7112";
const appRoot = resolve(import.meta.dir, "..");

function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection(port, "127.0.0.1", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function waitForPort(port: number, label: string, maxWaitMs = 30_000): Promise<void> {
  const step = 500;
  for (let elapsed = 0; elapsed < maxWaitMs; elapsed += step) {
    if (await isPortOpen(port)) return;
    await new Promise((r) => setTimeout(r, step));
  }
  throw new Error(`${label} (port ${port}) did not become ready in time`);
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

async function main(): Promise<void> {
  if (!isDockerRunning()) {
    console.error("Error: Docker is not running. Please start Docker and try again.");
    process.exit(1);
  }

  if (!(await isDynamoDBReady(DYNAMODB_ENDPOINT))) {
    if (!startDockerService("dynamodb-test")) {
      console.error("Failed to start dynamodb-test container.");
      process.exit(1);
    }
    if (!(await waitForDynamoDB(DYNAMODB_ENDPOINT))) {
      console.error("DynamoDB failed to start properly.");
      process.exit(1);
    }
  }

  if (!(await isPortOpen(S3_PORT))) {
    if (!startDockerService("minio")) {
      console.error("Failed to start minio container.");
      process.exit(1);
    }
    await waitForPort(S3_PORT, "MinIO (S3)");
  }
  await ensureS3Bucket(S3_ENDPOINT, S3_BUCKET_TEST);
  await clearS3Bucket(S3_ENDPOINT, S3_BUCKET_TEST);
  await runSetup("local-test");

  const env = {
    ...process.env,
    STAGE: "local-test",
    // E2E: use decode-only mock verifier so both user JWT and server-issued delegate/branch tokens are accepted.
    MOCK_JWT_SECRET: "",
    // Force mock auth: clear Cognito so Lambda does not use Cognito verifier (otherwise .env COGNITO_* would cause 401 for e2e tokens).
    COGNITO_REGION: "",
    COGNITO_USER_POOL_ID: "",
    COGNITO_CLIENT_ID: "",
    COGNITO_HOSTED_UI_URL: "",
    COGNITO_CLIENT_SECRET: "",
    DYNAMODB_ENDPOINT,
    S3_LOCAL_PORT: "7114",
    S3_LOCAL_DIRECTORY: ".local-storage/s3-test",
    S3_ENDPOINT: process.env.S3_ENDPOINT ?? S3_ENDPOINT,
    S3_BUCKET: process.env.S3_BUCKET ?? S3_BUCKET_TEST,
  };

  spawn(
    "npx",
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
