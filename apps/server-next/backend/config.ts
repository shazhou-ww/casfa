/**
 * All stages (local-dev, local-test, beta, prod) use the same env var names; only values differ.
 * When MOCK_JWT_SECRET is set (non-empty), auth is mock; otherwise Cognito is used.
 */
export const ENV_NAMES = {
  PORT: "PORT",
  STORAGE_TYPE: "STORAGE_TYPE",
  STORAGE_FS_PATH: "STORAGE_FS_PATH",
  MOCK_JWT_SECRET: "MOCK_JWT_SECRET",
  MAX_BRANCH_TTL_MS: "MAX_BRANCH_TTL_MS",
  COGNITO_REGION: "COGNITO_REGION",
  COGNITO_USER_POOL_ID: "COGNITO_USER_POOL_ID",
  COGNITO_CLIENT_ID: "COGNITO_CLIENT_ID",
  DYNAMODB_ENDPOINT: "DYNAMODB_ENDPOINT",
  S3_BUCKET: "S3_BUCKET",
  LOG_LEVEL: "LOG_LEVEL",
} as const;

export type ServerConfig = {
  port: number;
  storage: {
    type: "memory" | "fs";
    fsPath?: string;
  };
  auth: {
    /** When set, use mock JWT auth; otherwise use Cognito */
    mockJwtSecret?: string;
    maxBranchTtlMs?: number;
    cognitoRegion?: string;
    cognitoUserPoolId?: string;
    cognitoClientId?: string;
  };
  /** Optional: for local-dev DynamoDB local */
  dynamodbEndpoint?: string;
  /** Optional: S3 bucket name or local path */
  s3Bucket?: string;
  logLevel?: string;
};

const DEFAULT_PORT = 8802;

export function loadConfig(): ServerConfig {
  const port = Number(process.env.PORT) || DEFAULT_PORT;
  const storageType = process.env.STORAGE_TYPE === "fs" ? "fs" : "memory";
  const storage: ServerConfig["storage"] =
    storageType === "fs"
      ? { type: "fs", fsPath: process.env.STORAGE_FS_PATH }
      : { type: "memory" };
  const auth: ServerConfig["auth"] = {
    mockJwtSecret: process.env.MOCK_JWT_SECRET || undefined,
    maxBranchTtlMs: process.env.MAX_BRANCH_TTL_MS
      ? Number(process.env.MAX_BRANCH_TTL_MS)
      : undefined,
    cognitoRegion: process.env.COGNITO_REGION,
    cognitoUserPoolId: process.env.COGNITO_USER_POOL_ID,
    cognitoClientId: process.env.COGNITO_CLIENT_ID,
  };
  return {
    port,
    storage,
    auth,
    dynamodbEndpoint: process.env.DYNAMODB_ENDPOINT,
    s3Bucket: process.env.S3_BUCKET,
    logLevel: process.env.LOG_LEVEL,
  };
}
