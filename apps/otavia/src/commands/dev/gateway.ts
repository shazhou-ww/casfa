import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Hono } from "hono";
import type { OtaviaYaml } from "../../config/otavia-yaml-schema.js";
import type { CellConfig } from "../../config/cell-yaml-schema.js";
import { loadOtaviaYaml } from "../../config/load-otavia-yaml.js";
import { loadCellConfig } from "../../config/load-cell-yaml.js";
import { resolveCellDir } from "../../config/resolve-cell-dir.js";
import { assertDeclaredParamsProvided, mergeParams, resolveParams } from "../../config/resolve-params.js";
import { loadEnvForCell } from "../../utils/env.js";
import { tablePhysicalName, bucketPhysicalName } from "../../config/resource-names.js";
import { buildForwardUrlForCellMount } from "./forward-url.js";
import {
  isDockerRunning,
  startDynamoDB,
  startMinIO,
  waitForPort,
} from "../../local/docker.js";
import { isDynamoDBReady, ensureLocalTables, type LocalTableEntry } from "../../local/dynamodb-local.js";
import { isMinIOReady, ensureLocalBuckets } from "../../local/minio-local.js";

const DYNAMODB_PORT = 8000;
const MINIO_PORT = 9000;
const DYNAMODB_CONTAINER = "otavia-dynamodb-dev";
const MINIO_CONTAINER = "otavia-minio-dev";

export interface GatewayCellInfo {
  /** Path segment for this cell in the stack (e.g. "sso", "drive"). */
  mount: string;
  cellDir: string;
  /** Package name (e.g. @casfa/sso). Used to import gateway module. */
  packageName: string;
  config: CellConfig;
  env: Record<string, string>;
}

function resolvedParamsToEnv(resolved: Record<string, string | unknown>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(resolved)) {
    if (value === null || value === undefined) {
      env[key] = "";
    } else if (typeof value === "object") {
      env[key] = JSON.stringify(value);
    } else {
      env[key] = String(value);
    }
  }
  return env;
}

async function discoverCells(rootDir: string, otavia: OtaviaYaml, backendPort: number): Promise<GatewayCellInfo[]> {
  const firstMount = otavia.cellsList[0]?.mount ?? "";
  const ssoBaseUrl = `http://localhost:${backendPort}/${firstMount}`;
  const cells: GatewayCellInfo[] = [];

  for (const entry of otavia.cellsList) {
    const cellDir = resolveCellDir(rootDir, entry.package);
    const cellYamlPath = resolve(cellDir, "cell.yaml");
    if (!existsSync(cellYamlPath)) {
      console.warn(`[gateway] Skipping "${entry.mount}" (${entry.package}): cell.yaml not found at ${cellYamlPath}`);
      continue;
    }
    const pkgPath = resolve(cellDir, "package.json");
    if (!existsSync(pkgPath)) {
      console.warn(`[gateway] Skipping "${entry.mount}": package.json not found`);
      continue;
    }
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { name?: string };
    const packageName = pkg?.name ?? entry.package;
    const config = loadCellConfig(cellDir);
    const merged = mergeParams(otavia.params, entry.params);
    assertDeclaredParamsProvided(config.params, merged, entry.mount);
    const envMap = loadEnvForCell(rootDir, cellDir);
    const resolved = resolveParams(merged as Record<string, unknown>, envMap, {
      onMissingParam: "placeholder",
    });
    const env = resolvedParamsToEnv(resolved as Record<string, string | unknown>);
    env.CELL_BASE_URL = `http://localhost:${backendPort}/${entry.mount}`;
    env.SSO_BASE_URL = ssoBaseUrl;
    cells.push({ mount: entry.mount, cellDir, packageName, config, env });
  }
  return cells;
}

