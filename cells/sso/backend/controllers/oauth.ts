/**
 * SSO OAuth routes: authorize → Cognito, callback → set cookies + redirect to return_url,
 * token (code only), refresh (from cookie), logout. Uses cell-cognito-server and cell-auth-server.
 * Base URL and cookie domain are derived from the request (Host / X-Forwarded-*) for multi-domain.
 */
import {
  buildAuthCookieHeader,
  buildClearAuthCookieHeader,
  buildClearRefreshCookieHeader,
  buildRefreshCookieHeader,
  getCookieFromRequest,
} from "@casfa/cell-auth-server";
import type { OAuthServer } from "@casfa/cell-cognito-server";
import { exchangeCodeForTokens, refreshCognitoTokens } from "@casfa/cell-cognito-server";
import type { CognitoConfig } from "@casfa/cell-cognito-server";
import { Hono } from "hono";
import type { SsoConfig } from "../config.ts";
import { getRequestBaseUrl } from "../request-url.ts";
import type { RefreshSessionStore } from "../refresh-session-store.ts";

type Deps = {
  config: SsoConfig;
  cognitoConfig: CognitoConfig;
  oauthServer: OAuthServer;
  refreshSessionStore: RefreshSessionStore;
};

const COOKIE_SIZE_WARN_THRESHOLD = 3500;

export function selectAuthCookieToken(tokens: {
  accessToken: string;
  idToken?: string | null;
}): string {
  // Prefer ID token so user profile claims (name/email) are available to app sessions.
  if (typeof tokens.idToken === "string" && tokens.idToken.length > 0) {
    return tokens.idToken;
  }
  return tokens.accessToken;
}

function toBase64Url(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString("base64");
  return raw.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function createRefreshHandle(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

function buildCognitoAuthorizeUrl(
  config: CognitoConfig,
  params: { redirectUri: string; state: string; identityProvider?: string | null }
): string {
  const query = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    scope: "openid profile email",
    redirect_uri: params.redirectUri,
    state: params.state,
  });
  if (params.identityProvider) query.set("identity_provider", params.identityProvider);
  return `${config.hostedUiUrl}/oauth2/authorize?${query}`;
}

