/**
 * Image-workshop backend config. Aligned with server-next for auth/delegate/SSO.
 * All stages use the same env var names; only values differ.
 */
export const ENV_NAMES = {
  PORT: "PORT",
  CELL_BASE_URL: "CELL_BASE_URL",
  MOCK_JWT_SECRET: "MOCK_JWT_SECRET",
  COGNITO_REGION: "COGNITO_REGION",
  COGNITO_USER_POOL_ID: "COGNITO_USER_POOL_ID",
  DYNAMODB_ENDPOINT: "DYNAMODB_ENDPOINT",
  DYNAMODB_TABLE_GRANTS: "DYNAMODB_TABLE_GRANTS",
  DYNAMODB_TABLE_PENDING_CLIENT_INFO: "DYNAMODB_TABLE_PENDING_CLIENT_INFO",
  LOG_LEVEL: "LOG_LEVEL",
  AUTH_COOKIE_DOMAIN: "AUTH_COOKIE_DOMAIN",
  AUTH_COOKIE_PATH: "AUTH_COOKIE_PATH",
  AUTH_COOKIE_MAX_AGE_SECONDS: "AUTH_COOKIE_MAX_AGE_SECONDS",
  SSO_BASE_URL: "SSO_BASE_URL",
} as const;

export type ServerConfig = {
  port: number;
  baseUrl: string;
  auth: {
    mockJwtSecret?: string;
    cognitoRegion?: string;
    cognitoUserPoolId?: string;
    cookieName?: string;
    cookieDomain?: string;
    cookiePath?: string;
    cookieMaxAgeSeconds?: number;
    cookieSecure?: boolean;
  };
  ssoBaseUrl?: string;
  dynamodbEndpoint?: string;
  dynamodbTableGrants: string;
  dynamodbTablePendingClientInfo: string;
  logLevel?: string;
};

const DEFAULT_PORT = 8802;

/**
 * Dev with tunnel uses same subdomain layout as prod (sso.casfa.*, drive.casfa.*).
 * When CELL_BASE_URL is https and has a multi-part host, derive SSO as https://sso.<rest>.
 * So drive.casfa.mymbp.shazhou.work → https://sso.casfa.mymbp.shazhou.work.
 * When not set, .env.local can still set SSO_BASE_URL (e.g. http://localhost:7100 for all-localhost dev).
 */
function deriveSsoBaseUrlInDev(baseUrl: string): string | undefined {
  if (!baseUrl.startsWith("https://")) return undefined;
  const host = baseUrl.replace(/\/$/, "").replace(/^https:\/\//, "").split("/")[0];
  const parts = host.split(".");
  if (parts.length < 2) return undefined;
  return `https://sso.${parts.slice(1).join(".")}`;
}

/** Mock auth only when CELL_STAGE=test (e2e). Dev/prod use Cognito JWT. */
export function isMockAuthEnabled(config: ServerConfig): boolean {
  return Boolean(config.auth.mockJwtSecret && process.env.CELL_STAGE === "test");
}

export function loadConfig(): ServerConfig {
  const port = Number(process.env.PORT) || DEFAULT_PORT;
  const stage = process.env.SLS_STAGE ?? process.env.STAGE ?? "dev";
  const baseUrl = (process.env.CELL_BASE_URL || "").replace(/\/$/, "");
  let ssoBaseUrl = process.env.SSO_BASE_URL?.replace(/\/$/, "");
  if (!ssoBaseUrl && stage === "dev" && baseUrl) {
    ssoBaseUrl = deriveSsoBaseUrlInDev(baseUrl) ?? "";
  }
  const cookieName = ssoBaseUrl ? "auth" : undefined;
  const auth: ServerConfig["auth"] = {
    mockJwtSecret: process.env.MOCK_JWT_SECRET || undefined,
    cognitoRegion: process.env.COGNITO_REGION,
    cognitoUserPoolId: process.env.COGNITO_USER_POOL_ID,
    cookieName,
    cookieDomain: process.env.AUTH_COOKIE_DOMAIN || undefined,
    cookiePath: process.env.AUTH_COOKIE_PATH ?? (cookieName ? "/" : undefined),
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
    dynamodbTableGrants: process.env.DYNAMODB_TABLE_GRANTS ?? `image-workshop-${stage}-grants`,
    dynamodbTablePendingClientInfo:
      process.env.DYNAMODB_TABLE_PENDING_CLIENT_INFO ?? `image-workshop-${stage}-pending_client_info`,
    logLevel: process.env.LOG_LEVEL,
  };
}
