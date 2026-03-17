import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { Glob } from "bun";
import type { BackendEntry } from "../config/cell-yaml-schema.js";
import { loadCellConfig } from "../config/load-cell-yaml.js";
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

function resolveAppPath(backendDir: string, entry: BackendEntry): string {
  if (entry.app) {
    return resolve(backendDir, entry.app);
  }
  const handlerDir = dirname(resolve(backendDir, entry.handler));
  const candidate = resolve(handlerDir, "app.ts");
  if (existsSync(candidate)) {
    return candidate;
  }
  throw new Error(
    `Cannot find Hono app module. Either set "app" in cell.yaml backend entry, or create app.ts next to ${entry.handler}`
  );
}

function generateTestServer(
  cellDir: string,
  entryName: string,
  appPath: string,
  port: number
): string {
  const cellBuildDir = resolve(cellDir, ".cell");
  mkdirSync(cellBuildDir, { recursive: true });
  const testServerPath = resolve(cellBuildDir, `test-${entryName}.ts`);
  const relPath = relative(dirname(testServerPath), appPath)
    .replace(/\.ts$/, "")
    .replace(/\\/g, "/");
  const importPath = relPath.startsWith(".") ? relPath : `./${relPath}`;
  writeFileSync(
    testServerPath,
    [
      `import { app } from "${importPath}";`,
      `const port = parseInt(process.env.PORT || "${port}");`,
      `console.log(\`Listening on http://localhost:\${port}\`);`,
      `Bun.serve({ port, hostname: "0.0.0.0", fetch: app.fetch });`,
      "",
    ].join("\n")
  );
  return testServerPath;
}

async function hasMatchingFiles(cwd: string, pattern: string): Promise<boolean> {
  const isDirPattern = !pattern.includes("*");
  const globPattern = isDirPattern
    ? pattern.replace(/\/?$/, "") + "/**/*.test.ts"
    : pattern;
  const glob = new Glob(globPattern);
  for await (const _ of glob.scan({ cwd, onlyFiles: true })) {
    return true;
  }
  return false;
}

async function runBunTest(
  cwd: string,
  pattern: string,
  env?: Record<string, string | undefined>
): Promise<number> {
  if (!(await hasMatchingFiles(cwd, pattern))) {
    console.log("  No test files found, skipping");
    return 0;
  }
  let normalizedPattern = pattern;
  if (pattern.includes("*")) {
    const wildcardIdx = pattern.indexOf("*");
    const prefix = pattern.slice(0, wildcardIdx);
    const dir = prefix.includes("/") ? prefix.slice(0, prefix.lastIndexOf("/")) : ".";
    normalizedPattern = dir || ".";
  } else if (pattern.includes("/") && !pattern.startsWith("./") && !pattern.startsWith("../")) {
    normalizedPattern = `./${pattern}`;
  }
  const proc = Bun.spawn(["bun", "test", normalizedPattern], {
    cwd,
    env: env ? { ...process.env, ...env } : undefined,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  return proc.exited;
}

export async function testUnitCommand(options?: { cellDir?: string; instance?: string }): Promise<void> {
  const cellDir = resolve(options?.cellDir ?? process.cwd());
  const config = loadCellConfig(cellDir, options?.instance);

  const pattern = config.testing?.unit ?? "**/__tests__/*.test.ts";
  console.log(`Running unit tests: ${pattern}`);

  const exitCode = await runBunTest(cellDir, pattern);
  process.exit(exitCode);
}

export async function testE2eCommand(options?: { cellDir?: string; instance?: string }): Promise<void> {
  const cellDir = resolve(options?.cellDir ?? process.cwd());
  const config = loadCellConfig(cellDir, options?.instance);

  const pattern = config.testing?.e2e ?? "tests/*.test.ts";
  if (!(await hasMatchingFiles(cellDir, pattern))) {
    console.log(`Running e2e tests: ${pattern}`);
    console.log("  No test files found, skipping");
    return;
  }

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
        throw new Error("Docker is not running. Please start Docker and try again.");
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
        throw new Error("DynamoDB failed to become ready");
      }
      console.log("DynamoDB ready");

      resolved.envVars.DYNAMODB_ENDPOINT = endpoint;
      await ensureLocalTables(endpoint, resolved.tables);
      console.log(`Created ${resolved.tables.length} table(s)`);
    }

    // Start MinIO if buckets configured
    if (resolved.buckets.length > 0) {
      if (!(await isDockerRunning())) {
        throw new Error("Docker is not running. Please start Docker and try again.");
      }
      console.log(`Starting test MinIO on port ${s3Port}...`);
      await startMinIO({
        port: s3Port,
        containerName: minioContainerName,
      });
      containersToCleanup.push(minioContainerName);

      if (!(await waitForPort(s3Port))) {
        throw new Error("MinIO failed to start");
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
      const backendDir = resolve(cellDir, config.backend?.dir ?? ".");
      for (const [name, entry] of Object.entries(resolved.backend.entries)) {
        const appPath = resolveAppPath(backendDir, config.backend!.entries[name]!);
        const serverPath = generateTestServer(cellDir, name, appPath, httpPort);
        const env = {
          ...process.env,
          ...resolved.envVars,
          ...envMap,
          PORT: String(httpPort),
          CELL_STAGE: "test",
        };
        console.log(`Starting backend [${name}] on port ${httpPort}...`);
        const proc = Bun.spawn(["bun", "run", serverPath], {
          cwd: cellDir,
          env,
          stdout: "inherit",
          stderr: "inherit",
        });
        children.push(proc);
      }

      if (!(await waitForPort(httpPort))) {
        throw new Error("Backend failed to start");
      }
      console.log("Backend ready");
    }

    // Run e2e tests
    console.log(`\nRunning e2e tests: ${pattern}`);

    const testExitCode = await runBunTest(cellDir, pattern, {
      ...resolved.envVars,
      PORT: String(httpPort),
      CELL_STAGE: "test",
    });
    if (testExitCode !== 0) {
      throw new Error(`E2E tests failed with exit code ${testExitCode}`);
    }
  } finally {
    for (const child of children) {
      child.kill();
    }
    for (const container of containersToCleanup) {
      await stopContainer(container).catch(() => {});
    }
  }
}

export async function testCommand(options?: { cellDir?: string; instance?: string }): Promise<void> {
  const cellDir = resolve(options?.cellDir ?? process.cwd());
  const config = loadCellConfig(cellDir, options?.instance);

  const unitPattern = config.testing?.unit ?? "**/__tests__/*.test.ts";
  console.log(`Running unit tests: ${unitPattern}`);

  const unitExitCode = await runBunTest(cellDir, unitPattern);
  if (unitExitCode !== 0) {
    console.error("\nUnit tests failed");
    process.exit(unitExitCode);
  }

  console.log("\nUnit tests passed, running e2e tests...\n");
  await testE2eCommand({ cellDir, instance: options?.instance });
}
