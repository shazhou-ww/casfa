import { getTokenFromRequest } from "@casfa/cell-auth-server";
import type { DelegateGrantStore, PendingClientInfoStore } from "@casfa/cell-delegates-server";
import {
  createDelegatesRoutes,
  createDelegateOAuthRoutes,
  createMemoryAuthCodeStore,
} from "@casfa/cell-delegates-server";
import type { OAuthServer } from "@casfa/cell-cognito-server";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ServerConfig } from "./config.ts";
import { createLoginRedirectRoutes } from "./controllers/login-redirect.ts";
import { createMcpRoutes } from "./controllers/mcp.ts";
import type { Env } from "./types.ts";

export type AppDeps = {
  config: ServerConfig;
  grantStore: DelegateGrantStore;
  oauthServer: OAuthServer;
  pendingClientInfoStore: PendingClientInfoStore;
};

export function createApp(deps: AppDeps) {
  const app = new Hono<Env>();

  app.use("*", async (c, next) => {
    const cookieName = deps.config.auth.cookieName ?? undefined;
    const token = getTokenFromRequest(c.req.raw, {
      cookieName: cookieName ?? undefined,
      cookieOnly: false,
    });
    if (!token) {
      await next();
      return;
    }
    const auth = await deps.oauthServer.resolveAuth(token);
    if (auth) {
      c.set("auth", auth);
    }
    await next();
  });

  const oauthRoutes = createLoginRedirectRoutes(deps.config, {
    pendingClientInfoStore: deps.pendingClientInfoStore,
  });
  app.route("/", oauthRoutes);

  app.get("/api/info", (c) =>
    c.json({ ssoBaseUrl: deps.config.ssoBaseUrl ?? null })
  );
  app.get("/api/me", (c) => {
    const auth = c.get("auth");
    if (!auth || auth.type !== "user") {
      return c.json({ error: "Unauthorized" }, 401);
    }
    return c.json({
      userId: auth.userId,
      email: auth.email,
      name: auth.name,
      picture: auth.picture,
    });
  });

  const delegateAllowedScopes = ["use_mcp", "manage_delegates"];
  app.route(
    "/",
    createDelegateOAuthRoutes({
      grantStore: deps.grantStore,
      authCodeStore: createMemoryAuthCodeStore(),
      getUserId: (auth: unknown) => {
        const a = auth as Env["Variables"]["auth"];
        return a?.type === "user" ? a.userId : "";
      },
      baseUrl: deps.config.baseUrl,
      allowedScopes: delegateAllowedScopes,
      onAuthorizeSuccess: () => deps.pendingClientInfoStore.delete("mcp"),
    })
  );

  app.route(
    "/",
    createDelegatesRoutes({
      grantStore: deps.grantStore,
      getUserId: (auth) => (auth?.type === "user" ? auth.userId : ""),
    })
  );

  const mcpRoutes = createMcpRoutes();
  app.route("/", mcpRoutes);

  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json({ error: err.message }, err.status);
    }
    console.error("[api] 500", c.req.method, c.req.path, err instanceof Error ? err.message : String(err));
    if (err instanceof Error && err.stack) console.error(err.stack);
    return c.json({ error: "INTERNAL_ERROR", message: err.message ?? "Internal server error" }, 500);
  });

  app.notFound((c) => c.json({ error: "NOT_FOUND", message: "Not found" }, 404));

  return app;
}

export type App = ReturnType<typeof createApp>;
