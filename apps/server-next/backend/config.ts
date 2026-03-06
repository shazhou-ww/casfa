/**
 * All stages (local-dev, local-test, beta, prod) use the same env var names; only values differ.
 * DB = DynamoDB only; Blob = S3 only. Local dev/test use Docker DynamoDB + MinIO (cell-cli).
 */
export const ENV_NAMES = {
  PORT: "PORT",
  /** Public base URL injected by cell-cli (e.g. http://localhost:7100 in dev, https://domain in prod). */
  CELL_BASE_URL: "CELL_BASE_URL",
  MOCK_JWT_SECRET: "MOCK_JWT_SECRET",
  MAX_BRANCH_TTL_MS: "MAX_BRANCH_TTL_MS",
  COGNITO_REGION: "COGNITO_REGION",
  COGNITO_USER_POOL_ID: "COGNITO_USER_POOL_ID",
  COGNITO_CLIENT_ID: "COGNITO_CLIENT_ID",
  COGNITO_HOSTED_UI_URL: "COGNITO_HOSTED_UI_URL",
  COGNITO_CLIENT_SECRET: "COGNITO_CLIENT_SECRET",
  DYNAMODB_ENDPOINT: "DYNAMODB_ENDPOINT",
  DYNAMODB_TABLE_REALMS: "DYNAMODB_TABLE_REALMS",
  DYNAMODB_TABLE_GRANTS: "DYNAMODB_TABLE_GRANTS",
  S3_BUCKET: "S3_BUCKET",
  S3_BUCKET_BLOB: "S3_BUCKET_BLOB",
  S3_ENDPOINT: "S3_ENDPOINT",
  FRONTEND_BUCKET: "FRONTEND_BUCKET",
  LOG_LEVEL: "LOG_LEVEL",
  AUTH_COOKIE_NAME: "AUTH_COOKIE_NAME",
  AUTH_COOKIE_DOMAIN: "AUTH_COOKIE_DOMAIN",
  AUTH_COOKIE_PATH: "AUTH_COOKIE_PATH",
  AUTH_COOKIE_MAX_AGE_SECONDS: "AUTH_COOKIE_MAX_AGE_SECONDS",
  SSO_BASE_URL: "SSO_BASE_URL",
} as const;

export type ServerConfig = {
  port: number;
  /** Public base URL (for Cognito redirect_uri and OAuth redirects). No trailing slash. */
  baseUrl: string;
  auth: {
    mockJwtSecret?: string;
    maxBranchTtlMs?: number;
    cognitoRegion?: string;
    cognitoUserPoolId?: string;
    cognitoClientId?: string;
    cognitoHostedUiUrl?: string;
    cognitoClientSecret?: string;
    /** SSO: HttpOnly cookie for access token (same parent domain). Omit to disable. */
    cookieName?: string;
    cookieDomain?: string;
    cookiePath?: string;
    cookieMaxAgeSeconds?: number;
    cookieSecure?: boolean;
  };
  /** SSO cell base URL (e.g. https://auth.example.com). When set, login redirects here. */
  ssoBaseUrl?: string;
  /** DynamoDB: endpoint for local (e.g. http://localhost:7102); omit for AWS */
  dynamodbEndpoint?: string;
  dynamodbTableRealms: string;
  dynamodbTableGrants: string;
  /** S3 bucket for CAS blob */
  s3Bucket: string;
  /** S3 bucket for frontend static assets (used by Lambda to serve index.html for /oauth/callback) */
  frontendBucket?: string;
  /** S3 endpoint for local (e.g. http://localhost:7104); omit for AWS */
  s3Endpoint?: string;
  logLevel?: string;
};

const DEFAULT_PORT = 8802;

/** Mock auth only when CELL_STAGE=test (e2e). Dev/prod always use Cognito. */
export function isMockAuthEnabled(config: ServerConfig): boolean {
  return Boolean(config.auth.mockJwtSecret && process.env.CELL_STAGE === "test");
}

export function loadConfig(): ServerConfig {
  const port = Number(process.env.PORT) || DEFAULT_PORT;
  const stage = process.env.SLS_STAGE ?? process.env.STAGE ?? "dev";
  const baseUrl = (process.env.CELL_BASE_URL || "").replace(/\/$/, "");
  const ssoBaseUrl = process.env.SSO_BASE_URL?.replace(/\/$/, "");
  // When using SSO, cookie name must match what SSO sets ("auth"); ignore AUTH_COOKIE_NAME.
  const cookieName = ssoBaseUrl ? "auth" : (process.env.AUTH_COOKIE_NAME || undefined);
  const auth: ServerConfig["auth"] = {
    mockJwtSecret: process.env.MOCK_JWT_SECRET || undefined,
    maxBranchTtlMs: process.env.MAX_BRANCH_TTL_MS
      ? Number(process.env.MAX_BRANCH_TTL_MS)
      : undefined,
    cognitoRegion: process.env.COGNITO_REGION,
    cognitoUserPoolId: process.env.COGNITO_USER_POOL_ID,
    cognitoClientId: process.env.COGNITO_CLIENT_ID,
    cognitoHostedUiUrl: process.env.COGNITO_HOSTED_UI_URL,
    cognitoClientSecret: process.env.COGNITO_CLIENT_SECRET,
    cookieName,
    cookieDomain: process.env.AUTH_COOKIE_DOMAIN || undefined,
    cookiePath: process.env.AUTH_COOKIE_PATH || (cookieName ? "/" : undefined),
    cookieMaxAgeSeconds: process.env.AUTH_COOKIE_MAX_AGE_SECONDS
      ? Number(process.env.AUTH_COOKIE_MAX_AGE_SECONDS)
      : undefined,
    cookieSecure:
      process.env.AUTH_COOKIE_SECURE !== undefined
        ? process.env.AUTH_COOKIE_SECURE === "true"
        : baseUrl.startsWith("https://"),
  };
  return {
    port,
    baseUrl,
    auth,
    ssoBaseUrl: ssoBaseUrl || undefined,
    dynamodbEndpoint: process.env.DYNAMODB_ENDPOINT,
    dynamodbTableRealms: process.env.DYNAMODB_TABLE_REALMS ?? `casfa-next-${stage}-realms`,
    dynamodbTableGrants: process.env.DYNAMODB_TABLE_GRANTS ?? `casfa-next-${stage}-grants`,
    s3Bucket: process.env.S3_BUCKET_BLOB ?? process.env.S3_BUCKET ?? `casfa-next-${stage}-blob`,
    frontendBucket: process.env.FRONTEND_BUCKET ?? undefined,
    s3Endpoint: process.env.S3_ENDPOINT,
    logLevel: process.env.LOG_LEVEL,
  };
}