export function createSsoOAuthRoutes(deps: Deps) {
  const routes = new Hono();
  const { config, cognitoConfig, oauthServer, refreshSessionStore } = deps;
  const cookie = config.cookie;
  const publicBaseUrl = config.baseUrl.replace(/\/$/, "");
  const callbackUri = `${publicBaseUrl}/oauth/callback`;
  const publicHost = new URL(publicBaseUrl).hostname;
  const cookieDomain = cookie.authCookieDomain ?? publicHost;
  const secure = publicHost !== "localhost" && publicHost !== "127.0.0.1";
  const sameSite = cookie.sameSite;

  function logCookieIssue(event: string, extra?: Record<string, unknown>) {
    const payload = {
      event,
      host: publicHost,
      cookieDomain,
      authCookiePath: cookie.authCookiePath,
      refreshCookiePath: cookie.refreshCookiePath,
      sameSite,
      secure,
      ...extra,
    };
    console.log(`[sso:cookie] ${JSON.stringify(payload)}`);
  }

  function logCookieSize(kind: "auth" | "refresh", token: string) {
    if (token.length > COOKIE_SIZE_WARN_THRESHOLD) {
      console.warn(
        `[sso:cookie] ${JSON.stringify({
          event: "cookie_value_too_large",
          kind,
          tokenLength: token.length,
          warnThreshold: COOKIE_SIZE_WARN_THRESHOLD,
        })}`
      );
    }
  }

  routes.get("/oauth/authorize", (c) => {
    const returnUrl = c.req.query("return_url") ?? c.req.query("state") ?? publicBaseUrl;
    const state = btoa(JSON.stringify({ return_url: returnUrl }));
    const redirectUrl = buildCognitoAuthorizeUrl(cognitoConfig, {
      redirectUri: callbackUri,
      state,
      identityProvider: c.req.query("identity_provider") ?? null,
    });
    return c.redirect(redirectUrl);
  });

  routes.get("/oauth/callback", async (c) => {
    const code = c.req.query("code");
    const stateRaw = c.req.query("state");
    if (!code) return c.text("Missing code", 400);
    let returnUrl = publicBaseUrl;
    try {
      if (stateRaw) {
        const parsed = JSON.parse(atob(stateRaw));
        if (parsed.return_url) returnUrl = parsed.return_url;
      }
    } catch {
      /* use default return_url */
    }
    try {
      const tokens = await exchangeCodeForTokens(cognitoConfig, code, callbackUri);
      const refreshHandle = createRefreshHandle();
      const refreshHandleExpiresAt =
        typeof cookie.refreshCookieMaxAgeSeconds === "number"
          ? Math.floor(Date.now() / 1000) + cookie.refreshCookieMaxAgeSeconds
          : undefined;
      await refreshSessionStore.putByHandle(refreshHandle, {
        refreshToken: tokens.refreshToken,
        expiresAt: refreshHandleExpiresAt,
      });
      const authToken = selectAuthCookieToken({
        accessToken: tokens.accessToken,
        idToken: tokens.idToken,
      });
      const authHeader = buildAuthCookieHeader(authToken, {
        cookieName: cookie.authCookieName,
        cookieDomain,
        cookiePath: cookie.authCookiePath,
        cookieMaxAgeSeconds: cookie.authCookieMaxAgeSeconds,
        secure,
        sameSite,
      });
      const refreshHeader = buildRefreshCookieHeader(refreshHandle, {
        cookieName: cookie.refreshCookieName,
        cookieDomain,
        cookiePath: cookie.refreshCookiePath,
        cookieMaxAgeSeconds: cookie.refreshCookieMaxAgeSeconds,
        secure,
        sameSite,
      });
      logCookieSize("auth", authToken);
      logCookieSize("refresh", refreshHandle);
      logCookieIssue("oauth_callback_set_cookie", {
        hasReturnUrl: Boolean(returnUrl),
        authTokenLength: authToken.length,
        refreshHandleLength: refreshHandle.length,
      });
      c.header("Set-Cookie", authHeader);
      c.res.headers.append("Set-Cookie", refreshHeader);
      return c.redirect(returnUrl);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return c.text(`Login failed: ${msg}`, 400);
    }
  });

  routes.post("/oauth/token", async (c) => {
    const body = await c.req.parseBody();
    const code = (body.code as string) ?? null;
    const codeVerifier = (body.code_verifier as string) ?? null;
    if (!code) return c.json({ error: "invalid_request", error_description: "Missing code" }, 400);
    try {
      const result = await oauthServer.handleToken({
        grantType: "authorization_code",
        code,
        codeVerifier,
        refreshToken: null,
        clientId: null,
      });
      const authHeader = buildAuthCookieHeader(result.access_token, {
        cookieName: cookie.authCookieName,
        cookieDomain,
        cookiePath: cookie.authCookiePath,
        cookieMaxAgeSeconds: cookie.authCookieMaxAgeSeconds ?? result.expires_in,
        secure,
        sameSite,
      });
      let refreshHeader: string | null = null;
      if (result.refresh_token) {
        const refreshHandle = createRefreshHandle();
        const refreshHandleExpiresAt =
          typeof cookie.refreshCookieMaxAgeSeconds === "number"
            ? Math.floor(Date.now() / 1000) + cookie.refreshCookieMaxAgeSeconds
            : undefined;
        await refreshSessionStore.putByHandle(refreshHandle, {
          refreshToken: result.refresh_token,
          expiresAt: refreshHandleExpiresAt,
        });
        refreshHeader = buildRefreshCookieHeader(refreshHandle, {
          cookieName: cookie.refreshCookieName,
          cookieDomain,
          cookiePath: cookie.refreshCookiePath,
          cookieMaxAgeSeconds: cookie.refreshCookieMaxAgeSeconds,
          secure,
          sameSite,
        });
      }
      logCookieIssue("oauth_token_set_cookie", {
        hasRefreshCookie: Boolean(refreshHeader),
      });
      c.header("Set-Cookie", authHeader);
      if (refreshHeader) c.res.headers.append("Set-Cookie", refreshHeader);
      return c.json(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("invalid_grant")) return c.json({ error: "invalid_grant", error_description: msg }, 400);
      if (msg.includes("invalid_request")) return c.json({ error: "invalid_request", error_description: msg }, 400);
      return c.json({ error: "server_error", error_description: msg }, 400);
    }
  });

  routes.post("/oauth/refresh", async (c) => {
    const refreshHandle = getCookieFromRequest(c.req.raw, cookie.refreshCookieName);
    if (!refreshHandle) return c.json({ error: "invalid_request", error_description: "Missing refresh cookie" }, 401);
    const refreshSession = await refreshSessionStore.getByHandle(refreshHandle);
    if (!refreshSession) {
      return c.json({ error: "invalid_grant", error_description: "Refresh session not found" }, 401);
    }
    try {
      const tokens = await refreshCognitoTokens(cognitoConfig, refreshSession.refreshToken);
      const nextRefreshHandle = createRefreshHandle();
      await refreshSessionStore.putByHandle(nextRefreshHandle, {
        refreshToken: refreshSession.refreshToken,
        expiresAt: refreshSession.expiresAt,
      });
      await refreshSessionStore.removeByHandle(refreshHandle);
      const authToken = selectAuthCookieToken({
        accessToken: tokens.accessToken,
        idToken: tokens.idToken,
      });
      const authHeader = buildAuthCookieHeader(authToken, {
        cookieName: cookie.authCookieName,
        cookieDomain,
        cookiePath: cookie.authCookiePath,
        cookieMaxAgeSeconds: cookie.authCookieMaxAgeSeconds ?? (tokens.expiresAt - Math.floor(Date.now() / 1000)),
        secure,
        sameSite,
      });
      const refreshHeader = buildRefreshCookieHeader(nextRefreshHandle, {
        cookieName: cookie.refreshCookieName,
        cookieDomain,
        cookiePath: cookie.refreshCookiePath,
        cookieMaxAgeSeconds: cookie.refreshCookieMaxAgeSeconds,
        secure,
        sameSite,
      });
      logCookieSize("auth", authToken);
      logCookieIssue("oauth_refresh_set_cookie", {
        authTokenLength: authToken.length,
        refreshHandleLength: nextRefreshHandle.length,
      });
      c.header("Set-Cookie", authHeader);
      c.res.headers.append("Set-Cookie", refreshHeader);
      return c.json({
        access_token: tokens.accessToken,
        id_token: tokens.idToken,
        token_type: "Bearer",
        expires_in: tokens.expiresAt - Math.floor(Date.now() / 1000),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return c.json({ error: "invalid_grant", error_description: msg }, 401);
    }
  });

  routes.post("/oauth/logout", async (c) => {
    const refreshHandle = getCookieFromRequest(c.req.raw, cookie.refreshCookieName);
    if (refreshHandle) {
      await refreshSessionStore.removeByHandle(refreshHandle);
    }
    const clearAuth = buildClearAuthCookieHeader({
      cookieName: cookie.authCookieName,
      cookiePath: cookie.authCookiePath,
      cookieDomain,
      sameSite,
    });
    const clearRefresh = buildClearRefreshCookieHeader({
      cookieName: cookie.refreshCookieName,
      cookiePath: cookie.refreshCookiePath,
      cookieDomain,
      sameSite,
    });
    logCookieIssue("oauth_logout_clear_cookie");
    c.header("Set-Cookie", clearAuth);
    c.res.headers.append("Set-Cookie", clearRefresh);
    return c.json({ ok: true }, 200);
  });

  routes.get("/.well-known/oauth-authorization-server", (c) => {
    const issuerUrl = getRequestBaseUrl(c);
    return c.json(oauthServer.getMetadata(issuerUrl));
  });

  routes.post("/oauth/register", async (c) => {
    const body = (await c.req.json()) as { client_name?: string; redirect_uris?: string[] };
    const client = oauthServer.registerClient({
      clientName: body.client_name ?? "MCP Client",
      redirectUris: body.redirect_uris ?? [],
    });
    return c.json(
      {
        client_id: client.clientId,
        client_name: client.clientName,
        redirect_uris: client.redirectUris,
      },
      201
    );
  });

  return routes;
}
