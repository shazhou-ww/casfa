/**
 * Delegate-only MCP OAuth: no Cognito. User must be logged in (SSO cookie); consent page creates
 * delegate and issues auth code, then client exchanges code at POST /oauth/token for delegate token.
 */
import { verifyCodeChallenge } from "@casfa/cell-delegates-server";
import type { OAuthServer } from "@casfa/cell-cognito-server";
import { Hono } from "hono";
import type { Env } from "../types.ts";

const AUTH_CODE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_ACCESS_TTL_SEC = 24 * 60 * 60;

type PendingCode = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  codeChallenge: string;
  codeChallengeMethod: string;
  createdAt: number;
};

type Deps = {
  oauthServer: OAuthServer;
};

export function createMcpOAuthRoutes(deps: Deps) {
  const routes = new Hono<Env>();
  const pendingCodes = new Map<string, PendingCode>();

  function cleanExpired() {
    const now = Date.now();
    for (const [k, v] of pendingCodes) {
      if (now - v.createdAt > AUTH_CODE_TTL_MS) pendingCodes.delete(k);
    }
  }

  // GET /api/oauth/mcp/client-info?client_id= — for consent page to show client name
  routes.get("/api/oauth/mcp/client-info", (c) => {
    const clientId = c.req.query("client_id") ?? "";
    if (!clientId) return c.json({ error: "missing client_id" }, 400);
    cleanExpired();
    const info = deps.oauthServer.getClientInfo(clientId);
    if (!info) return c.json({ client_name: clientId }, 200); // fallback to client_id
    return c.json({ client_name: info.clientName }, 200);
  });

  // POST /api/oauth/mcp/authorize — user already logged in (cookie); create delegate + code, return redirect_url
  routes.post("/api/oauth/mcp/authorize", async (c) => {
    const auth = c.get("auth");
    if (!auth || auth.type !== "user") {
      return c.json({ error: "unauthorized", message: "Login required" }, 401);
    }
    let body: {
      client_id?: string;
      client_name?: string;
      redirect_uri?: string;
      state?: string;
      code_challenge?: string;
      code_challenge_method?: string;
    };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: "invalid_request", message: "Invalid JSON" }, 400);
    }
    const {
      client_id,
      client_name,
      redirect_uri,
      state,
      code_challenge,
      code_challenge_method = "S256",
    } = body;
    if (!client_id || !redirect_uri || !state || !code_challenge) {
      return c.json(
        { error: "invalid_request", message: "Missing client_id, redirect_uri, state, or code_challenge" },
        400
      );
    }
    cleanExpired();
    const clientInfo = deps.oauthServer.getClientInfo(client_id);
    if (clientInfo && !clientInfo.redirectUris.includes(redirect_uri)) {
      return c.json({ error: "invalid_request", message: "redirect_uri not allowed for this client" }, 400);
    }
    const name = (client_name ?? clientInfo?.clientName ?? client_id).trim() || client_id;
    const { accessToken, refreshToken } = await deps.oauthServer.createDelegate({
      userId: auth.userId,
      clientName: name,
      permissions: ["use_mcp"],
    });
    const expiresIn = DEFAULT_ACCESS_TTL_SEC;
    const code = crypto.randomUUID().replace(/-/g, "");
    pendingCodes.set(code, {
      accessToken,
      refreshToken,
      expiresIn,
      codeChallenge: code_challenge,
      codeChallengeMethod: code_challenge_method,
      createdAt: Date.now(),
    });
    const url = new URL(redirect_uri);
    url.searchParams.set("code", code);
    url.searchParams.set("state", state);
    return c.json({ redirect_url: url.toString() }, 200);
  });

  // POST /oauth/token — exchange code for delegate token, or refresh_token grant
  routes.post("/oauth/token", async (c) => {
    const body = await c.req.parseBody();
    const grantType = (body.grant_type as string) ?? "";
    if (grantType === "authorization_code") {
      const code = (body.code as string) ?? null;
      const codeVerifier = (body.code_verifier as string) ?? null;
      if (!code) return c.json({ error: "invalid_request", error_description: "Missing code" }, 400);
      cleanExpired();
      const pending = pendingCodes.get(code);
      if (!pending) {
        return c.json({ error: "invalid_grant", error_description: "Invalid or expired code" }, 400);
      }
      pendingCodes.delete(code);
      if (!codeVerifier) {
        return c.json({ error: "invalid_request", error_description: "code_verifier required for PKCE" }, 400);
      }
      const valid = await verifyCodeChallenge(
        codeVerifier,
        pending.codeChallenge,
        pending.codeChallengeMethod
      );
      if (!valid) {
        return c.json({ error: "invalid_grant", error_description: "code_verifier mismatch" }, 400);
      }
      return c.json({
        access_token: pending.accessToken,
        token_type: "Bearer",
        expires_in: pending.expiresIn,
        refresh_token: pending.refreshToken,
      });
    }
    if (grantType === "refresh_token") {
      const result = await deps.oauthServer.handleToken({
        grantType: "refresh_token",
        code: null,
        codeVerifier: null,
        refreshToken: (body.refresh_token as string) ?? null,
        clientId: (body.client_id as string) ?? null,
      });
      return c.json(result);
    }
    return c.json({ error: "unsupported_grant_type", error_description: grantType || "missing grant_type" }, 400);
  });

  // POST /oauth/register — dynamic client registration (RFC 7591)
  routes.post("/oauth/register", async (c) => {
    let body: { client_name?: string; redirect_uris?: string[] };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: "invalid_request", error_description: "Invalid JSON" }, 400);
    }
    const client = deps.oauthServer.registerClient({
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