async function ensureDockerResources(
  rootDir: string,
  otavia: OtaviaYaml,
  cells: GatewayCellInfo[]
): Promise<{ dynamoEndpoint?: string; s3Endpoint?: string }> {
  const hasTables = cells.some((c) => c.config.tables && Object.keys(c.config.tables).length > 0);
  const hasBuckets = cells.some((c) => c.config.buckets && Object.keys(c.config.buckets).length > 0);
  if (!hasTables && !hasBuckets) return {};

  if (!(await isDockerRunning())) {
    throw new Error("Docker is not running. Start Docker to use local DynamoDB/MinIO.");
  }

  const stackName = otavia.stackName;
  let dynamoEndpoint: string | undefined;
  let s3Endpoint: string | undefined;

  if (hasTables) {
    await startDynamoDB({
      port: DYNAMODB_PORT,
      persistent: false,
      containerName: DYNAMODB_CONTAINER,
    });
    if (!(await waitForPort(DYNAMODB_PORT))) {
      throw new Error("DynamoDB Local did not become ready in time");
    }
    dynamoEndpoint = `http://localhost:${DYNAMODB_PORT}`;
    // DynamoDB Local may accept TCP before the API is ready; retry isDynamoDBReady
    for (let i = 0; i < 30; i++) {
      if (await isDynamoDBReady(dynamoEndpoint)) break;
      await Bun.sleep(500);
      if (i === 29) {
        throw new Error("DynamoDB endpoint not accepting requests");
      }
    }
    const tablesList: LocalTableEntry[] = [];
    for (const cell of cells) {
      if (!cell.config.tables) continue;
      for (const [key, config] of Object.entries(cell.config.tables)) {
        tablesList.push({
          tableName: tablePhysicalName(stackName, cell.mount, key),
          config,
        });
      }
    }
    await ensureLocalTables(dynamoEndpoint, tablesList);
  }

  if (hasBuckets) {
    await startMinIO({
      port: MINIO_PORT,
      containerName: MINIO_CONTAINER,
      // no dataDir for dev => ephemeral
    });
    if (!(await waitForPort(MINIO_PORT))) {
      throw new Error("MinIO did not become ready in time");
    }
    s3Endpoint = `http://localhost:${MINIO_PORT}`;
    // MinIO may accept TCP before the S3 API is ready; retry isMinIOReady
    for (let i = 0; i < 30; i++) {
      if (await isMinIOReady(s3Endpoint)) break;
      await Bun.sleep(500);
      if (i === 29) {
        throw new Error("MinIO endpoint not accepting S3 requests");
      }
    }
    const bucketNames: string[] = [];
    for (const cell of cells) {
      if (!cell.config.buckets) continue;
      for (const key of Object.keys(cell.config.buckets)) {
        bucketNames.push(bucketPhysicalName(stackName, cell.mount, key));
      }
    }
    await ensureLocalBuckets(s3Endpoint, bucketNames);
  }

  return { dynamoEndpoint, s3Endpoint };
}

function applyLocalEndpoints(
  cells: GatewayCellInfo[],
  dynamoEndpoint?: string,
  s3Endpoint?: string
): void {
  for (const cell of cells) {
    if (dynamoEndpoint && cell.config.tables && Object.keys(cell.config.tables).length > 0) {
      cell.env.DYNAMODB_ENDPOINT = dynamoEndpoint;
    }
    if (s3Endpoint && cell.config.buckets && Object.keys(cell.config.buckets).length > 0) {
      cell.env.S3_ENDPOINT = s3Endpoint;
    }
  }
}

