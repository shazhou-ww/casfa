/**
 * SSO cell config from env. Cookie domain for parent-domain sharing; localhost skips Secure.
 */
export type SsoConfig = {
  /** Public base URL of this SSO cell (e.g. https://auth.example.com). */
  baseUrl: string;
  cognito: {
    region: string;
    userPoolId: string;
    clientId: string;
    clientSecret?: string;
    hostedUiUrl: string;
  };
  cookie: {
    authCookieName: string;
    authCookieDomain?: string;
    authCookiePath: string;
    authCookieMaxAgeSeconds?: number;
    refreshCookieName: string;
    refreshCookiePath: string;
    refreshCookieMaxAgeSeconds?: number;
    /** When true, add Secure to Set-Cookie. false on localhost. */
    secure: boolean;
  };
  dynamodbEndpoint?: string;
  dynamodbTableGrants: string;
};

/** True when baseUrl is http://localhost or http://127.0.0.1 (no Secure on cookies). */
export function isLocalhost(baseUrl: string): boolean {
  try {
    const u = new URL(baseUrl);
    return u.hostname === "localhost" || u.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

/** True when baseUrl has a path segment (single-domain / platform mode). Cookie path must be '/'. */
function isPathBasedBaseUrl(baseUrl: string): boolean {
  try {
    const path = new URL(baseUrl).pathname.replace(/\/$/, "").trim();
    return path.length > 0;
  } catch {
    return false;
  }
}

function getBasePath(baseUrl: string): string {
  try {
    const path = new URL(baseUrl).pathname.replace(/\/$/, "");
    return path || "";
  } catch {
    return "";
  }
}

export function loadConfig(): SsoConfig {
  return loadConfigFromEnv(process.env as Record<string, string>);
}

/** Build SSO config from an env object (e.g. resolvedConfig.envVars for gateway). */
export function loadConfigFromEnv(env: Record<string, string>): SsoConfig {
  const get = (key: string, def: string = "") => (env[key] ?? def).trim();
  const baseUrl = (get("CELL_BASE_URL") ?? "").replace(/\/$/, "");
  const secure = !isLocalhost(baseUrl);
  const authCookieName = get("AUTH_COOKIE_NAME", "auth");
  const refreshCookieName = get("AUTH_REFRESH_COOKIE_NAME", "auth_refresh");
  const explicitDomain = get("AUTH_COOKIE_DOMAIN") || undefined;
  const authCookieDomain =
    explicitDomain ??
    (isLocalhost(baseUrl)
      ? (() => {
          try {
            return new URL(baseUrl).hostname;
          } catch {
            return "localhost";
          }
        })()
      : undefined);
  const authPath = get("AUTH_COOKIE_PATH", "/");
  const refreshPath = get("AUTH_REFRESH_COOKIE_PATH", "/oauth/refresh");
  const usePathBasedCookie = isPathBasedBaseUrl(baseUrl);
  const basePath = getBasePath(baseUrl);
  return {
    baseUrl,
    cognito: {
      region: get("COGNITO_REGION", "us-east-1"),
      userPoolId: get("COGNITO_USER_POOL_ID"),
      clientId: get("COGNITO_CLIENT_ID"),
      clientSecret: get("COGNITO_CLIENT_SECRET") || undefined,
      hostedUiUrl: get("COGNITO_HOSTED_UI_URL"),
    },
    cookie: {
      authCookieName,
      authCookieDomain,
      authCookiePath: usePathBasedCookie ? "/" : authPath,
      authCookieMaxAgeSeconds: get("AUTH_COOKIE_MAX_AGE_SECONDS")
        ? Number(get("AUTH_COOKIE_MAX_AGE_SECONDS"))
        : undefined,
      refreshCookieName,
      // In mounted dev (/sso), refresh endpoint is /sso/oauth/refresh externally.
      refreshCookiePath: usePathBasedCookie ? `${basePath}/oauth/refresh` : refreshPath,
      refreshCookieMaxAgeSeconds: get("AUTH_REFRESH_COOKIE_MAX_AGE_SECONDS")
        ? Number(get("AUTH_REFRESH_COOKIE_MAX_AGE_SECONDS"))
        : undefined,
      secure,
    },
    dynamodbEndpoint: get("DYNAMODB_ENDPOINT") || undefined,
    dynamodbTableGrants:
      get("DYNAMODB_TABLE_GRANTS") ??
      `sso-${get("SLS_STAGE", get("STAGE", "dev"))}-grants`,
  };
}
