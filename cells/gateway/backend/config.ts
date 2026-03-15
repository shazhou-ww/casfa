export type ServerConfig = {
  port: number;
  baseUrl: string;
  auth: {
    mockJwtSecret?: string;
    cognitoRegion?: string;
    cognitoUserPoolId?: string;
    cookieName?: string;
    cookieSecure?: boolean;
  };
  ssoBaseUrl?: string;
  dynamodbEndpoint?: string;
  dynamodbTableGrants: string;
  dynamodbTablePendingClientInfo: string;
  dynamodbTableServers: string;
  dynamodbTableServerOAuthStates: string;
};

const DEFAULT_PORT = 7171;

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
        typeof parsed.cognitoUserPoolId === "string" ? parsed.cognitoUserPoolId : undefined,
      ssoBaseUrl: typeof parsed.ssoBaseUrl === "string" ? parsed.ssoBaseUrl : undefined,
    };
  } catch {
    return undefined;
  }
}

export function isMockAuthEnabled(config: ServerConfig): boolean {
  return Boolean(config.auth.mockJwtSecret && process.env.CELL_STAGE === "test");
}

export function loadConfig(): ServerConfig {
  const stage = process.env.SLS_STAGE ?? process.env.STAGE ?? "dev";
  const authParam = parseAuthParam(process.env.AUTH);
  const baseUrl = (process.env.CELL_BASE_URL || "").replace(/\/$/, "");
  const ssoBaseUrl = (process.env.SSO_BASE_URL ?? authParam?.ssoBaseUrl ?? "").replace(/\/$/, "");
  return {
    port: Number(process.env.PORT) || DEFAULT_PORT,
    baseUrl,
    auth: {
      mockJwtSecret: process.env.MOCK_JWT_SECRET || undefined,
      cognitoRegion: process.env.COGNITO_REGION ?? authParam?.cognitoRegion,
      cognitoUserPoolId: process.env.COGNITO_USER_POOL_ID ?? authParam?.cognitoUserPoolId,
      cookieName: process.env.AUTH_COOKIE_NAME || "auth",
      cookieSecure:
        process.env.AUTH_COOKIE_SECURE !== undefined
          ? process.env.AUTH_COOKIE_SECURE === "true"
          : baseUrl.startsWith("https://"),
    },
    ssoBaseUrl: ssoBaseUrl || undefined,
    dynamodbEndpoint: process.env.DYNAMODB_ENDPOINT,
    dynamodbTableGrants: process.env.DYNAMODB_TABLE_GRANTS ?? `gateway-${stage}-grants`,
    dynamodbTablePendingClientInfo:
      process.env.DYNAMODB_TABLE_PENDING_CLIENT_INFO ?? `gateway-${stage}-pending_client_info`,
    dynamodbTableServers: process.env.DYNAMODB_TABLE_SERVERS ?? `gateway-${stage}-servers`,
    dynamodbTableServerOAuthStates:
      process.env.DYNAMODB_TABLE_SERVER_OAUTH_STATES ?? `gateway-${stage}-server_oauth_states`,
  };
}
