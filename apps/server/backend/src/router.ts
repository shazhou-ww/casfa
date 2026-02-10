/**
 * CASFA v2 - Hono Router
 *
 * Delegate model router (new model only, old routes removed).
 */

import {
  ClaimNodeRequestSchema,
  CreateDelegateRequestSchema,
  CreateDepotSchema,
  DepotCommitSchema,
  FsCpRequestSchema,
  // Filesystem request schemas
  FsMkdirRequestSchema,
  FsMvRequestSchema,
  FsRewriteRequestSchema,
  FsRmRequestSchema,
  LoginSchema,
  PrepareNodesSchema,
  RefreshSchema,
  RegisterSchema,
  RootTokenRequestSchema,
  TokenExchangeSchema,
  UpdateDepotSchema,
  UpdateUserRoleSchema,
} from "@casfa/protocol";
import { zValidator } from "@hono/zod-validator";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { ZodError } from "zod";
import type { AdminController } from "./controllers/admin.ts";
import type { ChunksController } from "./controllers/chunks.ts";
import type { ClaimController } from "./controllers/claim.ts";
import type { DelegatesController } from "./controllers/delegates.ts";
import type { DepotsController } from "./controllers/depots.ts";
import type { FilesystemController } from "./controllers/filesystem.ts";
import type { HealthController } from "./controllers/health.ts";
import type { InfoController } from "./controllers/info.ts";
import type { LocalAuthController } from "./controllers/local-auth.ts";
import type { OAuthController } from "./controllers/oauth.ts";
import type { RealmController } from "./controllers/realm.ts";
import type { RefreshController } from "./controllers/refresh.ts";
import type { RootTokenController } from "./controllers/root-token.ts";
import type { McpController } from "./mcp/handler.ts";
import type { Env } from "./types.ts";

// ============================================================================
// Types
// ============================================================================

export type RouterDeps = {
  // Controllers
  health: HealthController;
  info: InfoController;
  oauth: OAuthController;
  localAuth?: LocalAuthController;
  admin: AdminController;
  realm: RealmController;
  chunks: ChunksController;
  depots: DepotsController;
  filesystem: FilesystemController;
  mcp: McpController;
  delegates: DelegatesController;
  claim: ClaimController;
  rootToken: RootTokenController;
  refreshToken: RefreshController;

  // Middleware
  jwtAuthMiddleware: MiddlewareHandler<Env>;
  authorizedUserMiddleware: MiddlewareHandler<Env>;
  accessTokenMiddleware: MiddlewareHandler<Env>;
  realmAccessMiddleware: MiddlewareHandler<Env>;
  adminAccessMiddleware: MiddlewareHandler<Env>;
  proofValidationMiddleware: MiddlewareHandler<Env>;
  canUploadMiddleware: MiddlewareHandler<Env>;
  canManageDepotMiddleware: MiddlewareHandler<Env>;
};

// ============================================================================
// Router Factory
// ============================================================================

