/**
 * All stages (local-dev, local-test, beta, prod) use the same env var names; only values differ.
 * DB = DynamoDB only; Blob = S3 only. Local dev/test use serverless-dynamodb-local and serverless-s3-local.
 */
export const ENV_NAMES = {
  PORT: "PORT",
  MOCK_JWT_SECRET: "MOCK_JWT_SECRET",
  MAX_BRANCH_TTL_MS: "MAX_BRANCH_TTL_MS",
  COGNITO_REGION: "COGNITO_REGION",
  COGNITO_USER_POOL_ID: "COGNITO_USER_POOL_ID",
  COGNITO_CLIENT_ID: "COGNITO_CLIENT_ID",
  COGNITO_HOSTED_UI_URL: "COGNITO_HOSTED_UI_URL",
  COGNITO_CLIENT_SECRET: "COGNITO_CLIENT_SECRET",
  DYNAMODB_ENDPOINT: "DYNAMODB_ENDPOINT",
  DYNAMODB_TABLE_DELEGATES: "DYNAMODB_TABLE_DELEGATES",
  DYNAMODB_TABLE_GRANTS: "DYNAMODB_TABLE_GRANTS",
  S3_BUCKET: "S3_BUCKET",
  S3_ENDPOINT: "S3_ENDPOINT",
  LOG_LEVEL: "LOG_LEVEL",
} as const;

export type ServerConfig = {
  port: number;
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
  dynamodbTableDelegates: string;
  dynamodbTableGrants: string;
  /** S3 bucket for CAS blob */
  s3Bucket: string;
  /** S3 endpoint for local (e.g. http://localhost:4569); omit for AWS */
  s3Endpoint?: string;
  logLevel?: string;
};

const DEFAULT_PORT = 8802;

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
  return {
    port,
    auth,
    dynamodbEndpoint: process.env.DYNAMODB_ENDPOINT,
    dynamodbTableDelegates:
      process.env.DYNAMODB_TABLE_DELEGATES ?? `casfa-next-${stage}-delegates`,
    dynamodbTableGrants:
      process.env.DYNAMODB_TABLE_GRANTS ?? `casfa-next-${stage}-grants`,
    s3Bucket: process.env.S3_BUCKET ?? `casfa-next-${stage}-blob`,
    s3Endpoint: process.env.S3_ENDPOINT,
    logLevel: process.env.LOG_LEVEL,
  };
}
