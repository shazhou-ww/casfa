import { resolve, dirname, relative } from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { loadCellYaml } from "../config/load-cell-yaml.js";
import { resolveConfig } from "../config/resolve-config.js";
import { isSecretRef } from "../config/cell-yaml-schema.js";
import type { BackendEntry } from "../config/cell-yaml-schema.js";
import { loadEnvFiles } from "../utils/env.js";
import { ensureIndexHtml } from "../utils/frontend.js";
import {
  isDockerRunning,
  startDynamoDB,
  startMinIO,
  waitForPort,
} from "../local/docker.js";
import { isDynamoDBReady, ensureLocalTables } from "../local/dynamodb-local.js";
import { ensureLocalBuckets } from "../local/minio-local.js";

function resolveAppPath(cellDir: string, entry: BackendEntry): string {
  if (entry.app) {
    return resolve(cellDir, entry.app);
  }
  const handlerDir = dirname(resolve(cellDir, entry.handler));
  const candidate = resolve(handlerDir, "app.ts");
  if (existsSync(candidate)) {
    return candidate;
  }
  throw new Error(
    `Cannot find Hono app module. Either set "app" in cell.yaml backend entry, or create app.ts next to ${entry.handler}`,
  );
}

function generateDevServer(
  cellDir: string,
  entryName: string,
  appPath: string,
  port: number,
): string {
  const cellBuildDir = resolve(cellDir, ".cell");
  mkdirSync(cellBuildDir, { recursive: true });
  const devServerPath = resolve(cellBuildDir, `dev-${entryName}.ts`);
  const relPath = relative(dirname(devServerPath), appPath).replace(
    /\.ts$/,
    "",
  );
  const importPath = relPath.startsWith(".") ? relPath : `./${relPath}`;
  writeFileSync(
    devServerPath,
    [
      `import { app } from "${importPath}";`,
      `const port = parseInt(process.env.PORT || "${port}");`,
      `console.log(\`Listening on http://localhost:\${port}\`);`,
      `Bun.serve({ port, fetch: app.fetch });`,
      "",
    ].join("\n"),
  );
  return devServerPath;
}

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
  const frontendPort = portBase;

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

  // Backend: generate dev server wrapper for each entry, start with Bun.serve()
  if (resolved.backend) {
    for (const [name, entry] of Object.entries(resolved.backend.entries)) {
      const appPath = resolveAppPath(cellDir, entry);
      const devServerPath = generateDevServer(cellDir, name, appPath, httpPort);
      const env = {
        ...process.env,
        ...resolved.envVars,
        PORT: String(httpPort),
      };
      console.log(`Starting backend [${name}] on port ${httpPort}...`);
      const proc = Bun.spawn(["bun", "run", devServerPath], {
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

  // Frontend: start Vite dev server with API proxy
  if (resolved.frontend) {
    const frontendDir = resolve(cellDir, resolved.frontend.dir);
    ensureIndexHtml(frontendDir, config);

    const hasUserConfig = existsSync(resolve(frontendDir, "vite.config.ts"));
    const devViteConfig = resolve(frontendDir, ".vite-dev.config.ts");
    const lines: string[] = [];
    if (hasUserConfig) {
      lines.push(
        `import baseConfig from "./vite.config";`,
        `import { mergeConfig, defineConfig } from "vite";`,
        `import react from "@vitejs/plugin-react";`,
        `export default mergeConfig(baseConfig, defineConfig({`,
      );
    } else {
      lines.push(
        `import { defineConfig } from "vite";`,
        `import react from "@vitejs/plugin-react";`,
        `export default defineConfig({`,
        `  plugins: [react()],`,
      );
    }
    lines.push(
      `  server: {`,
      `    proxy: {`,
      `      "/api": { target: "http://localhost:${httpPort}", changeOrigin: true, rewrite: (path) => path.replace(/^\\/api/, "") },`,
      `      "/oauth": { target: "http://localhost:${httpPort}", changeOrigin: true },`,
      `    },`,
      `  },`,
      hasUserConfig ? `}));` : `});`,
      "",
    );
    writeFileSync(devViteConfig, lines.join("\n"));

    console.log(`Starting frontend [web] on port ${frontendPort}...`);
    const proc = Bun.spawn(
      ["bunx", "vite", "--config", devViteConfig, "--port", String(frontendPort)],
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
