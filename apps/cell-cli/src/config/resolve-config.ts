import type {
  BackendConfig,
  CellConfig,
  FrontendConfig,
  NetworkConfig,
  ResolvedDomainConfig,
  ResolvedValue,
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
  domain?: ResolvedDomainConfig;
  network?: NetworkConfig;
  testing?: TestingConfig;
}

function resourceName(appName: string, key: string, stage: Stage): string {
  return stage === "cloud" ? `${appName}-${key}` : `${appName}-${stage}-${key}`;
}

const S3_BUCKET_NAME_MAX = 63;
const BUCKET_SUFFIX_REGEX = /^[a-z0-9-]{1,50}$/;

/** Bucket name for cloud uses optional suffix to reduce global name collisions. */
function bucketResourceName(
  appName: string,
  key: string,
  stage: Stage,
  suffix?: string
): string {
  if (stage !== "cloud" || !suffix) {
    return resourceName(appName, key, stage);
  }
  const normalized = suffix.toLowerCase().trim();
  if (!BUCKET_SUFFIX_REGEX.test(normalized)) {
    throw new Error(
      `Invalid bucketNameSuffix "${suffix}": must be 1-50 characters, only lowercase letters, digits, and hyphens (e.g. mycompany or my-org-42).`
    );
  }
  const name = `${key}-${appName}-${normalized}`;
  if (name.length > S3_BUCKET_NAME_MAX) {
    throw new Error(
      `Bucket name "${name}" exceeds S3 limit of ${S3_BUCKET_NAME_MAX} characters. Use a shorter bucketNameSuffix.`
    );
  }
  return name;
}

export function resolveConfig(
  config: CellConfig,
  envMap: Record<string, string>,
  stage: Stage
): ResolvedConfig {
  const envVars: Record<string, string> = {};
  const secretRefs: Record<string, string> = {};

  const hasBuckets = config.buckets && Object.keys(config.buckets).length > 0;
  const hasFrontend = !!config.frontend;
  const needsBucketSuffix = stage === "cloud" && (hasBuckets || hasFrontend);
  if (needsBucketSuffix && !config.bucketNameSuffix?.trim()) {
    throw new Error(
      `Missing bucketNameSuffix in cell.yaml for cloud deploy.\n` +
        `  → S3 bucket names are globally unique. Add a suffix to avoid collisions, e.g.:\n` +
        `     bucketNameSuffix: mycompany   # or your org name / account id`
    );
  }

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
      const bucketName = bucketResourceName(
        config.name,
        key,
        stage,
        config.bucketNameSuffix
      );
      buckets.push({ key, bucketName });
      envVars[`S3_BUCKET_${key.toUpperCase()}`] = bucketName;
    }
  }

  // 4. Frontend bucket
  const frontendBucketName = bucketResourceName(
    config.name,
    "frontend",
    stage,
    config.bucketNameSuffix
  );
  envVars.FRONTEND_BUCKET = frontendBucketName;

  // 5. Local endpoints (dev/test only)
  if (stage !== "cloud") {
    const portBase = parseInt(envMap.PORT_BASE ?? "7100", 10);
    const offset = stage === "dev" ? 0 : 10;
    envVars.DYNAMODB_ENDPOINT = `http://localhost:${portBase + offset + 2}`;
    envVars.S3_ENDPOINT = `http://localhost:${portBase + offset + 4}`;
  }

  // 6. Resolve domain config (zone/host may be !Env / !Param → !Env)
  let domain: ResolvedDomainConfig | undefined;
  if (config.domain) {
    const zone = resolveValueToString(config.domain.zone, envVars, envMap);
    const host = resolveValueToString(config.domain.host, envVars, envMap);
    domain = { zone, host };
    if (config.domain.certificate) {
      domain.certificate = resolveValueToString(config.domain.certificate, envVars, envMap);
    }
  }

  // 7. Standard Cell env vars (CELL_STAGE, CELL_BASE_URL)
  envVars.CELL_STAGE = stage;
  if (stage === "cloud" && domain?.host) {
    envVars.CELL_BASE_URL = `https://${domain.host}`;
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
    domain,
    network: config.network,
    testing: config.testing,
  };
}

/** Resolve a ResolvedValue to a string using envVars (for params) and envMap (for !Env). */
function resolveValueToString(
  value: ResolvedValue,
  envVars: Record<string, string>,
  envMap: Record<string, string>
): string {
  if (typeof value === "string") return value;
  if (isEnvRef(value)) return envMap[value.env] ?? envVars[value.env] ?? "";
  if (isSecretRef(value)) return envMap[value.secret] ?? envVars[value.secret] ?? "";
  return "";
}
