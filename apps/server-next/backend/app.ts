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
    const devMockToken = createDevMockTokenController({ config: deps.config });
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

  // OAuth: exchange authorization code for tokens (client_secret or code_verifier, same as old server)
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

  app.post("/api/mcp", authMiddleware, createMcpHandler({ ...rootResolverDeps, config: deps.config }));

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
