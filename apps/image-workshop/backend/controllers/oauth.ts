import { Hono } from "hono";
import type { DelegateGrantStore } from "../types/auth";
import type { CognitoConfig } from "../utils/cognito";
import { exchangeCodeForTokens, refreshCognitoTokens } from "../utils/cognito";
import {
  createDelegateAccessToken,
  generateDelegateId,
  generateRandomToken,
  sha256Hex,
} from "../utils/token";

type OAuthControllerDeps = {
  cognitoConfig: CognitoConfig;
  grantStore: DelegateGrantStore;
};

const DEFAULT_ACCESS_TTL_MS = 24 * 60 * 60 * 1000;
const AUTH_CODE_TTL_MS = 5 * 60 * 1000;
const CONSENT_TTL_MS = 10 * 60 * 1000;

type PendingAuthCode = {
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  expiresIn: number;
  isDelegateFlow: boolean;
  createdAt: number;
  codeChallenge?: string;
  codeChallengeMethod?: string;
};

type PendingConsent = {
  userId: string;
  userEmail?: string;
  userName?: string;
  clientRedirectUri: string;
  clientState: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  defaultClientName: string;
  createdAt: number;
};

type RegisteredClient = {
  clientName: string;
  redirectUris: string[];
  createdAt: number;
};

const pendingCodes = new Map<string, PendingAuthCode>();
const pendingConsents = new Map<string, PendingConsent>();
const registeredClients = new Map<string, RegisteredClient>();

const REGISTRATION_TTL_MS = 60 * 60 * 1000;

function cleanExpired() {
  const now = Date.now();
  for (const [k, v] of pendingCodes) {
    if (now - v.createdAt > AUTH_CODE_TTL_MS) pendingCodes.delete(k);
  }
  for (const [k, v] of pendingConsents) {
    if (now - v.createdAt > CONSENT_TTL_MS) pendingConsents.delete(k);
  }
  for (const [k, v] of registeredClients) {
    if (now - v.createdAt > REGISTRATION_TTL_MS) registeredClients.delete(k);
  }
}

async function verifyCodeChallenge(
  verifier: string,
  challenge: string,
  method: string,
): Promise<boolean> {
  if (method === "S256") {
    const hash = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    );
    const encoded = btoa(String.fromCharCode(...hash))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    return encoded === challenge;
  }
  return verifier === challenge;
}

