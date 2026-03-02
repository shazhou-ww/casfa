import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env, ErrorBody } from "./types.ts";
import type { ServerConfig } from "./config.ts";
import type { CasFacade } from "@casfa/cas";
import type { RealmFacade } from "@casfa/realm";
import type { DelegateStore } from "@casfa/realm";
import type { DelegateGrantStore } from "./db/delegate-grants.ts";
import type { DerivedDataStore } from "./db/derived-data.ts";
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
  realm: RealmFacade;
  delegateGrantStore: DelegateGrantStore;
  derivedDataStore: DerivedDataStore;
  delegateStore: DelegateStore;
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
      storageType: deps.config.storage.type,
      authType: deps.config.auth.cognitoUserPoolId ? "cognito" : "mock",
    }, 200)
  );

  if (deps.config.auth.mockJwtSecret) {
    const devMockToken = createDevMockTokenController({ config: deps.config });
    app.get("/api/dev/mock-token", (c) => devMockToken.get(c));
    app.post("/api/dev/mock-token", (c) => devMockToken.get(c));
  }

  const authMiddleware = createAuthMiddleware({
    delegateGrantStore: deps.delegateGrantStore,
    delegateStore: deps.delegateStore,
    config: deps.config,
  });
  const realmMiddleware = createRealmMiddleware();
  app.use("/api/realm/:realmId/*", authMiddleware, realmMiddleware);
  app.use("/api/realm/:realmId", authMiddleware, realmMiddleware);

  const rootResolverDeps = {
    realm: deps.realm,
    delegateStore: deps.delegateStore,
    cas: deps.cas,
    key: deps.key,
  };
  const files = createFilesController(rootResolverDeps);
  const fs = createFsController(rootResolverDeps);
  const branches = createBranchesController({ ...rootResolverDeps, config: deps.config });
  const delegates = createDelegatesController({ delegateGrantStore: deps.delegateGrantStore });
  const realm = createRealmController(rootResolverDeps);
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
