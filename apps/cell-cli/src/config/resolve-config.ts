import type {
  BackendConfig,
  CellConfig,
  DomainConfig,
  FrontendConfig,
  NetworkConfig,
  StaticMapping,
  TableConfig,
  TestingConfig,
} from "./cell-yaml-schema.js";
import { isEnvRef, isSecretRef } from "./cell-yaml-schema.js";

export type Stage = "dev" | "test" | "cloud";

/** Thrown when required params are missing from env; catch in CLI to exit with a clean message */
export class MissingParamsError extends Error {
  readonly missingLines: string[];
  readonly cellName: string;
  readonly stage: Stage;

  constructor(cellName: string, stage: Stage, missingLines: string[]) {
    const message = [
      "",
      `Missing required params for "${cellName}" (stage=${stage}):`,
      ...missingLines,
      "",
      "Add them to your .env files, then retry.",
      "",
    ].join("\n");
    super(message);
    this.name = "MissingParamsError";
    this.missingLines = missingLines;
    this.cellName = cellName;
    this.stage = stage;
  }
}

export interface ResolvedTable {
  key: string;
  tableName: string;
  config: TableConfig;
}

export interface ResolvedBucket {
  key: string;
  bucketName: string;
}

export interface ResolvedConfig {
  name: string;
  envVars: Record<string, string>;
  secretRefs: Record<string, string>;
  tables: ResolvedTable[];
  buckets: ResolvedBucket[];
  frontendBucketName: string;
  backend?: BackendConfig;
  frontend?: FrontendConfig;
  static?: StaticMapping[];
  domain?: DomainConfig;
  network?: NetworkConfig;
  testing?: TestingConfig;
}

function resourceName(appName: string, key: string, stage: Stage): string {
  return stage === "cloud" ? `${appName}-${key}` : `${appName}-${stage}-${key}`;
}

export function resolveConfig(
  config: CellConfig,
  envMap: Record<string, string>,
  stage: Stage
): ResolvedConfig {
  const envVars: Record<string, string> = {};
  const secretRefs: Record<string, string> = {};

  // 1. Params → env vars (all params are required)
  const missingParams: string[] = [];
  if (config.params) {
    for (const [key, value] of Object.entries(config.params)) {
      if (typeof value === "string") {
        envVars[key] = value;
      } else if (isSecretRef(value)) {
        secretRefs[key] = value.secret;
        const envValue = envMap[value.secret];
        if (envValue === undefined) {
          missingParams.push(`  ${key}: !Secret "${value.secret}" not found in env`);
        } else {
          envVars[key] = envValue;
        }
      } else if (isEnvRef(value)) {
        const envValue = envMap[value.env];
        if (envValue === undefined) {
          missingParams.push(`  ${key}: !Env "${value.env}" not found in env`);
        } else {
          envVars[key] = envValue;
        }
      }
    }
  }
  if (missingParams.length > 0) {
    throw new MissingParamsError(config.name, stage, missingParams);
  }

  // 2. Tables → resolved names + auto env vars
  const tables: ResolvedTable[] = [];
  if (config.tables) {
    for (const [key, tableConfig] of Object.entries(config.tables)) {
      const tableName = resourceName(config.name, key, stage);
      tables.push({ key, tableName, config: tableConfig });
      envVars[`DYNAMODB_TABLE_${key.toUpperCase()}`] = tableName;
    }
  }

  // 3. Buckets → resolved names + auto env vars
  const buckets: ResolvedBucket[] = [];
  if (config.buckets) {
    for (const key of Object.keys(config.buckets)) {
      const bucketName = resourceName(config.name, key, stage);
      buckets.push({ key, bucketName });
      envVars[`S3_BUCKET_${key.toUpperCase()}`] = bucketName;
    }
  }

  // 4. Frontend bucket
  const frontendBucketName = resourceName(config.name, "frontend", stage);
  envVars.FRONTEND_BUCKET = frontendBucketName;

  // 5. Local endpoints (dev/test only)
  if (stage !== "cloud") {
    const portBase = parseInt(envMap.PORT_BASE ?? "7100", 10);
    const offset = stage === "dev" ? 0 : 10;
    envVars.DYNAMODB_ENDPOINT = `http://localhost:${portBase + offset + 2}`;
    envVars.S3_ENDPOINT = `http://localhost:${portBase + offset + 4}`;
  }

  // 6. Standard Cell env vars (CELL_STAGE, CELL_BASE_URL)
  envVars.CELL_STAGE = stage;
  if (stage === "cloud" && config.domain?.host) {
    envVars.CELL_BASE_URL = `https://${config.domain.host}`;
  }

  return {
    name: config.name,
    envVars,
    secretRefs,
    tables,
    buckets,
    frontendBucketName,
    backend: config.backend,
    frontend: config.frontend,
    static: config.static,
    domain: config.domain,
    network: config.network,
    testing: config.testing,
  };
}