export const createRouter = (deps: RouterDeps): Hono<Env> => {
  const app = new Hono<Env>();

  // Global error handler for Zod validation errors and other errors
  app.onError((err, c) => {
    if (err instanceof ZodError) {
      return c.json(
        {
          error: "validation_error",
          message: "Request validation failed",
          details: err.errors.map((e) => ({
            path: e.path.join("."),
            message: e.message,
          })),
        },
        400
      );
    }

    // Re-throw other errors to be handled by default error handler
    console.error("Unhandled error:", err);
    return c.json(
      {
        error: "internal_error",
        message: err.message || "An unexpected error occurred",
      },
      500
    );
  });

  // CORS
  app.use(
    "*",
    cors({
      origin: "*",
      allowHeaders: ["Content-Type", "Authorization", "X-CAS-Proof"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    })
  );

  // ============================================================================
  // Health & Info
  // ============================================================================

  app.get("/api/health", deps.health.check);
  app.get("/api/info", deps.info.getInfo);

  // ============================================================================
  // OAuth Routes
  // ============================================================================

  app.get("/api/oauth/config", deps.oauth.getConfig);
  app.post("/api/oauth/login", zValidator("json", LoginSchema), deps.oauth.login);
  app.post("/api/oauth/refresh", zValidator("json", RefreshSchema), deps.oauth.refresh);
  app.post("/api/oauth/token", zValidator("json", TokenExchangeSchema), deps.oauth.exchangeToken);
  app.get("/api/oauth/me", deps.jwtAuthMiddleware, deps.oauth.me);

  // ============================================================================
  // Local Auth Routes (only when localAuth controller is provided)
  // ============================================================================

  if (deps.localAuth) {
    app.post("/api/local/register", zValidator("json", RegisterSchema), deps.localAuth.register);
    app.post("/api/local/login", zValidator("json", LoginSchema), deps.localAuth.login);
    app.post("/api/local/refresh", zValidator("json", RefreshSchema), deps.localAuth.refresh);
  }

  // ============================================================================
  // Admin Routes
  // ============================================================================

  app.get(
    "/api/admin/users",
    deps.jwtAuthMiddleware,
    deps.adminAccessMiddleware,
    deps.admin.listUsers
  );
  app.patch(
    "/api/admin/users/:userId",
    deps.jwtAuthMiddleware,
    deps.adminAccessMiddleware,
    zValidator("json", UpdateUserRoleSchema),
    deps.admin.updateRole
  );

  // ============================================================================
  // MCP Route
  // ============================================================================

  app.post("/api/mcp", deps.jwtAuthMiddleware, deps.authorizedUserMiddleware, deps.mcp.handle);

  // ============================================================================
  // New Delegate Model Routes
  // ============================================================================

  // Root token creation (JWT → Root Delegate + RT + AT)
  app.post(
    "/api/tokens/root",
    deps.jwtAuthMiddleware,
    deps.authorizedUserMiddleware,
    zValidator("json", RootTokenRequestSchema),
    deps.rootToken.create
  );

  // Token refresh (RT → new RT + AT, rotation)
  app.post("/api/tokens/refresh", deps.refreshToken.refresh);

  // ============================================================================
  // Realm Routes (Access Token authenticated)
  // ============================================================================

  const realmRouter = new Hono<Env>();
  realmRouter.use("*", deps.accessTokenMiddleware);
  realmRouter.use("/:realmId/*", deps.realmAccessMiddleware);

  // Realm info
  realmRouter.get("/:realmId", deps.realm.getInfo);
  realmRouter.get("/:realmId/usage", deps.realm.getUsage);

  // Nodes
  realmRouter.post(
    "/:realmId/nodes/prepare",
    zValidator("json", PrepareNodesSchema),
    deps.chunks.prepareNodes
  );
  realmRouter.put("/:realmId/nodes/:key", deps.canUploadMiddleware, deps.chunks.put);
  realmRouter.get("/:realmId/nodes/:key", deps.proofValidationMiddleware, deps.chunks.get);
  realmRouter.get(
    "/:realmId/nodes/:key/metadata",
    deps.proofValidationMiddleware,
    deps.chunks.getMetadata
  );

  // Node claim (PoP-based ownership)
  realmRouter.post(
    "/:realmId/nodes/:key/claim",
    deps.canUploadMiddleware,
    zValidator("json", ClaimNodeRequestSchema),
    deps.claim.claim
  );

  // Filesystem operations (mounted under nodes/:key/fs/*)
  realmRouter.get(
    "/:realmId/nodes/:key/fs/stat",
    deps.proofValidationMiddleware,
    deps.filesystem.stat
  );
  realmRouter.get(
    "/:realmId/nodes/:key/fs/read",
    deps.proofValidationMiddleware,
    deps.filesystem.read
  );
  realmRouter.get("/:realmId/nodes/:key/fs/ls", deps.proofValidationMiddleware, deps.filesystem.ls);
  realmRouter.post(
    "/:realmId/nodes/:key/fs/write",
    deps.proofValidationMiddleware,
    deps.canUploadMiddleware,
    deps.filesystem.write
  );
  realmRouter.post(
    "/:realmId/nodes/:key/fs/mkdir",
    deps.proofValidationMiddleware,
    deps.canUploadMiddleware,
    zValidator("json", FsMkdirRequestSchema),
    deps.filesystem.mkdir
  );
  realmRouter.post(
    "/:realmId/nodes/:key/fs/rm",
    deps.proofValidationMiddleware,
    deps.canUploadMiddleware,
    zValidator("json", FsRmRequestSchema),
    deps.filesystem.rm
  );
  realmRouter.post(
    "/:realmId/nodes/:key/fs/mv",
    deps.proofValidationMiddleware,
    deps.canUploadMiddleware,
    zValidator("json", FsMvRequestSchema),
    deps.filesystem.mv
  );
  realmRouter.post(
    "/:realmId/nodes/:key/fs/cp",
    deps.proofValidationMiddleware,
    deps.canUploadMiddleware,
    zValidator("json", FsCpRequestSchema),
    deps.filesystem.cp
  );
  realmRouter.post(
    "/:realmId/nodes/:key/fs/rewrite",
    deps.proofValidationMiddleware,
    deps.canUploadMiddleware,
    zValidator("json", FsRewriteRequestSchema),
    deps.filesystem.rewrite
  );

  // Delegates (new delegate model)
  realmRouter.post(
    "/:realmId/delegates",
    zValidator("json", CreateDelegateRequestSchema),
    deps.delegates.create
  );
  realmRouter.get("/:realmId/delegates", deps.delegates.list);
  realmRouter.get("/:realmId/delegates/:delegateId", deps.delegates.get);
  realmRouter.post(
    "/:realmId/delegates/:delegateId/revoke",
    deps.delegates.revoke
  );

  // Depots
  realmRouter.get("/:realmId/depots", deps.depots.list);
  realmRouter.post(
    "/:realmId/depots",
    deps.canManageDepotMiddleware,
    zValidator("json", CreateDepotSchema),
    deps.depots.create
  );
  realmRouter.get("/:realmId/depots/:depotId", deps.depots.get);
  realmRouter.patch(
    "/:realmId/depots/:depotId",
    deps.canManageDepotMiddleware,
    zValidator("json", UpdateDepotSchema),
    deps.depots.update
  );
  realmRouter.delete(
    "/:realmId/depots/:depotId",
    deps.canManageDepotMiddleware,
    deps.depots.delete
  );
  realmRouter.post(
    "/:realmId/depots/:depotId/commit",
    deps.canUploadMiddleware,
    zValidator("json", DepotCommitSchema),
    deps.depots.commit
  );

  app.route("/api/realm", realmRouter);

  // ============================================================================
  // Static File Serving (production frontend build)
  // ============================================================================

  app.use("*", serveStatic({ root: "./backend/public" }));

  // SPA fallback: serve index.html for non-API routes
  app.use("*", serveStatic({ root: "./backend/public", path: "index.html" }));

  // ============================================================================
  // 404 Handler
  // ============================================================================

  app.notFound((c) => c.json({ error: "Not found" }, 404));

  return app;
};
