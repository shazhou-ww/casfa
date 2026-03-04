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

export function createOAuthRoutes(deps: OAuthControllerDeps) {
  const routes = new Hono();
  const { cognitoConfig, grantStore } = deps;

  routes.get("/.well-known/oauth-authorization-server", (c) => {
    const origin = new URL(c.req.url).origin;
    return c.json({
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["openid", "profile", "email", "delegate"],
    });
  });

  routes.get("/oauth/authorize", (c) => {
    const scope = c.req.query("scope") ?? "openid profile email";
    const state = c.req.query("state") ?? "";
    const codeChallenge = c.req.query("code_challenge") ?? "";
    const codeChallengeMethod = c.req.query("code_challenge_method") ?? "";
    const identityProvider = c.req.query("identity_provider") ?? "";

    const origin = new URL(c.req.url).origin;
    const redirectUri = `${origin}/oauth/callback`;

    const params = new URLSearchParams({
      client_id: cognitoConfig.clientId,
      response_type: "code",
      scope: scope.includes("delegate") ? "openid profile email" : scope,
      redirect_uri: redirectUri,
    });
    if (state) params.set("state", state);
    if (codeChallenge) params.set("code_challenge", codeChallenge);
    if (codeChallengeMethod) params.set("code_challenge_method", codeChallengeMethod);
    if (identityProvider) params.set("identity_provider", identityProvider);

    return c.redirect(`${cognitoConfig.hostedUiUrl}/oauth2/authorize?${params}`);
  });

  routes.post("/oauth/token", async (c) => {
    const body = await c.req.parseBody();
    const grantType = body.grant_type as string;

    if (grantType === "authorization_code") {
      const code = body.code as string;
      const scope = (body.scope as string) ?? "";
      const origin = new URL(c.req.url).origin;
      const redirectUri = `${origin}/oauth/callback`;

      let cognitoTokens;
      try {
        cognitoTokens = await exchangeCodeForTokens(cognitoConfig, code, redirectUri);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return c.json({ error: "token_exchange_failed", message: msg }, 400);
      }

      if (scope.includes("delegate")) {
        const idToken = cognitoTokens.id_token;
        const payload = JSON.parse(atob(idToken.split(".")[1]));
        const userId = payload.sub as string;
        const clientName = (body.client_name as string) ?? "MCP Client";

        const delegateId = generateDelegateId();
        const accessToken = createDelegateAccessToken(userId, delegateId);
        const refreshToken = generateRandomToken();
        const now = Date.now();

        await grantStore.insert({
          delegateId,
          userId,
          clientName,
          permissions: ["use_mcp"],
          accessTokenHash: await sha256Hex(accessToken),
          refreshTokenHash: await sha256Hex(refreshToken),
          createdAt: now,
          expiresAt: now + DEFAULT_ACCESS_TTL_MS,
        });

        return c.json({
          access_token: accessToken,
          refresh_token: refreshToken,
          token_type: "Bearer",
          expires_in: DEFAULT_ACCESS_TTL_MS / 1000,
        });
      }

      return c.json({
        access_token: cognitoTokens.access_token,
        id_token: cognitoTokens.id_token,
        refresh_token: cognitoTokens.refresh_token,
        token_type: cognitoTokens.token_type,
        expires_in: cognitoTokens.expires_in,
      });
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
