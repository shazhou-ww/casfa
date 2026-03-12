/**
 * Agent backend config. Same env var names as server-next/image-workshop; table names default to agent-${stage}-*.
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
  DYNAMODB_TABLE_THREADS: "DYNAMODB_TABLE_THREADS",
  DYNAMODB_TABLE_MESSAGES: "DYNAMODB_TABLE_MESSAGES",
  DYNAMODB_TABLE_SETTINGS: "DYNAMODB_TABLE_SETTINGS",
  LOG_LEVEL: "LOG_LEVEL",
  SSO_BASE_URL: "SSO_BASE_URL",
  AUTH_COOKIE_NAME: "AUTH_COOKIE_NAME",
  AUTH_COOKIE_DOMAIN: "AUTH_COOKIE_DOMAIN",
  AUTH_COOKIE_PATH: "AUTH_COOKIE_PATH",
  AUTH_COOKIE_MAX_AGE_SECONDS: "AUTH_COOKIE_MAX_AGE_SECONDS",
  AUTH: "AUTH",
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
  dynamodbTableThreads: string;
  dynamodbTableMessages: string;
  dynamodbTableSettings: string;
  logLevel?: string;
};

const DEFAULT_PORT = 7161; // PORT_BASE+1 when PORT_BASE=7160

type AuthParam = {
  cognitoRegion?: string;
  cognitoUserPoolId?: string;
  ssoBaseUrl?: string;
};

function parseAuthParam(raw: string | undefined): AuthParam | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    return {
      cognitoRegion:
        typeof parsed.cognitoRegion === "string" ? parsed.cognitoRegion : undefined,
      cognitoUserPoolId:
        typeof parsed.cognitoUserPoolId === "string"
          ? parsed.cognitoUserPoolId
          : undefined,
      ssoBaseUrl: typeof parsed.ssoBaseUrl === "string" ? parsed.ssoBaseUrl : undefined,
    };
  } catch {
    return undefined;
  }
}

/**
 * When CELL_BASE_URL is path-based (e.g. http://localhost:8900/agent), return origin + '/sso'.
 * Otherwise return undefined so subdomain-based derivation can apply.
 */
export function deriveSsoBaseUrlForPath(baseUrl: string): string | undefined {
  try {
    const u = new URL(baseUrl);
    const path = u.pathname.replace(/\/$/, "").trim();
    if (path) return `${u.origin}/sso`;
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Dev with tunnel uses same subdomain layout as prod (sso.casfa.*, agent.casfa.*).
 * When CELL_BASE_URL is https and has a multi-part host, derive SSO as https://sso.<rest>.
 * So agent.casfa.mymbp.shazhou.work → https://sso.casfa.mymbp.shazhou.work.
 * When not set, .env.local can still set SSO_BASE_URL (e.g. http://localhost:7100 for all-localhost dev).
 */
function deriveSsoBaseUrlInDev(baseUrl: string): string | undefined {
  if (!baseUrl.startsWith("https://")) return undefined;
  const host = baseUrl.replace(/\/$/, "").replace(/^https:\/\//, "").split("/")[0];
  const parts = host.split(".");
  if (parts.length < 2) return undefined;
  return `https://sso.${parts.slice(1).join(".")}`;
}

export function isMockAuthEnabled(config: ServerConfig): boolean {
  return Boolean(config.auth.mockJwtSecret && process.env.CELL_STAGE === "test");
}

export function loadConfig(): ServerConfig {
  const port = Number(process.env.PORT) || DEFAULT_PORT;
  const stage = process.env.SLS_STAGE ?? process.env.STAGE ?? "dev";
  const baseUrl = (process.env.CELL_BASE_URL || "").replace(/\/$/, "");
  const authParam = parseAuthParam(process.env.AUTH);
  let ssoBaseUrl = (process.env.SSO_BASE_URL ?? authParam?.ssoBaseUrl)?.replace(/\/$/, "");
  if (!ssoBaseUrl && stage === "dev" && baseUrl) {
    ssoBaseUrl = deriveSsoBaseUrlForPath(baseUrl) ?? deriveSsoBaseUrlInDev(baseUrl) ?? "";
  }
  const cookieName = ssoBaseUrl ? "auth" : (process.env.AUTH_COOKIE_NAME || undefined);
  const auth: ServerConfig["auth"] = {
    mockJwtSecret: process.env.MOCK_JWT_SECRET || undefined,
    cognitoRegion: process.env.COGNITO_REGION ?? authParam?.cognitoRegion,
    cognitoUserPoolId: process.env.COGNITO_USER_POOL_ID ?? authParam?.cognitoUserPoolId,
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
    dynamodbTableGrants: process.env.DYNAMODB_TABLE_GRANTS ?? `agent-${stage}-grants`,
    dynamodbTablePendingClientInfo:
      process.env.DYNAMODB_TABLE_PENDING_CLIENT_INFO ?? `agent-${stage}-pending_client_info`,
    dynamodbTableThreads: process.env.DYNAMODB_TABLE_THREADS ?? `agent-${stage}-threads`,
    dynamodbTableMessages: process.env.DYNAMODB_TABLE_MESSAGES ?? `agent-${stage}-messages`,
    dynamodbTableSettings: process.env.DYNAMODB_TABLE_SETTINGS ?? `agent-${stage}-settings`,
    logLevel: process.env.LOG_LEVEL,
  };
}
