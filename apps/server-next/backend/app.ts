import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env, ErrorBody } from "./types.ts";
import type { ServerConfig } from "./config.ts";
import type { CasFacade } from "@casfa/cas";
import type { DelegateGrantStore } from "./db/delegate-grants.ts";
import type { DerivedDataStore } from "./db/derived-data.ts";
import type { BranchStore } from "./db/branch-store.ts";
import { createRealmInfoService } from "./services/realm-info.ts";
import { createAuthMiddleware } from "./middleware/auth.ts";
import { createRealmMiddleware } from "./middleware/realm.ts";
import { createFilesController } from "./controllers/files.ts";
import { createFsController } from "./controllers/fs.ts";
import { createBranchesController } from "./controllers/branches.ts";
import { createDelegatesController } from "./controllers/delegates.ts";
import { createRealmController } from "./controllers/realm.ts";
import { createMcpHandler } from "./mcp/handler.ts";
import { createMeController } from "./controllers/me.ts";
import { createDevMockTokenController } from "./controllers/dev-mock-token.ts";
import { ensureEmptyRoot } from "./services/root-resolver.ts";
import {
  createMcpAuthCode,
  consumeMcpAuthCodeAsync,
  createMcpDelegateToken,
  refreshMcpTokens,
  cacheTokenForUsedCode,
  getCachedTokenForUsedCode,
} from "./services/mcp-oauth.ts";

import type { KeyProvider } from "@casfa/core";

import type { UserSettingsStore } from "./db/user-settings.ts";

export type AppDeps = {
  config: ServerConfig;
  cas: CasFacade;
  key: KeyProvider;
  branchStore: BranchStore;
  delegateGrantStore: DelegateGrantStore;
  derivedDataStore: DerivedDataStore;
  userSettingsStore: UserSettingsStore;
};

