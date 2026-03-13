/**
 * Schema types for otavia cell.yaml (otavia variant).
 * Excludes: pathPrefix, bucketNameSuffix, dev, domain, domains, cloudflare, network.
 */

export type SecretRef = { secret: string };
export type EnvRef = { env: string };
export type ParamRef = { param: string };

/**
 * Param value shape used by config pipeline.
 * NOTE: cell.yaml itself does not support !Env/!Secret; these refs come from otavia.yaml params.
 */
export type RawParamValue =
  | string
  | SecretRef
  | EnvRef
  | ParamRef
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

export function isParamRef(v: unknown): v is ParamRef {
  return (
    typeof v === "object" &&
    v !== null &&
    "param" in v &&
    !("env" in v) &&
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

export type OAuthRole = "resource_server" | "authorization_server" | "both";

export interface OAuthConfig {
  enabled: boolean;
  role: OAuthRole;
  scopes: string[];
}

export interface CognitoConfig {
  region: string;
  userPoolId: string;
  clientId: string;
  hostedUiUrl?: string;
  clientSecret?: string;
}

export interface CellConfig {
  name: string;
  backend?: BackendConfig;
  frontend?: FrontendConfig;
  testing?: TestingConfig;
  tables?: Record<string, TableConfig>;
  buckets?: Record<string, Record<string, unknown>>;
  oauth?: OAuthConfig;
  cognito?: CognitoConfig;
  /** Declared required param keys; values are provided by otavia.yaml. */
  params?: string[];
}