async function loadCellGatewayApp(
  cell: GatewayCellInfo
): Promise<((env: Record<string, string>) => Hono | Promise<Hono>) | null> {
  // Preferred: package export contract "@pkg/backend"
  try {
    const mod = await import(`${cell.packageName}/backend`);
    if (typeof mod?.createAppForBackend === "function") {
      return mod.createAppForBackend;
    }
    if (typeof mod?.createAppForGateway === "function") {
      return mod.createAppForGateway;
    }
  } catch {
    // Fallback to file-based discovery.
  }

  // Compatibility fallback while migrating from gateway naming.
  const candidates = [
    resolve(cell.cellDir, "backend", "app.ts"),
    resolve(cell.cellDir, "backend", "gateway-app.ts"),
  ];
  for (const backendEntryPath of candidates) {
    if (!existsSync(backendEntryPath)) continue;
    try {
      const mod = await import(pathToFileURL(backendEntryPath).href);
      if (typeof mod?.createAppForBackend === "function") {
        return mod.createAppForBackend;
      }
      if (typeof mod?.createAppForGateway === "function") {
        return mod.createAppForGateway;
      }
    } catch {
      // Module load error, try next candidate.
    }
  }
  return null;
}

export type GatewayServer = { stop: () => void };

/**
 * Start the dev gateway: single Hono app mounting each cell at /<mount>.
 * Starts Docker (DynamoDB Local + MinIO) when any cell has tables/buckets, unless
 * overrides are provided (e.g. for e2e: caller already started Docker and passes endpoints).
 */
export async function runGatewayDev(
  rootDir: string,
  backendPort: number,
  overrides?: { dynamoEndpoint?: string; s3Endpoint?: string }
): Promise<GatewayServer> {
  const otavia = loadOtaviaYaml(rootDir);
  const cells = await discoverCells(rootDir, otavia, backendPort);
  if (cells.length === 0) {
    throw new Error("No cells found");
  }

  let dynamoEndpoint: string | undefined;
  let s3Endpoint: string | undefined;
  if (overrides?.dynamoEndpoint !== undefined || overrides?.s3Endpoint !== undefined) {
    dynamoEndpoint = overrides.dynamoEndpoint;
    s3Endpoint = overrides.s3Endpoint;
  } else {
    const resources = await ensureDockerResources(rootDir, otavia, cells);
    dynamoEndpoint = resources.dynamoEndpoint;
    s3Endpoint = resources.s3Endpoint;
  }
  applyLocalEndpoints(cells, dynamoEndpoint, s3Endpoint);

  const gatewayApp = new Hono();
  const firstMount = otavia.cellsList[0]?.mount ?? "";

  gatewayApp.get("/", (c) => c.redirect(`/${firstMount}/`, 301));

  for (const cell of cells) {
    gatewayApp.get(`/${cell.mount}`, (c) => c.redirect(`/${cell.mount}/`, 301));
  }

  for (const cell of cells) {
    const createApp = await loadCellGatewayApp(cell);
    if (!createApp) {
      console.warn(
        `[gateway] No backend entry for "${cell.mount}" (tried backend/app.ts and backend/gateway-app.ts), skipping mount`
      );
      continue;
    }
    const cellApp = await Promise.resolve(createApp(cell.env));
    const prefix = `/${cell.mount}`;
    gatewayApp.all(prefix + "/", async (c) => {
      const newUrl = buildForwardUrlForCellMount(c.req.url, prefix);
      const newReq = new Request(newUrl, {
        method: c.req.method,
        headers: c.req.raw.headers,
        body: c.req.raw.body,
      });
      return cellApp.fetch(newReq);
    });
    gatewayApp.all(`${prefix}/*`, async (c) => {
      const newUrl = buildForwardUrlForCellMount(c.req.url, prefix);
      const newReq = new Request(newUrl, {
        method: c.req.method,
        headers: c.req.raw.headers,
        body: c.req.raw.body,
      });
      return cellApp.fetch(newReq);
    });
    console.log(`[gateway] Mounted ${cell.mount} at /${cell.mount}`);
  }

  const server = Bun.serve({
    port: backendPort,
    hostname: "0.0.0.0",
    fetch: gatewayApp.fetch,
  });

  console.log(`[gateway] Gateway running at http://localhost:${server.port}`);
  return { stop: () => server.stop() };
}