export function createOAuthRoutes(deps: OAuthControllerDeps) {
  const routes = new Hono();
  const { cognitoConfig, grantStore } = deps;

  routes.get("/.well-known/oauth-authorization-server", (c) => {
    const origin = new URL(c.req.url).origin;
    return c.json({
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      registration_endpoint: `${origin}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["openid", "profile", "email", "delegate"],
    });
  });

  routes.post("/oauth/register", async (c) => {
    const body = await c.req.json<{ client_name?: string; redirect_uris?: string[] }>();
    cleanExpired();
    const clientName = body.client_name ?? "MCP Client";
    const virtualId = `${cognitoConfig.clientId}:${generateRandomToken().substring(0, 16)}`;
    registeredClients.set(virtualId, {
      clientName,
      redirectUris: body.redirect_uris ?? [],
      createdAt: Date.now(),
    });
    return c.json(
      {
        client_id: virtualId,
        client_name: clientName,
        redirect_uris: body.redirect_uris ?? [],
      },
      201,
    );
  });

  routes.get("/oauth/authorize", (c) => {
    const scope = c.req.query("scope") ?? "openid profile email";
    const clientState = c.req.query("state") ?? "";
    const codeChallenge = c.req.query("code_challenge") ?? "";
    const codeChallengeMethod = c.req.query("code_challenge_method") ?? "";
    const identityProvider = c.req.query("identity_provider") ?? "";
    const clientRedirectUri = c.req.query("redirect_uri") ?? "";
    const clientId = c.req.query("client_id") ?? "";

    const registered = registeredClients.get(clientId);
    const clientName = registered?.clientName ?? "MCP Client";

    const origin = new URL(c.req.url).origin;
    const serverCallbackUri = `${origin}/oauth/callback`;

    const wrappedState = btoa(
      JSON.stringify({
        s: clientState,
        r: clientRedirectUri,
        sc: scope,
        cc: codeChallenge,
        ccm: codeChallengeMethod,
        cn: clientName,
      }),
    );

    const params = new URLSearchParams({
      client_id: cognitoConfig.clientId,
      response_type: "code",
      scope: "openid profile email",
      redirect_uri: serverCallbackUri,
      state: wrappedState,
    });
    if (identityProvider) params.set("identity_provider", identityProvider);

    return c.redirect(`${cognitoConfig.hostedUiUrl}/oauth2/authorize?${params}`);
  });

  routes.get("/oauth/callback", async (c) => {
    const code = c.req.query("code");
    const stateRaw = c.req.query("state") ?? "";

    if (!code) return c.text("Missing authorization code", 400);

    let clientState = "";
    let clientRedirectUri = "";
    let scope = "openid profile email";
    let codeChallenge = "";
    let codeChallengeMethod = "";
    let clientName = "MCP Client";
    try {
      const parsed = JSON.parse(atob(stateRaw));
      clientState = parsed.s ?? "";
      clientRedirectUri = parsed.r ?? "";
      scope = parsed.sc ?? scope;
      codeChallenge = parsed.cc ?? "";
      codeChallengeMethod = parsed.ccm ?? "";
      clientName = parsed.cn ?? clientName;
    } catch {
      /* state not wrapped, treat as frontend flow */
    }

    const origin = new URL(c.req.url).origin;
    const serverCallbackUri = `${origin}/oauth/callback`;

    let cognitoTokens;
    try {
      cognitoTokens = await exchangeCodeForTokens(cognitoConfig, code, serverCallbackUri);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return c.text(`Token exchange failed: ${msg}`, 400);
    }

    const idToken = cognitoTokens.id_token;
    const payload = JSON.parse(atob(idToken.split(".")[1]));
    const userId = payload.sub as string;

    cleanExpired();

    if (scope.includes("delegate")) {
      const sessionToken = generateRandomToken();
      pendingConsents.set(sessionToken, {
        userId,
        userEmail: payload.email,
        userName: payload.name,
        clientRedirectUri,
        clientState,
        codeChallenge,
        codeChallengeMethod,
        defaultClientName: clientName,
        createdAt: Date.now(),
      });

      const consentUrl = new URL(`${origin}/oauth/consent`);
      consentUrl.searchParams.set("session", sessionToken);
      return c.redirect(consentUrl.toString());
    }

    const ourCode = generateRandomToken();
    pendingCodes.set(ourCode, {
      accessToken: cognitoTokens.access_token,
      refreshToken: cognitoTokens.refresh_token ?? "",
      idToken: cognitoTokens.id_token,
      expiresIn: cognitoTokens.expires_in,
      isDelegateFlow: false,
      createdAt: Date.now(),
      codeChallenge,
      codeChallengeMethod,
    });

    const redirectUrl = new URL(`${origin}/oauth/callback-complete`);
    redirectUrl.searchParams.set("code", ourCode);
    return c.redirect(redirectUrl.toString());
  });

  routes.get("/oauth/consent-info", (c) => {
    const session = c.req.query("session") ?? "";
    cleanExpired();
    const pending = pendingConsents.get(session);
    if (!pending) return c.json({ error: "expired_or_invalid_session" }, 400);
    return c.json({
      defaultClientName: pending.defaultClientName,
      userEmail: pending.userEmail,
      userName: pending.userName,
      permissions: ["use_mcp"],
    });
  });

  routes.post("/oauth/approve", async (c) => {
    const body = await c.req.json<{ session: string; clientName: string }>();
    cleanExpired();
    const pending = pendingConsents.get(body.session);
    if (!pending) return c.json({ error: "expired_or_invalid_session" }, 400);
    pendingConsents.delete(body.session);

    const clientName = (body.clientName || "").trim() || pending.defaultClientName;
    const delegateId = generateDelegateId();
    const accessToken = createDelegateAccessToken(pending.userId, delegateId);
    const refreshToken = generateRandomToken();
    const now = Date.now();

    await grantStore.insert({
      delegateId,
      userId: pending.userId,
      clientName,
      permissions: ["use_mcp"],
      accessTokenHash: await sha256Hex(accessToken),
      refreshTokenHash: await sha256Hex(refreshToken),
      createdAt: now,
      expiresAt: now + DEFAULT_ACCESS_TTL_MS,
    });

    const ourCode = generateRandomToken();
    pendingCodes.set(ourCode, {
      accessToken,
      refreshToken,
      expiresIn: DEFAULT_ACCESS_TTL_MS / 1000,
      isDelegateFlow: true,
      createdAt: now,
      codeChallenge: pending.codeChallenge,
      codeChallengeMethod: pending.codeChallengeMethod,
    });

    if (pending.clientRedirectUri) {
      const redirectUrl = new URL(pending.clientRedirectUri);
      redirectUrl.searchParams.set("code", ourCode);
      if (pending.clientState) redirectUrl.searchParams.set("state", pending.clientState);
      return c.json({ redirect: redirectUrl.toString() });
    }

    return c.json({ redirect: `/oauth/callback-complete?code=${ourCode}` });
  });

  routes.post("/oauth/deny", (c) => {
    const body = c.req.query("session") ?? "";
    cleanExpired();
    pendingConsents.delete(body);
    return c.json({ ok: true });
  });

  routes.post("/oauth/token", async (c) => {
    const body = await c.req.parseBody();
    const grantType = body.grant_type as string;

    if (grantType === "authorization_code") {
      const code = body.code as string;
      const codeVerifier = body.code_verifier as string | undefined;

      cleanExpired();
      const pending = pendingCodes.get(code);
      if (pending) {
        pendingCodes.delete(code);

        if (pending.codeChallenge && pending.codeChallengeMethod) {
          if (!codeVerifier) {
            return c.json({ error: "invalid_request", message: "code_verifier required" }, 400);
          }
          const valid = await verifyCodeChallenge(
            codeVerifier,
            pending.codeChallenge,
            pending.codeChallengeMethod,
          );
          if (!valid) {
            return c.json({ error: "invalid_grant", message: "code_verifier mismatch" }, 400);
          }
        }

        if (pending.isDelegateFlow) {
          return c.json({
            access_token: pending.accessToken,
            refresh_token: pending.refreshToken,
            token_type: "Bearer",
            expires_in: pending.expiresIn,
          });
        }
        return c.json({
          access_token: pending.accessToken,
          id_token: pending.idToken,
          refresh_token: pending.refreshToken,
          token_type: "Bearer",
          expires_in: pending.expiresIn,
        });
      }

      return c.json({ error: "invalid_grant", message: "Unknown or expired code" }, 400);
    }

    if (grantType === "refresh_token") {
      const refreshToken = body.refresh_token as string;
      if (!refreshToken) return c.json({ error: "missing refresh_token" }, 400);

      const isLikelyCognito = refreshToken.split(".").length >= 3;
      if (!isLikelyCognito) {
        return c.json({ error: "delegate_refresh_not_supported_here" }, 400);
      }

      let cognitoTokens;
      try {
        cognitoTokens = await refreshCognitoTokens(cognitoConfig, refreshToken);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return c.json({ error: "token_refresh_failed", message: msg }, 400);
      }
      return c.json({
        access_token: cognitoTokens.access_token,
        id_token: cognitoTokens.id_token,
        token_type: cognitoTokens.token_type,
        expires_in: cognitoTokens.expires_in,
      });
    }

    return c.json({ error: "unsupported_grant_type" }, 400);
  });

  return routes;
}
