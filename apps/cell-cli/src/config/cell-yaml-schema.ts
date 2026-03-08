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
  /** Root directory for backend code (default: "."). Handler and app paths are relative to this. */
  dir?: string;
  runtime: string;
  entries: Record<string, BackendEntry>;
}

export interface FrontendEntry {
  /** Entry file path relative to frontend dir (e.g. index.html, sw.ts) */
  entry: string;
  /** URL path patterns this entry serves (e.g. "/*", "/service-worker.js") */
  routes: string[];
}

export interface FrontendConfig {
  dir: string;
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

export interface CloudflareConfig {
  zoneId: ResolvedValue;
  apiToken: SecretRef;
}

export interface ResolvedCloudflareConfig {
  zoneId: string;
  apiToken: string;
}

export interface DomainConfig {
  zone: ResolvedValue;
  host: ResolvedValue;
  /** "route53" (default) or "cloudflare". Use !Param for value from params. */
  dns?: "route53" | "cloudflare" | EnvRef;
  /** ACM certificate ARN. If omitted, auto-created via DNS validation. */
  certificate?: ResolvedValue;
  /** Route53 only: populated at deploy time by looking up hosted zone. */
  hostedZoneId?: string;
  /** Required when dns is "cloudflare" */
  cloudflare?: CloudflareConfig;
}

/** Domain config after resolving all EnvRef / SecretRef values to strings. */
export type ResolvedDomainConfig = {
  zone: string;
  host: string;
  dns?: "route53" | "cloudflare";
  certificate?: string;
  hostedZoneId?: string;
  cloudflare?: ResolvedCloudflareConfig;
};

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
  /** Required for cloud deploy when using buckets or frontend. Combined as key-name-suffix for bucket names (e.g. frontend-sso-casfa-shazhou-me) to avoid global S3 collisions. */
  bucketNameSuffix?: string;
  backend?: BackendConfig;
  frontend?: FrontendConfig;
  static?: StaticMapping[];
  tables?: Record<string, TableConfig>;
  buckets?: Record<string, Record<string, unknown>>;
  params?: Record<string, ResolvedValue>;
  cognito?: CognitoConfig;
  /** Custom domains (no singular domain). Each entry may use !Param for zone/host/dns/cloudflare. */
  domains?: DomainConfig[];
  network?: NetworkConfig;
  testing?: TestingConfig;
}