export function createApp(deps: AppDeps) {
  const app = new Hono<Env>();

  app.use(
    "*",
    cors({
      origin: "*",
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    })
  );

  app.get("/api/health", (c) => c.json({ ok: true }, 200));
  app.get("/api/info", (c) =>
    c.json({
      storageType: "s3",
      authType: deps.config.auth.cognitoUserPoolId ? "cognito" : "mock",
    }, 200)
  );

  if (deps.config.auth.mockJwtSecret) {
    const devMockToken = createDevMockTokenController({
      config: deps.config,
      branchStore: deps.branchStore,
      cas: deps.cas,
      key: deps.key,
    });
    app.get("/api/dev/mock-token", (c) => devMockToken.get(c));
    app.post("/api/dev/mock-token", (c) => devMockToken.get(c));
  }

  // OAuth: config for frontend (same shape as old server — domain, clientId for building authorize URL)
  app.get("/api/oauth/config", (c) => {
    const { cognitoHostedUiUrl, cognitoClientId, cognitoUserPoolId, cognitoRegion } =
      deps.config.auth;
    if (!cognitoHostedUiUrl || !cognitoClientId) {
      return c.json(
        {
          error: "SERVICE_UNAVAILABLE",
          message: "OAuth not configured: set COGNITO_HOSTED_UI_URL and COGNITO_CLIENT_ID in .env",
        } satisfies ErrorBody,
        503
      );
    }
    let domain = cognitoHostedUiUrl.replace(/\/$/, "");
    if (domain.startsWith("https://")) domain = domain.slice(8);
    else if (domain.startsWith("http://")) domain = domain.slice(7);
    return c.json({
      domain,
      clientId: cognitoClientId,
      userPoolId: cognitoUserPoolId ?? "",
      region: cognitoRegion ?? "us-east-1",
    });
  });

  // OAuth: redirect to Cognito Hosted UI when COGNITO_HOSTED_UI_URL and COGNITO_CLIENT_ID are set
  app.get("/api/oauth/authorize", (c) => {
    const redirectUri = c.req.query("redirect_uri");
    const { cognitoHostedUiUrl, cognitoClientId } = deps.config.auth;
    if (!redirectUri) {
      return c.json(
        { error: "BAD_REQUEST", message: "Missing redirect_uri" } satisfies ErrorBody,
        400
      );
    }
    if (!cognitoHostedUiUrl || !cognitoClientId) {
      return c.json(
        {
          error: "SERVICE_UNAVAILABLE",
          message:
            "OAuth not configured: set COGNITO_HOSTED_UI_URL and COGNITO_CLIENT_ID in .env",
        } satisfies ErrorBody,
        503
      );
    }
    const base = cognitoHostedUiUrl.replace(/\/$/, "");
    const scope = "openid profile email";
    const params = new URLSearchParams({
      client_id: cognitoClientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope,
    });
    return c.redirect(`${base}/oauth2/authorize?${params.toString()}`, 302);
  });

  // OAuth: exchange authorization code for tokens (Cognito callback)
  app.post("/api/oauth/token", async (c) => {
    const { cognitoHostedUiUrl, cognitoClientId, cognitoClientSecret } = deps.config.auth;
    if (!cognitoHostedUiUrl || !cognitoClientId) {
      return c.json(
        {
          error: "SERVICE_UNAVAILABLE",
          message:
            "OAuth token exchange not configured: set COGNITO_HOSTED_UI_URL and COGNITO_CLIENT_ID in .env",
        } satisfies ErrorBody,
        503
      );
    }
    let body: { code?: string; redirect_uri?: string; code_verifier?: string };
    try {
      body = (await c.req.json()) as {
        code?: string;
        redirect_uri?: string;
        code_verifier?: string;
      };
    } catch {
      return c.json(
        { error: "BAD_REQUEST", message: "Invalid JSON body" } satisfies ErrorBody,
        400
      );
    }
    const { code, redirect_uri, code_verifier } = body;
    if (!code || !redirect_uri) {
      return c.json(
        { error: "BAD_REQUEST", message: "Missing code or redirect_uri" } satisfies ErrorBody,
        400
      );
    }
    const usePkce = Boolean(code_verifier && code_verifier.length >= 43 && code_verifier.length <= 128);
    if (!usePkce && !cognitoClientSecret) {
      return c.json(
        {
          error: "SERVICE_UNAVAILABLE",
          message:
            "OAuth token exchange requires COGNITO_CLIENT_SECRET or code_verifier (PKCE) in .env",
        } satisfies ErrorBody,
        503
      );
    }
    const base = cognitoHostedUiUrl.replace(/\/$/, "");
    const tokenUrl = `${base}/oauth2/token`;
    const formBody = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: cognitoClientId,
      code,
      redirect_uri,
    });
    if (usePkce) {
      formBody.set("code_verifier", code_verifier!);
    } else {
      formBody.set("client_secret", cognitoClientSecret!);
    }
    const tokenRes = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody.toString(),
    });
    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      return c.json(
        {
          error: "OAUTH_TOKEN_EXCHANGE_FAILED",
          message: errText || `Cognito token endpoint returned ${tokenRes.status}`,
        } satisfies ErrorBody,
        400
      );
    }
    const data = (await tokenRes.json()) as {
      id_token?: string;
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (data.id_token) {
      try {
        const payload = JSON.parse(
          Buffer.from(data.id_token.split(".")[1]!, "base64url").toString()
        ) as { sub?: string };
        const sub = payload.sub;
        if (sub) {
          const emptyKey = await ensureEmptyRoot(deps.cas, deps.key);
          await deps.branchStore.ensureRealmRoot(sub, emptyKey);
        }
      } catch {
        // ignore decode/ensure errors; still return tokens
      }
    }
    return c.json({
      id_token: data.id_token,
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
    });
  });

  const authMiddleware = createAuthMiddleware({
    delegateGrantStore: deps.delegateGrantStore,
    branchStore: deps.branchStore,
    config: deps.config,
  });
  const realmMiddleware = createRealmMiddleware();
  app.use("/api/realm/:realmId/*", authMiddleware, realmMiddleware);
  app.use("/api/realm/:realmId", authMiddleware, realmMiddleware);

  const realmInfoService = createRealmInfoService({
    cas: deps.cas,
    branchStore: deps.branchStore,
    delegateGrantStore: deps.delegateGrantStore,
  });
  const rootResolverDeps = {
    branchStore: deps.branchStore,
    cas: deps.cas,
    key: deps.key,
  };
  const files = createFilesController(rootResolverDeps);
  const fs = createFsController(rootResolverDeps);
  const branches = createBranchesController({ ...rootResolverDeps, config: deps.config });
  const delegates = createDelegatesController({ delegateGrantStore: deps.delegateGrantStore });
  const realm = createRealmController({ realmInfoService });
  const me = createMeController({ userSettingsStore: deps.userSettingsStore });

  app.use("/api/me", authMiddleware);
  app.get("/api/me", (c) => me.get(c));
  app.get("/api/me/settings", (c) => me.getSettings(c));
  app.patch("/api/me/settings", (c) => me.patchSettings(c));

  app.get("/api/realm/:realmId/files", (c) =>
    c.req.query("meta") === "1" ? files.stat(c) : files.list(c)
  );
  app.get("/api/realm/:realmId/files/:path{.+}", (c) =>
    c.req.query("meta") === "1" ? files.stat(c) : files.getOrList(c)
  );
  app.put("/api/realm/:realmId/files/:path{.+}", (c) => files.upload(c));

  app.post("/api/realm/:realmId/fs/mkdir", (c) => fs.mkdir(c));
  app.post("/api/realm/:realmId/fs/rm", (c) => fs.rm(c));
  app.post("/api/realm/:realmId/fs/mv", (c) => fs.mv(c));
  app.post("/api/realm/:realmId/fs/cp", (c) => fs.cp(c));

  app.post("/api/realm/:realmId/branches", (c) => branches.create(c));
  app.get("/api/realm/:realmId/branches", (c) => branches.list(c));
  app.post("/api/realm/:realmId/branches/:branchId/revoke", (c) => branches.revoke(c));
  app.post("/api/realm/:realmId/branches/:branchId/complete", (c) => branches.complete(c));

  app.get("/api/realm/:realmId", (c) => realm.info(c));
  app.get("/api/realm/:realmId/usage", (c) => realm.usage(c));
  app.post("/api/realm/:realmId/gc", (c) => realm.gc(c));

  app.get("/api/realm/:realmId/delegates", (c) => delegates.list(c));
  app.post("/api/realm/:realmId/delegates/assign", (c) => delegates.assign(c));
  app.post("/api/realm/:realmId/delegates/:delegateId/revoke", (c) => delegates.revoke(c));

  // OAuth 2.0 Dynamic Client Registration (RFC 7591): client can send client_name; we store and return client_id.
  const clientMetadataByClientId = new Map<string, { client_name?: string }>();
  app.post("/api/oauth/mcp/register", async (c) => {
    let body: { client_name?: string; redirect_uris?: string[] };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_client_metadata", error_description: "Invalid JSON" }, 400);
    }
    const redirectUris = Array.isArray(body.redirect_uris) && body.redirect_uris.length > 0
      ? body.redirect_uris
      : ["cursor://anysphere.cursor-mcp/oauth/callback"];
    const clientName = typeof body.client_name === "string" ? body.client_name.trim() || undefined : undefined;
    const clientId = "casfa-" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    clientMetadataByClientId.set(clientId, { client_name: clientName });
    console.log("[mcp-oauth] register", { client_name: clientName, redirect_uris: redirectUris, issued_client_id: clientId });
    return c.json(
      {
        client_id: clientId,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        redirect_uris: redirectUris,
        ...(clientName && { client_name: clientName }),
      },
      201
    );
  });
  app.get("/api/oauth/mcp/client-info", (c) => {
    const clientId = c.req.query("client_id");
    if (!clientId) {
      return c.json({ error: "BAD_REQUEST", message: "Missing client_id" }, 400);
    }
    const meta = clientMetadataByClientId.get(clientId);
    console.log("[mcp-oauth] client-info", { client_id: clientId, found: !!meta, client_name: meta?.client_name ?? null });
    return c.json({ client_name: meta?.client_name ?? null });
  });

  // MCP OAuth: create authorization code (requires user auth); frontend calls after user approves.
  app.post("/api/oauth/mcp/authorize", authMiddleware, async (c) => {
    const auth = c.get("auth");
    if (!auth || auth.type !== "user") {
      return c.json({ error: "UNAUTHORIZED", message: "User auth required" }, 401);
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
      body = await c.req.json();
    } catch {
      return c.json({ error: "BAD_REQUEST", message: "Invalid JSON" }, 400);
    }
    const { client_id, client_name, redirect_uri, state, code_challenge, code_challenge_method } = body;
    if (!client_id || !redirect_uri || !state || !code_challenge) {
      return c.json(
        { error: "BAD_REQUEST", message: "Missing client_id, redirect_uri, state, or code_challenge" },
        400
      );
    }
    console.log("[mcp-oauth] authorize", { client_id, redirect_uri: redirect_uri.slice(0, 60) + (redirect_uri.length > 60 ? "…" : "") });
    const realmId = auth.userId;
    const code = createMcpAuthCode({
      clientId: client_id,
      clientName: client_name?.trim() || undefined,
      redirectUri: redirect_uri,
      codeChallenge: code_challenge,
      codeChallengeMethod: code_challenge_method ?? "S256",
      state,
      realmId,
    });
    const sep = redirect_uri.includes("?") ? "&" : "?";
    const redirectUrl = `${redirect_uri}${sep}code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
    return c.json({ redirect_url: redirectUrl }, 200);
  });

  // MCP OAuth: exchange code for access token (Cursor POSTs here; discovery token_endpoint = /api/oauth/mcp/token)
  app.post("/api/oauth/mcp/token", async (c) => {
    const contentType = c.req.header("Content-Type") ?? "";
    let params: Record<string, string>;
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const text = await c.req.text();
      params = Object.fromEntries(new URLSearchParams(text)) as Record<string, string>;
    } else {
      return c.json({ error: "BAD_REQUEST", message: "Content-Type must be application/x-www-form-urlencoded" }, 400);
    }
    const grant_type = params.grant_type;
    console.log("[mcp-oauth] token", { grant_type, client_id: params.client_id ?? "(none)" });

    if (grant_type === "refresh_token") {
      const refresh_token = params.refresh_token;
      const client_id = params.client_id;
      if (!refresh_token || !client_id) {
        return c.json(
          { error: "invalid_request", error_description: "Missing refresh_token or client_id" },
          400
        );
      }
      let result = await refreshMcpTokens(
        refresh_token,
        client_id,
        deps.config,
        deps.delegateGrantStore
      );
      // DynamoDB GSI2 is eventually consistent; client often sends refresh immediately after code exchange, so retry once after short delay (local dev / DDB local)
      if (!result) {
        await new Promise((r) => setTimeout(r, 180));
        result = await refreshMcpTokens(
          refresh_token,
          client_id,
          deps.config,
          deps.delegateGrantStore
        );
      }
      if (!result) {
        return c.json(
          { error: "invalid_grant", error_description: "Invalid or expired refresh token" },
          400
        );
      }
      return c.json({
        access_token: result.accessToken,
        refresh_token: result.refreshToken,
        token_type: "Bearer",
        expires_in: result.expiresIn,
        refresh_expires_in: result.refreshExpiresIn,
      });
    }

    if (grant_type !== "authorization_code") {
      return c.json(
        { error: "invalid_request", error_description: "grant_type must be authorization_code or refresh_token" },
        400
      );
    }
    const code = params.code;
    const redirect_uri = params.redirect_uri;
    const client_id = params.client_id;
    const code_verifier = params.code_verifier;
    if (!code || !redirect_uri || !client_id || !code_verifier) {
      return c.json(
        { error: "invalid_request", error_description: "Missing or invalid grant_type, code, redirect_uri, client_id, or code_verifier" },
        400
      );
    }
    const entry = await consumeMcpAuthCodeAsync(code, { client_id, redirect_uri, code_verifier });
    if (!entry) {
      const cached = getCachedTokenForUsedCode(code);
      if (cached) {
        return c.json({
          access_token: cached.accessToken,
          refresh_token: cached.refreshToken,
          token_type: "Bearer",
          expires_in: cached.expiresIn,
          refresh_expires_in: cached.refreshExpiresIn,
        });
      }
      return c.json(
        { error: "invalid_grant", error_description: "Invalid or expired code or PKCE mismatch" },
        400
      );
    }
    const { accessToken, refreshToken, expiresIn, refreshExpiresIn } = await createMcpDelegateToken(
      entry.realmId,
      entry.clientName ?? entry.clientId,
      deps.config,
      deps.delegateGrantStore
    );
    cacheTokenForUsedCode(code, accessToken, refreshToken, expiresIn, refreshExpiresIn);
    return c.json({
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: "Bearer",
      expires_in: expiresIn,
      refresh_expires_in: refreshExpiresIn,
    });
  });

  // MCP: GET /api/mcp — we do not support long-lived streaming (Lambda would timeout). Return 405 so clients use POST (JSON-RPC) only and stop polling.
  const mcpGetHandler = (c: { req: { header: (n: string) => string | undefined }; json: (body: unknown, status?: number) => Response }) => {
    const accept = c.req.header("Accept") ?? "";
    const isStreamRequest = accept.includes("text/event-stream");
    return c.json(
      {
        error: "METHOD_NOT_ALLOWED",
        message: isStreamRequest
          ? "Streaming (SSE/streamableHttp) not supported in this deployment; use POST /api/mcp for JSON-RPC."
          : "Use POST /api/mcp for JSON-RPC.",
        jsonrpc: "2.0",
        id: 0,
        result: null,
      },
      405
    );
  };
  app.get("/api/mcp", authMiddleware, mcpGetHandler);
  app.get("/api/mcp/", authMiddleware, mcpGetHandler);
  // POST to exact path or any subpath (Cursor may POST to e.g. /api/mcp/sse or /api/mcp/messages)
  app.post("/api/mcp", authMiddleware, createMcpHandler({ ...rootResolverDeps, config: deps.config }));
  app.post("/api/mcp/*", authMiddleware, createMcpHandler({ ...rootResolverDeps, config: deps.config }));
  // Any other method/path under /api/mcp (e.g. GET /api/mcp/oauth) → JSON so no empty-body 404
  app.all("/api/mcp/*", (c) =>
    c.json(
      {
        error: "NOT_FOUND",
        message: "Only POST /api/mcp (JSON-RPC) and GET /api/mcp (SSE with Bearer) are supported. No OAuth discovery.",
      } satisfies ErrorBody,
      404
    )
  );

  app.onError((err, c) => {
    const body: ErrorBody = {
      error: "INTERNAL_ERROR",
      message: err.message ?? "Internal server error",
    };
    return c.json(body, 500);
  });

  app.notFound((c) =>
    c.json({ error: "NOT_FOUND", message: "Not found" } satisfies ErrorBody, 404)
  );

  return app;
}
