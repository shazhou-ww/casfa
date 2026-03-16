import fs from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";
import { loadOtaviaYaml } from "../config/load-otavia-yaml.js";
import { loadCellConfig } from "../config/load-cell-yaml.js";
import { resolveCellDir } from "../config/resolve-cell-dir.js";
import { assertDeclaredParamsProvided, mergeParams, resolveParams } from "../config/resolve-params.js";
import { tablePhysicalName, bucketPhysicalName } from "../config/resource-names.js";
import { loadEnvForCell } from "../utils/env.js";
import {
  isDockerRunning,
  startDynamoDB,
  startMinIO,
  waitForPort,
  stopContainer,
} from "../local/docker.js";
import {
  isDynamoDBReady,
  ensureLocalTables,
  type LocalTableEntry,
} from "../local/dynamodb-local.js";
import { ensureLocalBuckets } from "../local/minio-local.js";
import { resolvePortsFromEnv } from "../config/ports.js";

const DEFAULT_UNIT_PATTERN = "**/__tests__/*.test.ts";
const CELL_YAML = "cell.yaml";
const E2E_DYNAMODB_CONTAINER = "otavia-dynamodb-e2e";
const E2E_MINIO_CONTAINER = "otavia-minio-e2e";

interface CellYamlTesting {
  unit?: string;
}

interface CellYaml {
  testing?: CellYamlTesting;
}

function loadCellYaml(rootDir: string, packageName: string): CellYaml | null {
  const cellDir = resolveCellDir(rootDir, packageName);
  const cellPath = path.join(cellDir, CELL_YAML);
  if (!fs.existsSync(cellPath)) {
    return null;
  }
  const raw = fs.readFileSync(cellPath, "utf-8");
  const doc = parseDocument(raw);
  const data = doc.toJSON() as Record<string, unknown> | null | undefined;
  if (data == null || typeof data !== "object") {
    return {};
  }
  const testing = data.testing;
  if (testing == null || typeof testing !== "object" || Array.isArray(testing)) {
    return { testing: undefined };
  }
  const unit = (testing as Record<string, unknown>).unit;
  return {
    testing: {
      unit: typeof unit === "string" ? unit : undefined,
    },
  };
}

/**
 * Resolve glob patterns to detect if any test files exist under the given pattern.
 * - If pattern ends with "/", treat as directory and look for .test.ts and .spec.ts under it.
 * - Otherwise use pattern as-is (e.g. __tests__/*.test.ts).
 */
function getGlobPatterns(pattern: string): string[] {
  const p = pattern.trim();
  if (p.endsWith("/")) {
    return [p + "**/*.test.ts", p + "**/*.spec.ts"];
  }
  return [p];
}

async function hasTestFiles(cellDir: string, pattern: string): Promise<boolean> {
  const patterns = getGlobPatterns(pattern);
  const { Glob } = await import("bun");
  for (const p of patterns) {
    const glob = new Glob(p);
    for await (const _ of glob.scan({ cwd: cellDir, onlyFiles: true })) {
      return true;
    }
  }
  return false;
}

/**
 * Run unit tests for all cells: load otavia.yaml, for each cell load cell.yaml,
 * get testing.unit pattern (default: __tests__/*.test.ts), run bun test in each cellDir.
 * If no test files found for a cell, skip and log. Aggregate exit codes; if any cell fails, exit(1).
 */
