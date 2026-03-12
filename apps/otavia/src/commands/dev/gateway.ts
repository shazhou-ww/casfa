import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Hono } from "hono";
import type { OtaviaYaml } from "../../config/otavia-yaml-schema.js";
import type { CellConfig } from "../../config/cell-yaml-schema.js";
import { loadOtaviaYaml } from "../../config/load-otavia-yaml.js";
import { loadCellConfig } from "../../config/load-cell-yaml.js";
import { mergeParams, resolveParams } from "../../config/resolve-params.js";
import { loadEnvForCell } from "../../utils/env.js";
import { tablePhysicalName, bucketPhysicalName } from "../../config/resource-names.js";
import {
  isDockerRunning,
  startDynamoDB,
  startMinIO,
  waitForPort,
} from "../../local/docker.js";
import { isDynamoDBReady, ensureLocalTables, type LocalTableEntry } from "../../local/dynamodb-local.js";
import { ensureLocalBuckets } from "../../local/minio-local.js";

const DYNAMODB_PORT = 8000;
const MINIO_PORT = 9000;
const DYNAMODB_CONTAINER = "otavia-dynamodb-dev";
const MINIO_CONTAINER = "otavia-minio-dev";

export interface GatewayCellInfo {
  cellId: string;
  cellDir: string;
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
  const firstCellId = otavia.cells[0];
  const ssoBaseUrl = `http://localhost:${backendPort}/${firstCellId}`;
  const cells: GatewayCellInfo[] = [];

  for (const cellId of otavia.cells) {
    const cellDir = resolve(rootDir, "apps", cellId);
    const cellYamlPath = resolve(cellDir, "cell.yaml");
    if (!existsSync(cellYamlPath)) {
      console.warn(`[gateway] Skipping cell "${cellId}": cell.yaml not found at ${cellYamlPath}`);
      continue;
    }
    const config = loadCellConfig(cellDir);
    const merged = mergeParams(otavia.params, config.params);
    const envMap = loadEnvForCell(rootDir, cellId);
    const resolved = resolveParams(merged as Record<string, unknown>, envMap, {
      onMissingParam: "placeholder",
    });
    const env = resolvedParamsToEnv(resolved as Record<string, string | unknown>);
    env.CELL_BASE_URL = `http://localhost:${backendPort}/${cellId}`;
    env.SSO_BASE_URL = ssoBaseUrl;
    cells.push({ cellId, cellDir, config, env });
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
    const ready = await waitForPort(DYNAMODB_PORT);
    if (!ready) {
      throw new Error("DynamoDB Local did not become ready in time");
    }
    dynamoEndpoint = `http://localhost:${DYNAMODB_PORT}`;
    const tablesList: LocalTableEntry[] = [];
    for (const cell of cells) {
      if (!cell.config.tables) continue;
      for (const [key, config] of Object.entries(cell.config.tables)) {
        tablesList.push({
          tableName: tablePhysicalName(stackName, cell.cellId, key),
          config,
        });
      }
    }
    if (!(await isDynamoDBReady(dynamoEndpoint))) {
      throw new Error("DynamoDB endpoint not accepting requests");
    }
    await ensureLocalTables(dynamoEndpoint, tablesList);
  }

  if (hasBuckets) {
    await startMinIO({
      port: MINIO_PORT,
      containerName: MINIO_CONTAINER,
      // no dataDir for dev => ephemeral
    });
    const ready = await waitForPort(MINIO_PORT);
    if (!ready) {
      throw new Error("MinIO did not become ready in time");
    }
    s3Endpoint = `http://localhost:${MINIO_PORT}`;
    const bucketNames: string[] = [];
    for (const cell of cells) {
      if (!cell.config.buckets) continue;
      for (const key of Object.keys(cell.config.buckets)) {
        bucketNames.push(bucketPhysicalName(stackName, cell.cellId, key));
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
  cellDir: string
): Promise<((env: Record<string, string>) => Hono) | null> {
  const gatewayAppPath = resolve(cellDir, "backend", "gateway-app.ts");
  if (!existsSync(gatewayAppPath)) {
    return null;
  }
  try {
    const mod = await import(pathToFileURL(gatewayAppPath).href);
    if (typeof mod?.createAppForGateway === "function") {
      return mod.createAppForGateway;
    }
  } catch {
    // Module load error
  }
  return null;
}

export type GatewayServer = { stop: () => void };

/**
 * Start the dev gateway: single Hono app mounting each cell at /<cellId>.
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
  const firstCellId = otavia.cells[0];

  gatewayApp.get("/", (c) => c.redirect(`/${firstCellId}/`, 301));

  for (const cell of cells) {
    gatewayApp.get(`/${cell.cellId}`, (c) => c.redirect(`/${cell.cellId}/`, 301));
  }

  for (const cell of cells) {
    const createApp = await loadCellGatewayApp(cell.cellDir);
    if (!createApp) {
      console.warn(
        `[gateway] No backend/gateway-app.ts (createAppForGateway) for "${cell.cellId}", skipping mount`
      );
      continue;
    }
    const cellApp = createApp(cell.env);
    const prefix = `/${cell.cellId}`;
    gatewayApp.all(prefix + "/", async (c) => {
      const u = new URL(c.req.url);
      const newUrl = new URL("/" + (u.search || ""), u.origin);
      const newReq = new Request(newUrl, {
        method: c.req.method,
        headers: c.req.raw.headers,
        body: c.req.raw.body,
      });
      return cellApp.fetch(newReq);
    });
    gatewayApp.all(`${prefix}/*`, async (c) => {
      const url = new URL(c.req.url);
      const afterPrefix = url.pathname.slice(prefix.length) || "/";
      const newUrl = new URL(afterPrefix + (url.search ? "?" + url.search : ""), url.origin);
      const newReq = new Request(newUrl, {
        method: c.req.method,
        headers: c.req.raw.headers,
        body: c.req.raw.body,
      });
      return cellApp.fetch(newReq);
    });
    console.log(`[gateway] Mounted ${cell.cellId} at /${cell.cellId}`);
  }

  const server = Bun.serve({
    port: backendPort,
    hostname: "0.0.0.0",
    fetch: gatewayApp.fetch,
  });

  console.log(`[gateway] Gateway running at http://localhost:${server.port}`);
  return { stop: () => server.stop() };
}
