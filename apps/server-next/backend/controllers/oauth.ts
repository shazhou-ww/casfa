import {
  buildAuthCookieHeader,
  buildClearAuthCookieHeader,
} from "@casfa/cell-auth-server";
import type { OAuthServer } from "@casfa/cell-cognito-server";
import { Hono } from "hono";

export type OAuthCookieConfig = {
  cookieName?: string;
  cookieDomain?: string;
  cookiePath?: string;
  cookieMaxAgeSeconds?: number;
  cookieSecure?: boolean;
};

type OAuthControllerDeps = {
  oauthServer: OAuthServer;
  cookieConfig?: OAuthCookieConfig;
};

export function createOAuthRoutes(deps: OAuthControllerDeps) {
  const routes = new Hono();
  const { oauthServer, cookieConfig } = deps;

  routes.get("/.well-known/oauth-authorization-server", (c) => {
    return c.json(oauthServer.getMetadata());
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

  routes.get("/oauth/authorize", (c) => {
    const result = oauthServer.handleAuthorize({
      responseType: c.req.query("response_type") ?? "code",
      clientId: c.req.query("client_id") ?? "",
      redirectUri: c.req.query("redirect_uri") ?? "",
      state: c.req.query("state") ?? "",
      scope: c.req.query("scope") ?? null,
      codeChallenge: c.req.query("code_challenge") ?? null,
      codeChallengeMethod: c.req.query("code_challenge_method") ?? null,
      identityProvider: c.req.query("identity_provider") ?? null,
    });
    return c.redirect(result.redirectUrl);
  });

  routes.get("/oauth/callback", async (c) => {
    const code = c.req.query("code");
    if (!code) return c.text("Missing authorization code", 400);

    try {
      const result = await oauthServer.handleCallback({
        code,
        state: c.req.query("state") ?? "",
      });
      return c.redirect(result.redirectUrl);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return c.text(`Token exchange failed: ${msg}`, 400);
    }
  });

  routes.get("/oauth/consent-info", (c) => {
    const session = c.req.query("session") ?? "";
    const info = oauthServer.getConsentInfo(session);
    if (!info) return c.json({ error: "expired_or_invalid_session" }, 400);
    return c.json(info);
  });

  routes.post("/oauth/approve", async (c) => {
    const body = (await c.req.json()) as { session: string; clientName: string };
    try {
      const result = await oauthServer.approveConsent({
        sessionId: body.session,
        clientName: body.clientName,
      });
      return c.json({ redirect: result.redirectUrl });
    } catch {
      return c.json({ error: "expired_or_invalid_session" }, 400);
    }
  });

  routes.post("/oauth/deny", (c) => {
    const session = c.req.query("session") ?? "";
    oauthServer.denyConsent(session);
    return c.json({ ok: true });
  });

  routes.post("/oauth/logout", (c) => {
    if (!deps.cookieConfig?.cookieName) return c.json({ ok: true }, 200);
    const clearHeader = buildClearAuthCookieHeader({
      cookieName: deps.cookieConfig.cookieName,
      cookiePath: deps.cookieConfig.cookiePath ?? "/",
      cookieDomain: deps.cookieConfig.cookieDomain,
    });
    c.header("Set-Cookie", clearHeader);
    return c.json({ ok: true }, 200);
  });

  routes.post("/oauth/token", async (c) => {
    const body = await c.req.parseBody();
    try {
      const result = await oauthServer.handleToken({
        grantType: body.grant_type as string,
        code: (body.code as string) ?? null,
        codeVerifier: (body.code_verifier as string) ?? null,
        refreshToken: (body.refresh_token as string) ?? null,
        clientId: (body.client_id as string) ?? null,
      });
      if (cookieConfig?.cookieName) {
        const headerValue = buildAuthCookieHeader(result.access_token, {
          cookieName: cookieConfig.cookieName,
          cookieDomain: cookieConfig.cookieDomain,
          cookiePath: cookieConfig.cookiePath ?? "/",
          cookieMaxAgeSeconds: cookieConfig.cookieMaxAgeSeconds,
          secure: cookieConfig.cookieSecure,
        });
        c.header("Set-Cookie", headerValue);
      }
      return c.json(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown error";
      if (msg.includes("unsupported_grant_type")) return c.json({ error: msg }, 400);
      if (msg.includes("invalid_grant"))
        return c.json({ error: "invalid_grant", message: msg }, 400);
      if (msg.includes("invalid_request"))
        return c.json({ error: "invalid_request", message: msg }, 400);
      return c.json({ error: msg }, 400);
    }
  });

  return routes;
}