export async function testUnitCommand(rootDir: string): Promise<void> {
  const root = path.resolve(rootDir);
  const otavia = loadOtaviaYaml(root);
  const failedCells: string[] = [];

  for (const entry of otavia.cellsList) {
    const cellDir = resolveCellDir(root, entry.package);
    if (!fs.existsSync(path.join(cellDir, CELL_YAML))) {
      console.warn(`Skipping ${entry.mount}: cell not found`);
      continue;
    }

    const cellConfig = loadCellYaml(root, entry.package);
    const pattern =
      cellConfig?.testing?.unit ?? DEFAULT_UNIT_PATTERN;

    const hasTests = await hasTestFiles(cellDir, pattern);
    if (!hasTests) {
      console.log(`Skipping ${entry.mount}: no unit tests`);
      continue;
    }

    const proc = Bun.spawn(["bun", "test", pattern], {
      cwd: cellDir,
      stdio: ["inherit", "inherit", "inherit"],
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      failedCells.push(entry.mount);
    }
  }

  if (failedCells.length > 0) {
    console.error(`Unit tests failed for: ${failedCells.join(", ")}`);
    process.exit(1);
  }
}

/**
 * E2E test command: start non-persistent Docker (DynamoDB Local + MinIO with --rm),
 * start gateway in a subprocess with DYNAMODB_ENDPOINT and S3_ENDPOINT injected;
 * for each cell that has testing.e2e run bun test <e2ePattern> in cellDir with
 * env CELL_BASE_URL etc.; then stop gateway and containers.
 */
export async function testE2eCommand(rootDir: string): Promise<void> {
  const root = path.resolve(rootDir);
  const otavia = loadOtaviaYaml(root);
  const stageEnv = loadEnvForCell(root, root, { stage: "test" });
  const ports = resolvePortsFromEnv("test", { ...stageEnv, ...process.env });
  const firstMount = otavia.cellsList[0]?.mount ?? "sso";

  type CellE2E = {
    mount: string;
    cellDir: string;
    config: ReturnType<typeof loadCellConfig>;
    e2ePattern: string;
    params?: Record<string, unknown>;
  };
  const e2eCells: CellE2E[] = [];
  let hasTables = false;
  let hasBuckets = false;

  for (const entry of otavia.cellsList) {
    const cellDir = resolveCellDir(root, entry.package);
    if (!fs.existsSync(path.join(cellDir, "cell.yaml"))) continue;
    let config: ReturnType<typeof loadCellConfig>;
    try {
      config = loadCellConfig(cellDir);
    } catch {
      continue;
    }
    if (config.tables && Object.keys(config.tables).length > 0) hasTables = true;
    if (config.buckets && Object.keys(config.buckets).length > 0) hasBuckets = true;
    const e2ePattern = config.testing?.e2e;
    if (e2ePattern && typeof e2ePattern === "string") {
      e2eCells.push({ mount: entry.mount, cellDir, config, e2ePattern, params: entry.params });
    }
  }

  if (e2eCells.length === 0) {
    console.log("No e2e tests configured");
    process.exit(0);
  }

  let gatewayProc: ReturnType<typeof Bun.spawn> | null = null;
  const needDocker = hasTables || hasBuckets;

  try {
    if (needDocker && !(await isDockerRunning())) {
      throw new Error("Docker is not running. Start Docker to run e2e tests.");
    }

    if (hasTables) {
      await startDynamoDB({
        port: ports.dynamodb,
        persistent: false,
        containerName: E2E_DYNAMODB_CONTAINER,
      });
      const ready = await waitForPort(ports.dynamodb);
      if (!ready) throw new Error("DynamoDB Local did not become ready in time");
      const dynamoEndpoint = `http://localhost:${ports.dynamodb}`;
      if (!(await isDynamoDBReady(dynamoEndpoint))) {
        throw new Error("DynamoDB endpoint not accepting requests");
      }
      const tablesList: LocalTableEntry[] = [];
      for (const entry of otavia.cellsList) {
        const cellDir = resolveCellDir(root, entry.package);
        if (!fs.existsSync(path.join(cellDir, "cell.yaml"))) continue;
        let config: ReturnType<typeof loadCellConfig>;
        try {
          config = loadCellConfig(cellDir);
        } catch {
          continue;
        }
        if (!config.tables) continue;
        for (const [key, tableConfig] of Object.entries(config.tables)) {
          tablesList.push({
            tableName: tablePhysicalName(otavia.stackName, entry.mount, key),
            config: tableConfig,
          });
        }
      }
      await ensureLocalTables(dynamoEndpoint, tablesList);
    }

    if (hasBuckets) {
      await startMinIO({
        port: ports.minio,
        containerName: E2E_MINIO_CONTAINER,
        rm: true,
      });
      const ready = await waitForPort(ports.minio);
      if (!ready) throw new Error("MinIO did not become ready in time");
      const s3Endpoint = `http://localhost:${ports.minio}`;
      const bucketNames: string[] = [];
      for (const entry of otavia.cellsList) {
        const cellDir = resolveCellDir(root, entry.package);
        if (!fs.existsSync(path.join(cellDir, "cell.yaml"))) continue;
        let config: ReturnType<typeof loadCellConfig>;
        try {
          config = loadCellConfig(cellDir);
        } catch {
          continue;
        }
        if (!config.buckets) continue;
        for (const key of Object.keys(config.buckets)) {
          bucketNames.push(bucketPhysicalName(otavia.stackName, entry.mount, key));
        }
      }
      await ensureLocalBuckets(s3Endpoint, bucketNames);
    }

    const gatewayEnv: Record<string, string> = {
      ...process.env,
      OTAVIA_DEV_GATEWAY_ONLY: "1",
      PORT: String(ports.backend),
    };
    if (hasTables) gatewayEnv.DYNAMODB_ENDPOINT = `http://localhost:${ports.dynamodb}`;
    if (hasBuckets) gatewayEnv.S3_ENDPOINT = `http://localhost:${ports.minio}`;

    const cliPath = fs.existsSync(path.join(root, "apps", "otavia", "src", "cli.ts"))
      ? path.join(root, "apps", "otavia", "src", "cli.ts")
      : path.join(root, "..", "otavia", "src", "cli.ts");
    gatewayProc = Bun.spawn(["bun", "run", cliPath, "dev"], {
      cwd: root,
      env: gatewayEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const gatewayReady = await waitForPort(ports.backend);
    if (!gatewayReady) {
      throw new Error("Gateway did not become ready in time");
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

    const failedCells: string[] = [];
    for (const { mount, cellDir, config, e2ePattern, params } of e2eCells) {
      const merged = mergeParams(otavia.params, params);
      assertDeclaredParamsProvided(config.params, merged, mount);
      const envMap = loadEnvForCell(root, cellDir, { stage: "test" });
      if (!envMap.SSO_BASE_URL?.trim()) {
        envMap.SSO_BASE_URL = `http://localhost:${ports.backend}/${firstMount}`;
      }
      const resolved = resolveParams(merged as Record<string, unknown>, envMap, {
        onMissingParam: "placeholder",
      });
      const resolvedEnv = resolvedParamsToEnv(resolved as Record<string, string | unknown>);
      const cellEnv: Record<string, string> = {
        ...resolvedEnv,
        CELL_BASE_URL: `http://localhost:${ports.backend}/${mount}`,
        PORT: String(ports.backend),
        CELL_STAGE: "test",
      };
      if (hasTables) cellEnv.DYNAMODB_ENDPOINT = `http://localhost:${ports.dynamodb}`;
      if (hasBuckets) cellEnv.S3_ENDPOINT = `http://localhost:${ports.minio}`;

      const proc = Bun.spawn(["bun", "test", e2ePattern], {
        cwd: cellDir,
        env: cellEnv,
        stdio: ["inherit", "inherit", "inherit"],
      });
      const exitCode = await proc.exited;
      if (exitCode !== 0) failedCells.push(mount);
    }

    if (failedCells.length > 0) {
      console.error(`E2E tests failed for: ${failedCells.join(", ")}`);
      process.exit(1);
    }
  } finally {
    if (gatewayProc) {
      gatewayProc.kill();
    }
    if (needDocker) {
      try {
        await stopContainer(E2E_DYNAMODB_CONTAINER);
      } catch {
        // container may already be removed (--rm)
      }
      try {
        await stopContainer(E2E_MINIO_CONTAINER);
      } catch {
        // container may already be removed (--rm)
      }
    }
  }
}
