import { resolve } from "node:path";
import { loadCellYaml } from "../config/load-cell-yaml.js";
import { resolveConfig } from "../config/resolve-config.js";
import { isSecretRef } from "../config/cell-yaml-schema.js";
import { loadEnvFiles } from "../utils/env.js";
import {
  isDockerRunning,
  startDynamoDB,
  startMinIO,
  waitForPort,
} from "../local/docker.js";
import { isDynamoDBReady, ensureLocalTables } from "../local/dynamodb-local.js";
import { ensureLocalBuckets } from "../local/minio-local.js";

function pipeWithLabel(
  stream: ReadableStream<Uint8Array>,
  label: string,
  target: NodeJS.WriteStream,
): void {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const prefix = `\x1b[36m[${label}]\x1b[0m `;

  (async () => {
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop()!;
      for (const line of lines) {
        target.write(prefix + line + "\n");
      }
    }
    if (buffer) {
      target.write(prefix + buffer + "\n");
    }
  })();
}

export async function devCommand(options?: {
  cellDir?: string;
}): Promise<void> {
  const cellDir = resolve(options?.cellDir ?? process.cwd());
  const config = loadCellYaml(resolve(cellDir, "cell.yaml"));
  const envMap = loadEnvFiles(cellDir);
  const resolved = resolveConfig(config, envMap, "dev");

  // Check secrets
  if (config.params) {
    for (const [key, value] of Object.entries(config.params)) {
      if (isSecretRef(value) && !(value.secret in envMap)) {
        console.warn(
          `⚠ Secret "${value.secret}" (param "${key}") not found in .env files`,
        );
      }
    }
  }

  const portBase = parseInt(envMap["PORT_BASE"] ?? "7100", 10);
  const httpPort = portBase + 1;
  const dynamodbPort = portBase + 2;
  const s3Port = portBase + 4;

  // DynamoDB
  if (resolved.tables.length > 0) {
    if (!(await isDockerRunning())) {
      console.error(
        "Docker is not running. Please start Docker and try again.",
      );
      process.exit(1);
    }
    console.log(`Starting DynamoDB on port ${dynamodbPort}...`);
    await startDynamoDB({
      port: dynamodbPort,
      persistent: true,
      containerName: `${resolved.name}-dynamodb-dev`,
    });

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

    await ensureLocalTables(endpoint, resolved.tables);
    console.log(`Created ${resolved.tables.length} table(s)`);
  }

  // MinIO
  const allBucketNames = [
    ...resolved.buckets.map((b) => b.bucketName),
    resolved.frontendBucketName,
  ];
  if (resolved.buckets.length > 0) {
    if (!(await isDockerRunning())) {
      console.error(
        "Docker is not running. Please start Docker and try again.",
      );
      process.exit(1);
    }
    const dataDir = resolve(cellDir, ".local-storage/s3");
    console.log(`Starting MinIO on port ${s3Port}...`);
    await startMinIO({
      port: s3Port,
      containerName: `${resolved.name}-minio-dev`,
      dataDir,
    });

    if (!(await waitForPort(s3Port))) {
      console.error("MinIO failed to start");
      process.exit(1);
    }
    console.log("MinIO ready");

    const s3Endpoint = `http://localhost:${s3Port}`;
    await ensureLocalBuckets(s3Endpoint, allBucketNames);
    console.log(`Created ${allBucketNames.length} bucket(s)`);
  }

  // Child processes
  const children: ReturnType<typeof Bun.spawn>[] = [];

  if (resolved.backend) {
    for (const [name, entry] of Object.entries(resolved.backend.entries)) {
      const handlerPath = resolve(cellDir, entry.handler);
      const env = { ...process.env, ...resolved.envVars, PORT: String(httpPort) };
      console.log(`Starting backend [${name}] on port ${httpPort}...`);
      const proc = Bun.spawn(["bun", "run", handlerPath], {
        cwd: cellDir,
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      children.push(proc);
      pipeWithLabel(
        proc.stdout as ReadableStream<Uint8Array>,
        name,
        process.stdout,
      );
      pipeWithLabel(
        proc.stderr as ReadableStream<Uint8Array>,
        name,
        process.stderr,
      );
    }
  }

  if (resolved.frontend) {
    const frontendPort = httpPort + 100;
    const frontendDir = resolve(cellDir, resolved.frontend.dir);
    console.log(`Starting frontend [web] on port ${frontendPort}...`);
    const proc = Bun.spawn(
      ["bunx", "vite", "--port", String(frontendPort)],
      {
        cwd: frontendDir,
        env: { ...process.env, ...resolved.envVars },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    children.push(proc);
    pipeWithLabel(
      proc.stdout as ReadableStream<Uint8Array>,
      "web",
      process.stdout,
    );
    pipeWithLabel(
      proc.stderr as ReadableStream<Uint8Array>,
      "web",
      process.stderr,
    );
  }

  const cleanup = () => {
    for (const child of children) {
      child.kill();
    }
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  if (children.length > 0) {
    await Promise.race(children.map((c) => c.exited));
    cleanup();
  }
}
