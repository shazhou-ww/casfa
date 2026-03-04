import { resolve } from "node:path";
import { loadCellYaml } from "../config/load-cell-yaml.js";
import { resolveConfig } from "../config/resolve-config.js";
import {
  isDockerRunning,
  startDynamoDB,
  startMinIO,
  stopContainer,
  waitForPort,
} from "../local/docker.js";
import { ensureLocalTables, isDynamoDBReady } from "../local/dynamodb-local.js";
import { ensureLocalBuckets } from "../local/minio-local.js";
import { loadEnvFiles } from "../utils/env.js";

export async function testUnitCommand(options?: { cellDir?: string }): Promise<void> {
  const cellDir = resolve(options?.cellDir ?? process.cwd());
  const config = loadCellYaml(resolve(cellDir, "cell.yaml"));

  const pattern = config.testing?.unit ?? "**/__tests__/*.test.ts";
  console.log(`Running unit tests: ${pattern}`);

  const proc = Bun.spawn(["bun", "test", pattern], {
    cwd: cellDir,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  const exitCode = await proc.exited;
  process.exit(exitCode);
}

export async function testE2eCommand(options?: { cellDir?: string }): Promise<void> {
  const cellDir = resolve(options?.cellDir ?? process.cwd());
  const config = loadCellYaml(resolve(cellDir, "cell.yaml"));
  const envMap = loadEnvFiles(cellDir);
  const resolved = resolveConfig(config, envMap, "test");

  const portBase = parseInt(envMap.PORT_BASE ?? "7100", 10);
  const httpPort = portBase + 11;
  const dynamodbPort = portBase + 12;
  const s3Port = portBase + 14;

  const dynamoContainerName = `${resolved.name}-dynamodb-test`;
  const minioContainerName = `${resolved.name}-minio-test`;

  const children: Array<ReturnType<typeof Bun.spawn>> = [];
  const containersToCleanup: string[] = [];

  try {
    // Start DynamoDB if tables configured
    if (resolved.tables.length > 0) {
      if (!(await isDockerRunning())) {
        console.error("Docker is not running. Please start Docker and try again.");
        process.exit(1);
      }
      console.log(`Starting test DynamoDB on port ${dynamodbPort}...`);
      await startDynamoDB({
        port: dynamodbPort,
        persistent: false,
        containerName: dynamoContainerName,
      });
      containersToCleanup.push(dynamoContainerName);

      const endpoint = `http://localhost:${dynamodbPort}`;
      let ready = false;
      for (let i = 0; i < 30; i++) {
        if (await isDynamoDBReady(endpoint)) {
          ready = true;
          break;
        }
        await Bun.sleep(500);
      }
      if (!ready) {
        console.error("DynamoDB failed to become ready");
        process.exit(1);
      }
      console.log("DynamoDB ready");

      resolved.envVars.DYNAMODB_ENDPOINT = endpoint;
      await ensureLocalTables(endpoint, resolved.tables);
      console.log(`Created ${resolved.tables.length} table(s)`);
    }

    // Start MinIO if buckets configured
    if (resolved.buckets.length > 0) {
      if (!(await isDockerRunning())) {
        console.error("Docker is not running. Please start Docker and try again.");
        process.exit(1);
      }
      console.log(`Starting test MinIO on port ${s3Port}...`);
      await startMinIO({
        port: s3Port,
        containerName: minioContainerName,
      });
      containersToCleanup.push(minioContainerName);

      if (!(await waitForPort(s3Port))) {
        console.error("MinIO failed to start");
        process.exit(1);
      }
      console.log("MinIO ready");

      const s3Endpoint = `http://localhost:${s3Port}`;
      resolved.envVars.S3_ENDPOINT = s3Endpoint;
      const allBucketNames = [
        ...resolved.buckets.map((b) => b.bucketName),
        resolved.frontendBucketName,
      ];
      await ensureLocalBuckets(s3Endpoint, allBucketNames);
      console.log(`Created ${allBucketNames.length} bucket(s)`);
    }

    // Start backend server
    if (resolved.backend) {
      for (const [name, entry] of Object.entries(resolved.backend.entries)) {
        const handlerPath = resolve(cellDir, entry.handler);
        const env = {
          ...process.env,
          ...resolved.envVars,
          PORT: String(httpPort),
        };
        console.log(`Starting backend [${name}] on port ${httpPort}...`);
        const proc = Bun.spawn(["bun", "run", handlerPath], {
          cwd: cellDir,
          env,
          stdout: "inherit",
          stderr: "inherit",
        });
        children.push(proc);
      }

      if (!(await waitForPort(httpPort))) {
        console.error("Backend failed to start");
        process.exit(1);
      }
      console.log("Backend ready");
    }

    // Run e2e tests
    const pattern = config.testing?.e2e ?? "tests/*.test.ts";
    console.log(`\nRunning e2e tests: ${pattern}`);

    const testProc = Bun.spawn(["bun", "test", pattern], {
      cwd: cellDir,
      env: {
        ...process.env,
        ...resolved.envVars,
        PORT: String(httpPort),
        API_BASE_URL: `http://localhost:${httpPort}`,
      },
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    });
    const testExitCode = await testProc.exited;
    process.exit(testExitCode);
  } finally {
    for (const child of children) {
      child.kill();
    }
    for (const container of containersToCleanup) {
      await stopContainer(container).catch(() => {});
    }
  }
}

export async function testCommand(options?: { cellDir?: string }): Promise<void> {
  const cellDir = resolve(options?.cellDir ?? process.cwd());
  const config = loadCellYaml(resolve(cellDir, "cell.yaml"));

  // Run unit tests (don't exit on completion, check code)
  const unitPattern = config.testing?.unit ?? "**/__tests__/*.test.ts";
  console.log(`Running unit tests: ${unitPattern}`);

  const unitProc = Bun.spawn(["bun", "test", unitPattern], {
    cwd: cellDir,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  const unitExitCode = await unitProc.exited;
  if (unitExitCode !== 0) {
    console.error("\nUnit tests failed");
    process.exit(unitExitCode);
  }

  console.log("\nUnit tests passed, running e2e tests...\n");
  await testE2eCommand({ cellDir });
}
