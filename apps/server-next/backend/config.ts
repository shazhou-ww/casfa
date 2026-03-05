/**
 * All stages (local-dev, local-test, beta, prod) use the same env var names; only values differ.
 * DB = DynamoDB only; Blob = S3 only. Local dev/test use Docker DynamoDB + MinIO (cell-cli).
 */
export const ENV_NAMES = {
  PORT: "PORT",
  /** Backend base URL for Cognito redirect_uri (e.g. http://localhost:7101 in dev). */
  API_BASE_URL: "API_BASE_URL",
  /** Frontend origin for OAuth post-callback redirect (e.g. http://localhost:7100 in dev). */
  APP_ORIGIN: "APP_ORIGIN",
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
} as const;

export type ServerConfig = {
  port: number;
  /** Backend base URL (for Cognito redirect_uri). No trailing slash. */
  apiBaseUrl?: string;
  /** Frontend origin for OAuth redirect after callback (e.g. http://localhost:7100). No trailing slash. */
  appOrigin?: string;
  auth: {
    mockJwtSecret?: string;
    maxBranchTtlMs?: number;
    cognitoRegion?: string;
    cognitoUserPoolId?: string;
    cognitoClientId?: string;
    cognitoHostedUiUrl?: string;
    cognitoClientSecret?: string;
  };
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

/** Mock auth is only enabled when NODE_ENV=test (e.g. e2e). Dev/prod must use Cognito. */
export function isMockAuthEnabled(config: ServerConfig): boolean {
  return Boolean(config.auth.mockJwtSecret && process.env.NODE_ENV === "test");
}

export function loadConfig(): ServerConfig {
  const port = Number(process.env.PORT) || DEFAULT_PORT;
  const stage = process.env.SLS_STAGE ?? process.env.STAGE ?? "dev";
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
  };
  const apiBaseUrl = process.env.API_BASE_URL?.replace(/\/$/, "") || undefined;
  const appOrigin = process.env.APP_ORIGIN?.replace(/\/$/, "") || undefined;
  return {
    port,
    apiBaseUrl,
    appOrigin,
    auth,
    dynamodbEndpoint: process.env.DYNAMODB_ENDPOINT,
    dynamodbTableRealms: process.env.DYNAMODB_TABLE_REALMS ?? `casfa-next-${stage}-realms`,
    dynamodbTableGrants: process.env.DYNAMODB_TABLE_GRANTS ?? `casfa-next-${stage}-grants`,
    s3Bucket: process.env.S3_BUCKET_BLOB ?? process.env.S3_BUCKET ?? `casfa-next-${stage}-blob`,
    frontendBucket: process.env.FRONTEND_BUCKET ?? undefined,
    s3Endpoint: process.env.S3_ENDPOINT,
    logLevel: process.env.LOG_LEVEL,
  };
}
