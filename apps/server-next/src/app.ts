import { Hono } from "hono";
import type { Env, ErrorBody } from "./types.ts";
import type { ServerConfig } from "./config.ts";
import type { CasFacade } from "@casfa/cas";
import type { RealmFacade } from "@casfa/realm";
import type { DelegateGrantStore } from "./db/delegate-grants.ts";
import type { DerivedDataStore } from "./db/derived-data.ts";

export type AppDeps = {
  config: ServerConfig;
  cas: CasFacade;
  realm: RealmFacade;
  delegateGrantStore: DelegateGrantStore;
  derivedDataStore: DerivedDataStore;
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
  app.onError((err, c) => {
    const body: ErrorBody = {
      error: "INTERNAL_ERROR",
      message: err.message ?? "Internal server error",
    };
    return c.json(body, 500);
  });
  return app;
}
