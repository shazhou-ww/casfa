export { createAppForGateway as createAppForBackend } from "./gateway-app";
export { createAppForGateway } from "./gateway-app";
import { getTokenFromRequest } from "@casfa/cell-auth-server";
import type { OAuthServer } from "@casfa/cell-cognito-server";
import type { PendingClientInfoStore } from "@casfa/cell-delegates-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ServerConfig } from "./config.ts";
import { createCsrfController } from "./controllers/csrf.ts";
import { createLoginRedirectRoutes } from "./controllers/login-redirect.ts";
import { createMessagesController } from "./controllers/messages.ts";
import { createSettingsController } from "./controllers/settings.ts";
import { createThreadsController } from "./controllers/threads.ts";
import type { MessageStore } from "./db/message-store.ts";
import type { SettingsStore } from "./db/settings-store.ts";
import type { ThreadStore } from "./db/thread-store.ts";
import { createAuthMiddleware } from "./middleware/auth.ts";
import { createCsrfMiddleware } from "./middleware/csrf.ts";
import { createRealmMiddleware } from "./middleware/realm.ts";
import type { Env } from "./types.ts";

export type AppDeps = {
  config: ServerConfig;
  oauthServer: OAuthServer;
  pendingClientInfoStore: PendingClientInfoStore;
  threadStore: ThreadStore;
  messageStore: MessageStore;
  settingsStore: SettingsStore;
};

export function createApp(deps: AppDeps) {
  const app = new Hono<Env>();

  app.use(
    "*",
    cors({
      origin: "*",
      allowHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    })
  );

  app.use("*", async (c, next) => {
    const cookieName = deps.config.auth.cookieName ?? undefined;
    const token = getTokenFromRequest(c.req.raw, {
      cookieName: cookieName ?? undefined,
      cookieOnly: false,
    });
    if (token) {
      const auth = await deps.oauthServer.resolveAuth(token);
      if (auth && auth.type === "user") {
        c.set("auth", {
          type: "user",
          userId: auth.userId,
          email: auth.email,
          name: auth.name,
          picture: auth.picture,
        });
      }
    }
    await next();
  });

  const oauthRoutes = createLoginRedirectRoutes(deps.config, {
    pendingClientInfoStore: deps.pendingClientInfoStore,
  });
  app.route("/", oauthRoutes);

  const csrfRoutes = createCsrfController(deps.config);
  app.route("/", csrfRoutes);

  if (deps.config.ssoBaseUrl) {
    app.use("/api/*", createCsrfMiddleware());
  }

  const authMiddleware = createAuthMiddleware();
  const realmMiddleware = createRealmMiddleware();

  app.get("/api/health", (c) => c.json({ ok: true }, 200));
  app.get("/api/info", (c) =>
    c.json({
      ssoBaseUrl: deps.config.ssoBaseUrl ?? null,
      baseUrl: deps.config.baseUrl || null,
    }, 200)
  );

  const settingsController = createSettingsController({
    settingsStore: deps.settingsStore,
  });

  app.use("/api/me", authMiddleware);
  app.get("/api/me", (c) => {
    const auth = c.get("auth");
    if (!auth) return c.json({ error: "UNAUTHORIZED", message: "Not authenticated" }, 401);
    return c.json({
      userId: auth.userId,
      email: auth.email,
      name: auth.name,
      picture: auth.picture,
    }, 200);
  });
  app.get("/api/me/settings", (c) => settingsController.list(c));
  app.get("/api/me/settings/:key", (c) => settingsController.get(c));
  app.put("/api/me/settings/:key", (c) => settingsController.set(c));
  app.use("/api/realm/:realmId/*", authMiddleware, realmMiddleware);
  app.use("/api/realm/:realmId", authMiddleware, realmMiddleware);

  const threadsController = createThreadsController({
    threadStore: deps.threadStore,
    messageStore: deps.messageStore,
  });
  const messagesController = createMessagesController({
    messageStore: deps.messageStore,
    threadStore: deps.threadStore,
  });

  app.get("/api/realm/:realmId/threads", (c) => threadsController.list(c));
  app.post("/api/realm/:realmId/threads", (c) => threadsController.create(c));
  app.get("/api/realm/:realmId/threads/:threadId", (c) => threadsController.get(c));
  app.patch("/api/realm/:realmId/threads/:threadId", (c) => threadsController.update(c));
  app.delete("/api/realm/:realmId/threads/:threadId", (c) => threadsController.delete(c));

  app.get("/api/realm/:realmId/threads/:threadId/messages", (c) => messagesController.list(c));
  app.post("/api/realm/:realmId/threads/:threadId/messages", (c) => messagesController.create(c));

  app.onError((err, c) => {
    console.error("[api] 500", c.req.method, c.req.path, err instanceof Error ? err.message : String(err));
    if (err instanceof Error && err.stack) console.error(err.stack);
    return c.json({ error: "INTERNAL_ERROR", message: err.message ?? "Internal server error" }, 500);
  });

  app.notFound((c) => c.json({ error: "NOT_FOUND", message: "Not found" }, 404));

  return app;
}
