import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import * as readline from "node:readline";
import { dirname, relative, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { createServer, defineConfig, mergeConfig, type UserConfig } from "vite";
import type { BackendEntry } from "../config/cell-yaml-schema.js";
import { loadCellYaml } from "../config/load-cell-yaml.js";
import { resolveConfig } from "../config/resolve-config.js";
import { ensureCognitoDevCallbackUrl } from "../local/cognito-dev.js";
import {
  getContainerHostPort,
  isContainerRunning,
  isDockerRunning,
  startDynamoDB,
  startMinIO,
  stopContainer,
  waitForPort,
} from "../local/docker.js";
import { ensureLocalTables, isDynamoDBReady } from "../local/dynamodb-local.js";
import { ensureLocalBuckets } from "../local/minio-local.js";
import { loadEnvFiles } from "../utils/env.js";
import { buildDevProxy, getWorkspaceAlias } from "../utils/vite-config.js";

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

function generateDevServer(
  cellDir: string,
  entryName: string,
  appPath: string,
  port: number
): string {
  const cellBuildDir = resolve(cellDir, ".cell");
  mkdirSync(cellBuildDir, { recursive: true });
  const devServerPath = resolve(cellBuildDir, `dev-${entryName}.ts`);
  const relPath = relative(dirname(devServerPath), appPath).replace(/\.ts$/, "");
  const importPath = relPath.startsWith(".") ? relPath : `./${relPath}`;
  writeFileSync(
    devServerPath,
    [
      `import { app } from "${importPath}";`,
      `const port = parseInt(process.env.PORT || "${port}");`,
      `console.log(\`Listening on http://localhost:\${port}\`);`,
      `Bun.serve({ port, hostname: "0.0.0.0", fetch: app.fetch });`,
      "",
    ].join("\n")
  );
  return devServerPath;
}

function pipeWithLabel(
  stream: ReadableStream<Uint8Array>,
  label: string,
  target: NodeJS.WriteStream
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
        target.write(`${prefix + line}\n`);
      }
    }
    if (buffer) {
      target.write(`${prefix + buffer}\n`);
    }
  })();
}

/** Ask user to confirm before recreating a container (data loss). Returns true to proceed, false to abort. */
function confirmBeforeRecreate(
  serviceName: string,
  actualPort: number,
  requiredPort: number
): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(
      `${serviceName} is on port ${actualPort} but PORT_BASE requires ${requiredPort}. Recreating will delete local data. Continue? [y/N]: `,
      (answer) => {
        rl.close();
        resolve(/^y(es)?$/i.test(answer.trim()));
      }
    );
  });
}

