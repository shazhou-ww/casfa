/**
 * Schema types for otavia cell.yaml (otavia variant).
 * Excludes: pathPrefix, bucketNameSuffix, dev, domain, domains, cognito, cloudflare, network.
 */

export type SecretRef = { secret: string };
export type EnvRef = { env: string };

/** Param value during parsing; may contain !Env / !Secret refs. Not resolved in loader. */
export type RawParamValue =
  | string
  | SecretRef
  | EnvRef
  | Record<string, unknown>;

export function isSecretRef(v: unknown): v is SecretRef {
  return (
    typeof v === "object" &&
    v !== null &&
    "secret" in v &&
    !("env" in v)
  );
}

export function isEnvRef(v: unknown): v is EnvRef {
  return (
    typeof v === "object" &&
    v !== null &&
    "env" in v &&
    !("secret" in v)
  );
}

export interface BackendEntry {
  handler: string;
  app?: string;
  timeout: number;
  memory: number;
  routes: string[];
}

export interface BackendConfig {
  dir?: string;
  runtime: string;
  entries: Record<string, BackendEntry>;
}

export interface FrontendEntry {
  entry: string;
  routes: string[];
}

export interface FrontendConfig {
  dir: string;
  entries: Record<string, FrontendEntry>;
}

export interface TableGsi {
  keys: Record<string, string>;
  projection: string;
}

export interface TableConfig {
  keys: Record<string, string>;
  gsi?: Record<string, TableGsi>;
}

export interface TestingConfig {
  unit?: string;
  e2e?: string;
}

export interface CellConfig {
  name: string;
  backend?: BackendConfig;
  frontend?: FrontendConfig;
  testing?: TestingConfig;
  tables?: Record<string, TableConfig>;
  buckets?: Record<string, Record<string, unknown>>;
  params?: Record<string, RawParamValue>;
}
