import type {
  BackendConfig,
  CellConfig,
  DomainConfig,
  FrontendConfig,
  StaticMapping,
  TableConfig,
  TestingConfig,
} from "./cell-yaml-schema.js";
import { isSecretRef } from "./cell-yaml-schema.js";

export type Stage = "dev" | "test" | "cloud";

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

  // 1. Params → env vars
  if (config.params) {
    for (const [key, value] of Object.entries(config.params)) {
      if (typeof value === "string") {
        envVars[key] = value;
      } else if (isSecretRef(value)) {
        secretRefs[key] = value.secret;
        const envValue = envMap[value.secret];
        if (envValue === undefined) {
          if (stage === "cloud") {
            throw new Error(`Missing secret "${value.secret}" in env map for cloud stage`);
          }
          console.warn(
            `Warning: secret "${value.secret}" not found in env map (stage=${stage}), skipping`
          );
        } else {
          envVars[key] = envValue;
        }
      }
    }
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
    testing: config.testing,
  };
}
