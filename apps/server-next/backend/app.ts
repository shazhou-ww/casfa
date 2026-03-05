import type { CasFacade } from "@casfa/cas";
import type { OAuthServer } from "@casfa/cell-oauth";
import type { KeyProvider } from "@casfa/core";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ServerConfig } from "./config.ts";
import { isMockAuthEnabled } from "./config.ts";
import { createBranchesController } from "./controllers/branches.ts";
import { createDelegatesRoutes } from "./controllers/delegates.ts";
import { createDevMockTokenController } from "./controllers/dev-mock-token.ts";
import { createFilesController } from "./controllers/files.ts";
import { createFsController } from "./controllers/fs.ts";
import { createMeController } from "./controllers/me.ts";
import { createOAuthRoutes } from "./controllers/oauth.ts";
import { createRealmController } from "./controllers/realm.ts";
import type { BranchStore } from "./db/branch-store.ts";
import type { DerivedDataStore } from "./db/derived-data.ts";
import type { RealmUsageStore } from "./db/realm-usage-store.ts";
import type { UserSettingsStore } from "./db/user-settings.ts";
import { createMcpHandler } from "./mcp/handler.ts";
import { createAuthMiddleware } from "./middleware/auth.ts";
import { createRealmMiddleware } from "./middleware/realm.ts";
import { createRealmInfoService } from "./services/realm-info.ts";
import type { AuthContext, Env, ErrorBody } from "./types.ts";

export type AppDeps = {
  config: ServerConfig;
  cas: CasFacade;
  key: KeyProvider;
  branchStore: BranchStore;
  derivedDataStore: DerivedDataStore;
  realmUsageStore: RealmUsageStore;
  userSettingsStore: UserSettingsStore;
  oauthServer: OAuthServer;
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

  const oauthRoutes = createOAuthRoutes({
    oauthServer: deps.oauthServer,
    appOrigin: deps.config.appOrigin,
  });
  app.route("/", oauthRoutes);

  /** Decode branch token (base64url of branchId) to branchId */
  function decodeBranchToken(token: string): string | null {
    try {
      const padded = token.replace(/-/g, "+").replace(/_/g, "/");
      const bin = atob(padded);
      return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    } catch {
      return null;
    }
  }

  app.use("*", async (c, next) => {
    const header = c.req.header("Authorization") ?? c.req.header("authorization");
    const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
    if (!token) {
      await next();
      return;
    }
    const auth = await deps.oauthServer.resolveAuth(token);
    if (auth) {
      if (auth.type === "user") {
        c.set("auth", { type: "user", userId: auth.userId } satisfies Env["Variables"]["auth"]);
      } else {
        c.set("auth", {
          type: "delegate",
          realmId: auth.userId,
          delegateId: auth.delegateId,
          clientId: auth.delegateId,
          permissions: auth.permissions,
        } as AuthContext);
      }
      await next();
      return;
    }
    const branchId = decodeBranchToken(token);
    if (branchId) {
      const branch = await deps.branchStore.getBranch(branchId);
      if (branch && Date.now() <= branch.expiresAt) {
        c.set("auth", {
          type: "worker",
          realmId: branch.realmId,
          branchId: branch.branchId,
          access: "readwrite",
        } satisfies Env["Variables"]["auth"]);
      }
    }
    await next();
  });

  app.get("/api/health", (c) => c.json({ ok: true }, 200));
  app.get("/api/info", (c) =>
    c.json(
      {
        storageType: "s3",
        authType: isMockAuthEnabled(deps.config)
          ? "mock"
          : deps.config.auth.cognitoUserPoolId
            ? "cognito"
            : "mock",
      },
      200
    )
  );

  if (isMockAuthEnabled(deps.config)) {
    const devMockToken = createDevMockTokenController({
      config: deps.config,
      branchStore: deps.branchStore,
      cas: deps.cas,
      key: deps.key,
    });
    app.get("/api/dev/mock-token", (c) => devMockToken.get(c));
    app.post("/api/dev/mock-token", (c) => devMockToken.get(c));
  }

  const authMiddleware = createAuthMiddleware();
  const realmMiddleware = createRealmMiddleware();
  app.use("/api/realm/:realmId/*", authMiddleware, realmMiddleware);
  app.use("/api/realm/:realmId", authMiddleware, realmMiddleware);

  const realmInfoService = createRealmInfoService({
    cas: deps.cas,
    key: deps.key,
    branchStore: deps.branchStore,
    oauthServer: deps.oauthServer,
    realmUsageStore: deps.realmUsageStore,
  });
  const rootResolverDeps = {
    branchStore: deps.branchStore,
    cas: deps.cas,
    key: deps.key,
    recordNewKey: (realmId: string, nodeKey: string) =>
      realmInfoService.recordNewKey(realmId, nodeKey),
  };
  const files = createFilesController(rootResolverDeps);
  const fs = createFsController(rootResolverDeps);
  const branches = createBranchesController({ ...rootResolverDeps, config: deps.config });
  const realm = createRealmController({ realmInfoService });
  const me = createMeController({ userSettingsStore: deps.userSettingsStore });

  app.route("/", createDelegatesRoutes({ oauthServer: deps.oauthServer }));

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

  // MCP: GET /mcp — we do not support long-lived streaming (Lambda would timeout). Return 405 so clients use POST (JSON-RPC) only and stop polling.
  const mcpGetHandler = (c: {
    req: { header: (n: string) => string | undefined };
    json: (body: unknown, status?: number) => Response;
  }) => {
    const accept = c.req.header("Accept") ?? "";
    const isStreamRequest = accept.includes("text/event-stream");
    return c.json(
      {
        error: "METHOD_NOT_ALLOWED",
        message: isStreamRequest
          ? "Streaming (SSE/streamableHttp) not supported in this deployment; use POST /mcp for JSON-RPC."
          : "Use POST /mcp for JSON-RPC.",
        jsonrpc: "2.0",
        id: 0,
        result: null,
      },
      405
    );
  };
  app.get("/mcp", authMiddleware, mcpGetHandler);
  app.get("/mcp/", authMiddleware, mcpGetHandler);
  // POST to exact path or any subpath (Cursor may POST to e.g. /mcp/sse or /mcp/messages)
  app.post("/mcp", authMiddleware, createMcpHandler({ ...rootResolverDeps, config: deps.config }));
  app.post(
    "/mcp/*",
    authMiddleware,
    createMcpHandler({ ...rootResolverDeps, config: deps.config })
  );
  // Any other method/path under /mcp (e.g. GET /mcp/oauth) → JSON so no empty-body 404
  app.all("/mcp/*", (c) =>
    c.json(
      {
        error: "NOT_FOUND",
        message:
          "Only POST /mcp (JSON-RPC) and GET /mcp (SSE with Bearer) are supported. No OAuth discovery.",
      } satisfies ErrorBody,
      404
    )
  );

  app.onError((err, c) => {
    console.error(
      "[api] 500",
      c.req.method,
      c.req.path,
      err instanceof Error ? err.message : String(err)
    );
    if (err instanceof Error && err.stack) console.error(err.stack);
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
