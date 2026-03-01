import { Hono } from "hono";
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

import type { KeyProvider } from "@casfa/core";

export type AppDeps = {
  config: ServerConfig;
  cas: CasFacade;
  key: KeyProvider;
  realm: RealmFacade;
  delegateGrantStore: DelegateGrantStore;
  derivedDataStore: DerivedDataStore;
  delegateStore: DelegateStore;
};

export function createApp(deps: AppDeps) {
  const app = new Hono<Env>();
  app.get("/api/health", (c) => c.json({ ok: true }, 200));
  app.get("/api/info", (c) =>
    c.json({
      storageType: deps.config.storage.type,
      authType: "mock",
    }, 200)
  );

  const authMiddleware = createAuthMiddleware({
    delegateGrantStore: deps.delegateGrantStore,
    delegateStore: deps.delegateStore,
  });
  const realmMiddleware = createRealmMiddleware();
  app.use("/api/realm/:realmId/*", authMiddleware, realmMiddleware);

  const rootResolverDeps = {
    realm: deps.realm,
    delegateStore: deps.delegateStore,
    cas: deps.cas,
    key: deps.key,
  };
  const files = createFilesController(rootResolverDeps);
  const fs = createFsController(rootResolverDeps);
  const branches = createBranchesController({ ...rootResolverDeps, config: deps.config });

  app.get("/api/realm/:realmId/files", (c) =>
    c.req.query("meta") === "1" ? files.stat(c) : files.list(c)
  );
  app.get("/api/realm/:realmId/files/*path", (c) =>
    c.req.query("meta") === "1" ? files.stat(c) : files.getOrList(c)
  );
  app.put("/api/realm/:realmId/files/*path", (c) => files.upload(c));

  app.post("/api/realm/:realmId/fs/mkdir", (c) => fs.mkdir(c));
  app.post("/api/realm/:realmId/fs/rm", (c) => fs.rm(c));
  app.post("/api/realm/:realmId/fs/mv", (c) => fs.mv(c));
  app.post("/api/realm/:realmId/fs/cp", (c) => fs.cp(c));

  app.post("/api/realm/:realmId/branches", (c) => branches.create(c));
  app.get("/api/realm/:realmId/branches", (c) => branches.list(c));
  app.post("/api/realm/:realmId/branches/:branchId/revoke", (c) => branches.revoke(c));
  app.post("/api/realm/:realmId/branches/:branchId/complete", (c) => branches.complete(c));

  app.onError((err, c) => {
    const body: ErrorBody = {
      error: "INTERNAL_ERROR",
      message: err.message ?? "Internal server error",
    };
    return c.json(body, 500);
  });
  return app;
}
