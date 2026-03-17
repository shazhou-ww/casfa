/**
 * Delegate OAuth routes: POST /api/oauth/delegate/authorize and configurable token path (default /oauth/token).
 * (authorization_code + refresh_token). No client_id in authorize; token response
 * includes client_id (delegateId) for refresh.
 */
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { createDelegate } from "./delegate-ops.ts";
import { createMemoryAuthCodeStore } from "./auth-code-store.ts";
import { createDelegateAccessToken, generateRandomToken, sha256Hex, verifyCodeChallenge } from "./token.ts";
import type { AuthCodeStore, AuthCodeEntry } from "./auth-code-store.ts";
import type { DelegateGrantStore, DelegatePermission } from "./types.ts";

const DEFAULT_ACCESS_TTL_SEC = 24 * 3600;

export type DelegateOAuthRoutesEnv = {
  Variables: {
    auth: unknown;
  };
};

export type DelegateOAuthRoutesDeps<E extends DelegateOAuthRoutesEnv = DelegateOAuthRoutesEnv> = {
  grantStore: DelegateGrantStore;
  authCodeStore?: AuthCodeStore;
  getUserId: (auth: E["Variables"]["auth"]) => string;
  baseUrl: string;
  allowedScopes?: string[];
  /** Token endpoint path. Defaults to "/oauth/token". */
  tokenPath?: string;
  /** Called after delegate is created and auth code is issued (e.g. to delete stub client info). */
  onAuthorizeSuccess?: () => void | Promise<void>;
};

function getAuthCodeStore(deps: { authCodeStore?: AuthCodeStore }): AuthCodeStore {
  return deps.authCodeStore ?? createMemoryAuthCodeStore();
}

export function createDelegateOAuthRoutes<E extends DelegateOAuthRoutesEnv>(
  deps: DelegateOAuthRoutesDeps<E>
): Hono<E> {
  const app = new Hono<E>();
  const allowedScopes = deps.allowedScopes ?? ["use_mcp"];
  const authCodeStore = getAuthCodeStore(deps);
  const tokenPath = deps.tokenPath ?? "/oauth/token";

  app.post("/api/oauth/delegate/authorize", async (c) => {
    const auth = c.get("auth");
    const userId = deps.getUserId(auth);
    if (!userId) {
      return c.json({ error: "invalid_client", error_description: "Login required" }, 401);
    }

    let body: {
      client_name?: string;
      redirect_uri?: string;
      state?: string;
      code_challenge?: string;
      code_challenge_method?: string;
      scope?: string | string[];
    };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: "invalid_request", error_description: "Invalid JSON body" }, 400);
    }

    const redirect_uri = body.redirect_uri;
    const state = body.state;
    const code_challenge = body.code_challenge;
    if (!redirect_uri || typeof redirect_uri !== "string") {
      return c.json({ error: "invalid_request", error_description: "redirect_uri required" }, 400);
    }
    if (!state || typeof state !== "string") {
      return c.json({ error: "invalid_request", error_description: "state required" }, 400);
    }
    if (!code_challenge || typeof code_challenge !== "string") {
      return c.json({ error: "invalid_request", error_description: "code_challenge required" }, 400);
    }

    let scopeList: string[] = [];
    if (body.scope != null) {
      const raw = Array.isArray(body.scope) ? body.scope : String(body.scope).split(/[\s+]+/).filter(Boolean);
      for (const s of raw) {
        if (allowedScopes.includes(s)) scopeList.push(s);
        else {
          return c.json({ error: "invalid_scope", error_description: `Scope not allowed: ${s}` }, 400);
        }
      }
    }
    if (scopeList.length === 0) scopeList = ["use_mcp"];

    const { grant, accessToken, refreshToken } = await createDelegate(deps.grantStore, {
      userId,
      clientName: (body.client_name?.trim() ?? "Delegate") || "Delegate",
      permissions: scopeList as DelegatePermission[],
    });

    const code = randomUUID().replace(/-/g, "");
    const entry: AuthCodeEntry = {
      accessToken,
      refreshToken,
      expiresIn: DEFAULT_ACCESS_TTL_SEC,
      codeChallenge: code_challenge,
      codeChallengeMethod: body.code_challenge_method ?? "S256",
      redirectUri: redirect_uri,
      createdAt: Date.now(),
      delegateId: grant.delegateId,
    };
    await Promise.resolve(authCodeStore.set(code, entry));

    await Promise.resolve(deps.onAuthorizeSuccess?.());

    const redirect_url = `${redirect_uri}${redirect_uri.includes("?") ? "&" : "?"}code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
    return c.json({ redirect_url });
  });

  app.post(tokenPath, async (c) => {
    const contentType = c.req.header("content-type") ?? "";
    if (!contentType.includes("application/x-www-form-urlencoded")) {
      return c.json({ error: "invalid_request", error_description: "Content-Type must be application/x-www-form-urlencoded" }, 400);
    }
    const form = await c.req.parseBody();
    const grant_type = form["grant_type"];
    if (grant_type === "authorization_code") {
      const code = form["code"];
      const code_verifier = form["code_verifier"];
      if (!code || typeof code !== "string") {
        return c.json({ error: "invalid_request", error_description: "code required" }, 400);
      }
      if (!code_verifier || typeof code_verifier !== "string") {
        return c.json({ error: "invalid_request", error_description: "code_verifier required" }, 400);
      }
      const entry = await Promise.resolve(authCodeStore.get(code));
      if (!entry) {
        return c.json({ error: "invalid_grant" }, 400);
      }
      const ok = await verifyCodeChallenge(code_verifier, entry.codeChallenge, entry.codeChallengeMethod);
      if (!ok) {
        return c.json({ error: "invalid_grant" }, 400);
      }
      await Promise.resolve(authCodeStore.delete(code));
      const payload: Record<string, unknown> = {
        access_token: entry.accessToken,
        refresh_token: entry.refreshToken,
        expires_in: entry.expiresIn,
        token_type: "Bearer",
      };
      if (entry.delegateId != null) payload.client_id = entry.delegateId;
      return c.json(payload);
    }

    if (grant_type === "refresh_token") {
      const refresh_token = form["refresh_token"];
      const client_id = form["client_id"];
      if (!refresh_token || typeof refresh_token !== "string") {
        return c.json({ error: "invalid_request", error_description: "refresh_token required" }, 400);
      }
      if (!client_id || typeof client_id !== "string") {
        return c.json({ error: "invalid_request", error_description: "client_id (delegateId) required for refresh" }, 400);
      }
      const grant = await deps.grantStore.get(client_id);
      if (!grant) {
        return c.json({ error: "invalid_grant" }, 400);
      }
      const hash = await sha256Hex(refresh_token);
      if (grant.refreshTokenHash !== hash) {
        return c.json({ error: "invalid_grant" }, 400);
      }
      const newAccessToken = createDelegateAccessToken(grant.userId, grant.delegateId);
      const newRefreshToken = generateRandomToken();
      const [accessTokenHash, refreshTokenHash] = await Promise.all([
        sha256Hex(newAccessToken),
        sha256Hex(newRefreshToken),
      ]);
      await deps.grantStore.updateTokens(grant.delegateId, {
        accessTokenHash,
        refreshTokenHash,
      });
      return c.json({
        access_token: newAccessToken,
        refresh_token: newRefreshToken,
        expires_in: DEFAULT_ACCESS_TTL_SEC,
        token_type: "Bearer",
      });
    }

    return c.json({ error: "unsupported_grant_type" }, 400);
  });

  return app;
}
