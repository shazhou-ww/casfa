import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import * as readline from "node:readline";
import { dirname, relative, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { createServer, defineConfig, mergeConfig, type UserConfig } from "vite";
import type { BackendEntry } from "../config/cell-yaml-schema.js";
import { loadCellConfig } from "../config/load-cell-yaml.js";
import { loadDevboxConfig, DEVBOX_ROUTES_PATH, getCloudflareApiToken, getTunnelUuid } from "../config/devbox-config.js";
import {
  fetchCloudflareZonesWithId,
  findZoneForHostname,
  setCnameRecord,
  waitForEdgeCertificate,
  orderAdvancedCertificate,
} from "../local/cloudflare-tunnel-dns.js";
import { resolveConfig } from "../config/resolve-config.js";
import { ensureCognitoDevCallbackUrl } from "../local/cognito-dev.js";
import { registerRoute, unregisterRoute } from "../local/devbox-routes.js";
import {
  exec,
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
  const relPath = relative(dirname(devServerPath), appPath)
    .replace(/\.ts$/, "")
    .replace(/\\/g, "/");
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

export async function devCommand(options?: { cellDir?: string; instance?: string }): Promise<void> {
  const cellDir = resolve(options?.cellDir ?? process.cwd());
  const config = loadCellConfig(cellDir, options?.instance);
  const envMap = loadEnvFiles(cellDir);
  const resolved = resolveConfig(config, envMap, "dev");

  const portBase =
    config.dev?.portBase ?? parseInt(envMap.PORT_BASE ?? "7100", 10);
  const httpPort = portBase + 1;
  const dynamodbPort = portBase + 2;
  const s3Port = portBase + 4;
  const frontendPort = portBase;

  // When cell has domain but no devbox, dev host is empty → require devbox prepare
  const hasDomain = !!(config.domain || (config.domains && Object.keys(config.domains).length > 0));
  if (hasDomain && resolved.domain && !resolved.domain.host) {
    console.error("Dev host is not set. Run 'cell devbox prepare' first.");
    process.exit(1);
  }

  const devbox = loadDevboxConfig();
  let devHostRegistered: string | null = null;
  let routesPathForCleanup: string | null = null;
  if (resolved.domain?.host) {
    routesPathForCleanup = devbox?.proxyRegistryPath ?? DEVBOX_ROUTES_PATH;
    registerRoute(resolved.domain.host, frontendPort, routesPathForCleanup);
    devHostRegistered = resolved.domain.host;
    const host = resolved.domain.host;
    if (devbox?.tunnelId) {
      const tunnelUuid = getTunnelUuid(devbox);
      const tunnelTarget = tunnelUuid
        ? `${tunnelUuid}.cfargotunnel.com`
        : `${devbox.tunnelId}.cfargotunnel.com`;
      const apiToken = getCloudflareApiToken({ devbox, envMap });
      if (apiToken) {
        const zones = await fetchCloudflareZonesWithId(apiToken);
        const zone = findZoneForHostname(zones, host);
        if (zone) {
          const result = await setCnameRecord(apiToken, zone.id, host, tunnelTarget);
          if (result.ok) {
            console.log(`Tunnel DNS: CNAME ${host} -> ${tunnelTarget} (Cloudflare API)`);
            const orderResult = await orderAdvancedCertificate(apiToken, zone.id, host);
            if (orderResult.ok) {
              console.log("Ordered Advanced Certificate for", host, "(CLI allocation).");
            } else {
              console.warn("Advanced Certificate order (CLI) failed:", orderResult.error, "- Total TLS may still issue on first request, or quota may be full.");
            }
            const skipCertWait = /^1|true|yes$/i.test(String(envMap.CELL_DEV_SKIP_CERT_WAIT ?? process.env.CELL_DEV_SKIP_CERT_WAIT ?? "").trim());
            if (skipCertWait) {
              console.log("Skipping certificate wait (CELL_DEV_SKIP_CERT_WAIT). You may see SSL errors until the edge certificate is ready or quota allows.");
            } else {
              console.log(
                "Waiting for edge certificate (Total TLS); may take 2–3 minutes (up to 5 min). First request can trigger issuance; cert may appear in Dashboard → SSL/TLS → Edge Certificates."
              );
              console.log("Waiting 20s for DNS to propagate before probing...");
              await new Promise((r) => setTimeout(r, 20_000));
              const ready = await waitForEdgeCertificate(host, {
                timeoutMs: 300_000,
                pollIntervalMs: 5000,
                onPoll: (attempt, elapsedMs) =>
                  console.log(`  Checking certificate... (attempt ${attempt}, ${Math.round(elapsedMs / 1000)}s)`),
                onFirstError: (e) => {
                  const msg = String((e as Error)?.message ?? e);
                  console.warn("  First probe error (will keep retrying):", msg);
                  if (/unable to connect|connection|dns|ENOTFOUND|getaddrinfo/i.test(msg)) {
                    console.warn(
                      "  Hint: Run 'cell devbox start' in another terminal first. If already running, DNS may need 30–60s; wait and try again."
                    );
                    console.warn(
                      "  If your plan's Advanced Certificate quota is full (Dashboard → SSL/TLS → Edge Certificates), set CELL_DEV_SKIP_CERT_WAIT=1 to skip this wait."
                    );
                  }
                },
              });
              if (ready) {
                console.log("Edge certificate ready.");
              } else {
                console.warn(
                  "Certificate still pending; you may see SSL errors for a few minutes. Try opening the URL again shortly."
                );
                console.warn(
                  "Note: Total TLS may not list this hostname in Dashboard; that is normal. The cert is issued on first request."
                );
                console.warn(
                  "If your plan's Advanced Certificate quota is full, set CELL_DEV_SKIP_CERT_WAIT=1 next time to skip the wait."
                );
              }
            }
          } else {
            console.warn("Tunnel DNS (API) failed:", result.error);
          }
        } else {
          const zoneNames = zones.length ? zones.map((z) => z.name).join(", ") : "(none or token without Zone:Read)";
          const devRoot = devbox?.devRoot ?? "?";
          console.warn(
            `Tunnel DNS: no zone found for ${host}. This hostname is under zone "${devRoot}" (from devbox devRoot). ` +
              `Your Cloudflare zones: ${zoneNames}. ` +
              `Add the zone "${devRoot}" to your Cloudflare account, or run "cell devbox prepare" and choose a devRoot that matches an existing zone.`
          );
        }
      } else {
        const { exitCode, stdout, stderr } = await exec([
          "cloudflared", "tunnel", "route", "dns", devbox.tunnelId, host,
        ]);
        console.log(`Tunnel DNS: ${host} -> ${tunnelTarget} (cloudflared)`);
        if (stdout) console.log(stdout);
        if (stderr) console.warn(stderr);
        if (exitCode !== 0 && !stderr.includes("already exists") && !stderr.includes("already registered")) {
          console.warn("Tunnel DNS: cloudflared failed. Run 'cell devbox prepare' and add Cloudflare API token to create CNAME via API, or add CNAME manually in Cloudflare DNS.");
        }
      }
    }
  }

  // Base URL for this app: from resolved (tunnel dev host) or env or localhost
  const cellBaseUrl =
    resolved.envVars.CELL_BASE_URL?.trim() ||
    envMap.CELL_BASE_URL?.trim() ||
    `http://localhost:${frontendPort}`;

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
    const devCallback = `${cellBaseUrl.replace(/\/$/, "")}/oauth/callback`;
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
        CELL_BASE_URL: cellBaseUrl,
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
        host: "0.0.0.0",
        allowedHosts: true,
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
        server: { port: frontendPort, host: "0.0.0.0", allowedHosts: true, proxy },
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
    if (cellBaseUrl) {
      console.log("");
      console.log("Open:", cellBaseUrl);
    }
  }

  const cleanup = async () => {
    if (devHostRegistered && routesPathForCleanup) {
      unregisterRoute(devHostRegistered, routesPathForCleanup);
    }
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
