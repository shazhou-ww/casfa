/** A sensitive value that needs runtime resolution (from .env locally, Secrets Manager in cloud) */
export type SecretRef = { secret: string };

/** A non-sensitive value resolved from environment variables */
export type EnvRef = { env: string };

/** After YAML loading, only three value types remain */
export type ResolvedValue = string | SecretRef | EnvRef;

/** Internal: a reference to another param key, resolved away before returning */
export type ParamRef = { $ref: string };

/** Value types during parsing, before param resolution */
export type RawParamValue = string | SecretRef | EnvRef | ParamRef;

export function isSecretRef(v: unknown): v is SecretRef {
  return typeof v === "object" && v !== null && "secret" in v && !("$ref" in v) && !("env" in v);
}

export function isEnvRef(v: unknown): v is EnvRef {
  return typeof v === "object" && v !== null && "env" in v && !("$ref" in v) && !("secret" in v);
}

export function isParamRef(v: unknown): v is ParamRef {
  return typeof v === "object" && v !== null && "$ref" in v;
}

export interface BackendEntry {
  handler: string;
  /** Path to the Hono app module (exports `app`). Used by `cell dev` to start Bun.serve(). If omitted, CLI looks for app.ts in the same directory as handler. */
  app?: string;
  timeout: number;
  memory: number;
  routes: string[];
}

export interface BackendConfig {
  runtime: string;
  entries: Record<string, BackendEntry>;
}

export interface FrontendEntry {
  src: string;
}

export interface FrontendConfig {
  dir: string;
  title?: string;
  entries: Record<string, FrontendEntry>;
}

export interface StaticMapping {
  src: string;
  dest: string;
}

export interface TableGsi {
  keys: Record<string, string>;
  projection: string;
}

export interface TableConfig {
  keys: Record<string, string>;
  gsi?: Record<string, TableGsi>;
}

export interface CognitoConfig {
  region: ResolvedValue;
  userPoolId: ResolvedValue;
  clientId: ResolvedValue;
  hostedUiUrl: ResolvedValue;
  clientSecret?: ResolvedValue;
}

export interface DomainConfig {
  zone: string;
  host: string;
  /** ACM certificate ARN. If omitted, cell-cli auto-creates one via DNS validation. */
  certificate?: ResolvedValue;
  /** Populated at deploy time by looking up Route53 hosted zone. */
  hostedZoneId?: string;
}

export interface TestingConfig {
  unit: string;
  e2e: string;
}

export interface NetworkConfig {
  vpc: boolean;
  nat?: boolean;
}

export interface CellConfig {
  name: string;
  backend?: BackendConfig;
  frontend?: FrontendConfig;
  static?: StaticMapping[];
  tables?: Record<string, TableConfig>;
  buckets?: Record<string, Record<string, unknown>>;
  params?: Record<string, ResolvedValue>;
  cognito?: CognitoConfig;
  domain?: DomainConfig;
  network?: NetworkConfig;
  testing?: TestingConfig;
}