export async function devCommand(options?: { cellDir?: string }): Promise<void> {
  const cellDir = resolve(options?.cellDir ?? process.cwd());
  const config = loadCellYaml(resolve(cellDir, "cell.yaml"));
  const envMap = loadEnvFiles(cellDir);
  const resolved = resolveConfig(config, envMap, "dev");

  const portBase = parseInt(envMap.PORT_BASE ?? "7100", 10);
  const httpPort = portBase + 1;
  const dynamodbPort = portBase + 2;
  const s3Port = portBase + 4;
  const frontendPort = portBase;

  // DynamoDB
  if (resolved.tables.length > 0) {
    if (!(await isDockerRunning())) {
      console.error("Docker is not running. Please start Docker and try again.");
      process.exit(1);
    }
    const dynamoContainerName = `${resolved.name}-dynamodb-dev`;
    console.log(`Starting DynamoDB on port ${dynamodbPort}...`);
    await startDynamoDB({
      port: dynamodbPort,
      persistent: true,
      containerName: dynamoContainerName,
    });

    // If existing container was bound to a different port (e.g. from a previous PORT_BASE), remove and recreate.
    if (await isContainerRunning(dynamoContainerName)) {
      const actualPort = await getContainerHostPort(dynamoContainerName, 8000);
      if (actualPort != null && actualPort !== dynamodbPort) {
        console.warn(
          `DynamoDB container is on port ${actualPort}, but PORT_BASE requires ${dynamodbPort}.`
        );
        const ok = await confirmBeforeRecreate("DynamoDB", actualPort, dynamodbPort);
        if (!ok) {
          console.error(
            "Aborted. Keep current PORT_BASE or remove the container manually: docker rm -f " +
              dynamoContainerName
          );
          process.exit(1);
        }
        console.log("Recreating DynamoDB container...");
        await stopContainer(dynamoContainerName);
        await startDynamoDB({
          port: dynamodbPort,
          persistent: true,
          containerName: dynamoContainerName,
        });
      }
    }

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
      console.error(
        `DynamoDB failed to become ready at ${endpoint}. Check that port ${dynamodbPort} is free and Docker is running.`
      );
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
      console.error("Docker is not running. Please start Docker and try again.");
      process.exit(1);
    }
    const minioContainerName = `${resolved.name}-minio-dev`;
    console.log(`Starting MinIO on port ${s3Port}...`);
    await startMinIO({
      port: s3Port,
      containerName: minioContainerName,
    });

    // If existing container was bound to a different port, remove and recreate.
    if (await isContainerRunning(minioContainerName)) {
      const actualPort = await getContainerHostPort(minioContainerName, 9000);
      if (actualPort != null && actualPort !== s3Port) {
        console.warn(
          `MinIO container is on port ${actualPort}, but PORT_BASE requires ${s3Port}.`
        );
        const ok = await confirmBeforeRecreate("MinIO", actualPort, s3Port);
        if (!ok) {
          console.error(
            "Aborted. Keep current PORT_BASE or remove the container manually: docker rm -f " +
              minioContainerName
          );
          process.exit(1);
        }
        console.log("Recreating MinIO container...");
        await stopContainer(minioContainerName);
        await startMinIO({
          port: s3Port,
          containerName: minioContainerName,
        });
      }
    }

    if (!(await waitForPort(s3Port))) {
      console.log(
        "MinIO port not ready; removing container and retrying (port may have changed)..."
      );
      await stopContainer(minioContainerName);
      await startMinIO({
        port: s3Port,
        containerName: minioContainerName,
      });
      if (!(await waitForPort(s3Port))) {
        console.error(
          `MinIO failed to become ready at port ${s3Port}. Check that the port is free and Docker is running.`
        );
        process.exit(1);
      }
    }
    console.log("MinIO ready");

    const s3Endpoint = `http://localhost:${s3Port}`;
    const s3PollIntervalMs = 1500;
    const s3PollTimeoutMs = 60_000;
    const s3StartedAt = Date.now();
    for (;;) {
      try {
        await ensureLocalBuckets(s3Endpoint, allBucketNames);
        break;
      } catch (e: any) {
        if (
          (e.code === "ECONNRESET" || e.name === "TimeoutError") &&
          Date.now() - s3StartedAt < s3PollTimeoutMs
        ) {
          await Bun.sleep(s3PollIntervalMs);
          continue;
        }
        throw e;
      }
    }
    console.log(`Created ${allBucketNames.length} bucket(s)`);
  }

  // Cognito: ensure dev callback URL is registered (Cognito redirects through Vite proxy → backend)
  if (config.cognito && resolved.backend) {
    const devCallback = `http://localhost:${frontendPort}/oauth/callback`;
    await ensureCognitoDevCallbackUrl(config.cognito, devCallback, {
      resolvedEnvVars: resolved.envVars,
      profile: envMap.AWS_PROFILE,
    });
  }

  // Child processes
  const children: ReturnType<typeof Bun.spawn>[] = [];

  // Backend: generate dev server wrapper for each entry, start with Bun.serve()
  if (resolved.backend) {
    const backendDir = resolve(cellDir, config.backend!.dir ?? ".");
    for (const [name, entry] of Object.entries(resolved.backend.entries)) {
      const appPath = resolveAppPath(backendDir, entry);
      const devServerPath = generateDevServer(cellDir, name, appPath, httpPort);
      const env = {
        ...process.env,
        ...resolved.envVars,
        PORT: String(httpPort),
        CELL_BASE_URL: `http://localhost:${frontendPort}`,
        CELL_STAGE: "dev",
      };
      console.log(`Starting backend [${name}] on port ${httpPort}...`);
      const proc = Bun.spawn(["bun", "run", devServerPath], {
        cwd: cellDir,
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      children.push(proc);
      pipeWithLabel(proc.stdout as ReadableStream<Uint8Array>, name, process.stdout);
      pipeWithLabel(proc.stderr as ReadableStream<Uint8Array>, name, process.stderr);
    }
  }

  // Frontend: start Vite dev server with API proxy (in-process via Vite JS API)
  let viteServer: Awaited<ReturnType<typeof createServer>> | undefined;
  if (resolved.frontend) {
    const frontendDir = resolve(cellDir, resolved.frontend.dir);

    const proxy = buildDevProxy(
      resolved.backend ? Object.values(resolved.backend.entries) : undefined,
      `http://localhost:${httpPort}`
    );

    const proxyConfig: UserConfig = defineConfig({
      server: {
        port: frontendPort,
        proxy,
      },
    });

    let finalConfig: UserConfig;
    const userConfigPath = resolve(frontendDir, "vite.config.ts");
    if (existsSync(userConfigPath)) {
      const userMod = await import(userConfigPath);
      const userConfig = userMod.default ?? userMod;
      finalConfig = mergeConfig(userConfig, proxyConfig);
    } else {
      const alias = getWorkspaceAlias(frontendDir, cellDir);
      const baseFromCell: UserConfig = defineConfig({
        plugins: [react()],
        resolve: {
          ...(Object.keys(alias).length > 0 ? { alias } : undefined),
          conditions: ["bun"],
        },
        server: { port: frontendPort, proxy },
        build: { outDir: "dist", emptyOutDir: true },
      });
      finalConfig = baseFromCell;
    }

    console.log(`Starting frontend [web] on port ${frontendPort}...`);
    viteServer = await createServer({
      ...finalConfig,
      root: frontendDir,
      configFile: false,
      plugins: Array.isArray(finalConfig.plugins) ? finalConfig.plugins : [],
      logLevel: "warn",
    });
    await viteServer.listen();
  }

  const cleanup = async () => {
    if (viteServer) {
      await viteServer.close();
    }
    for (const child of children) {
      child.kill();
    }
    process.exit(0);
  };
  process.on("SIGINT", () => cleanup());
  process.on("SIGTERM", () => cleanup());

  if (children.length > 0) {
    await Promise.race(children.map((c) => c.exited));
    await cleanup();
  } else if (viteServer) {
    await new Promise(() => {});
  }
}
