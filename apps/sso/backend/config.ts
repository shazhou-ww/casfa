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

export function loadConfig(): SsoConfig {
  const baseUrl = (process.env.CELL_BASE_URL ?? "").replace(/\/$/, "");
  const secure = !isLocalhost(baseUrl);
  const authCookieName = process.env.AUTH_COOKIE_NAME ?? "auth";
  const refreshCookieName = process.env.AUTH_REFRESH_COOKIE_NAME ?? "auth_refresh";
  // When on localhost, default cookie domain to hostname so all ports (7100, 7120, ...) share the cookie.
  const explicitDomain = process.env.AUTH_COOKIE_DOMAIN?.trim() || undefined;
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
  return {
    baseUrl,
    cognito: {
      region: process.env.COGNITO_REGION ?? "us-east-1",
      userPoolId: process.env.COGNITO_USER_POOL_ID ?? "",
      clientId: process.env.COGNITO_CLIENT_ID ?? "",
      hostedUiUrl: process.env.COGNITO_HOSTED_UI_URL ?? "",
    },
    cookie: {
      authCookieName,
      authCookieDomain,
      authCookiePath: process.env.AUTH_COOKIE_PATH ?? "/",
      authCookieMaxAgeSeconds: process.env.AUTH_COOKIE_MAX_AGE_SECONDS
        ? Number(process.env.AUTH_COOKIE_MAX_AGE_SECONDS)
        : undefined,
      refreshCookieName,
      refreshCookiePath: process.env.AUTH_REFRESH_COOKIE_PATH ?? "/oauth/refresh",
      refreshCookieMaxAgeSeconds: process.env.AUTH_REFRESH_COOKIE_MAX_AGE_SECONDS
        ? Number(process.env.AUTH_REFRESH_COOKIE_MAX_AGE_SECONDS)
        : undefined,
      secure,
    },
    dynamodbEndpoint: process.env.DYNAMODB_ENDPOINT,
    dynamodbTableGrants:
      process.env.DYNAMODB_TABLE_GRANTS ??
      `sso-${process.env.SLS_STAGE ?? process.env.STAGE ?? "dev"}-grants`,
  };
}
