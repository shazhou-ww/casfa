/**
 * CASFA v2 - Hono Router
 *
 * Delegate Token model router.
 */

import { zValidator } from "@hono/zod-validator";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { ZodError } from "zod";
import type { AdminController } from "./controllers/admin.ts";
import type { ChunksController } from "./controllers/chunks.ts";
import type { DepotsController } from "./controllers/depots.ts";
import type { HealthController } from "./controllers/health.ts";
import type { InfoController } from "./controllers/info.ts";
import type { OAuthController } from "./controllers/oauth.ts";
import type { RealmController } from "./controllers/realm.ts";
import type { TicketsController } from "./controllers/tickets.ts";
import type { TokensController } from "./controllers/tokens.ts";
import type { TokenRequestsController } from "./controllers/token-requests.ts";
import type { McpController } from "./mcp/handler.ts";
import {
  LoginSchema,
  RefreshSchema,
  TokenExchangeSchema,
  UpdateUserRoleSchema,
  CreateDelegateTokenSchema,
  DelegateTokenSchema,
  CreateTokenRequestSchema,
  ApproveTokenRequestSchema,
  PrepareNodesSchema,
  CreateDepotSchema,
  UpdateDepotSchema,
  DepotCommitSchema,
} from "./schemas/index.ts";
import type { Env } from "./types.ts";

// ============================================================================
// Types
// ============================================================================

export type RouterDeps = {
  // Controllers
  health: HealthController;
  info: InfoController;
  oauth: OAuthController;
  admin: AdminController;
  realm: RealmController;
  tickets: TicketsController;
  chunks: ChunksController;
  depots: DepotsController;
  mcp: McpController;
  tokens: TokensController;
  tokenRequests: TokenRequestsController;

  // Middleware
  jwtAuthMiddleware: MiddlewareHandler<Env>;
  delegateTokenMiddleware: MiddlewareHandler<Env>;
  accessTokenMiddleware: MiddlewareHandler<Env>;
  realmAccessMiddleware: MiddlewareHandler<Env>;
  adminAccessMiddleware: MiddlewareHandler<Env>;
  scopeValidationMiddleware: MiddlewareHandler<Env>;
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
      allowHeaders: ["Content-Type", "Authorization", "X-CAS-Index-Path"],
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
  // Admin Routes
  // ============================================================================

  app.get("/api/admin/users", deps.jwtAuthMiddleware, deps.adminAccessMiddleware, deps.admin.listUsers);
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

  app.post("/api/mcp", deps.jwtAuthMiddleware, deps.mcp.handle);

  // ============================================================================
  // Delegate Token Routes
  // ============================================================================

  const tokensRouter = new Hono<Env>();

  // User creates initial delegate token (JWT auth required)
  tokensRouter.post(
    "/",
    deps.jwtAuthMiddleware,
    zValidator("json", CreateDelegateTokenSchema),
    deps.tokens.create
  );

  // List tokens (JWT auth)
  tokensRouter.get("/", deps.jwtAuthMiddleware, deps.tokens.list);

  // Get specific token
  tokensRouter.get("/:tokenId", deps.jwtAuthMiddleware, deps.tokens.get);

  // Revoke token (JWT auth)
  tokensRouter.delete("/:tokenId", deps.jwtAuthMiddleware, deps.tokens.revoke);

  // Re-delegate a token (requires delegate token auth)
  tokensRouter.post(
    "/:tokenId/delegate",
    deps.delegateTokenMiddleware,
    zValidator("json", DelegateTokenSchema),
    deps.tokens.delegate
  );

  app.route("/api/tokens", tokensRouter);

  // ============================================================================
  // Token Request Routes (Client Authorization Flow)
  // ============================================================================

  const tokenRequestsRouter = new Hono<Env>();

  // Client initiates authorization request (no auth required)
  tokenRequestsRouter.post("/", zValidator("json", CreateTokenRequestSchema), deps.tokenRequests.create);

  // Client polls for request status (no auth required, uses clientSecret)
  tokenRequestsRouter.get("/:requestId/poll", deps.tokenRequests.poll);

  // User views pending requests (JWT auth required)
  tokenRequestsRouter.get("/", deps.jwtAuthMiddleware, deps.tokenRequests.list);

  // User gets specific request details (JWT auth required)
  tokenRequestsRouter.get("/:requestId", deps.jwtAuthMiddleware, deps.tokenRequests.get);

  // User approves request (JWT auth required)
  tokenRequestsRouter.post(
    "/:requestId/approve",
    deps.jwtAuthMiddleware,
    zValidator("json", ApproveTokenRequestSchema),
    deps.tokenRequests.approve
  );

  // User rejects request (JWT auth required)
  tokenRequestsRouter.post("/:requestId/reject", deps.jwtAuthMiddleware, deps.tokenRequests.reject);

  app.route("/api/tokens/requests", tokenRequestsRouter);

  // ============================================================================
  // Realm Routes (Access Token authenticated)
  // ============================================================================

  const realmRouter = new Hono<Env>();
  realmRouter.use("*", deps.accessTokenMiddleware);
  realmRouter.use("/:realmId/*", deps.realmAccessMiddleware);

  // Realm info
  realmRouter.get("/:realmId", deps.realm.getInfo);
  realmRouter.get("/:realmId/usage", deps.realm.getUsage);

  // Tickets
  realmRouter.post("/:realmId/tickets", deps.canUploadMiddleware, deps.tickets.create);
  realmRouter.get("/:realmId/tickets", deps.tickets.list);
  realmRouter.get("/:realmId/tickets/:ticketId", deps.tickets.get);
  realmRouter.post("/:realmId/tickets/:ticketId/submit", deps.tickets.submit);
  realmRouter.post("/:realmId/tickets/:ticketId/revoke", deps.tickets.revoke);
  realmRouter.delete("/:realmId/tickets/:ticketId", deps.tickets.delete);

  // Nodes
  realmRouter.post("/:realmId/nodes/prepare", zValidator("json", PrepareNodesSchema), deps.chunks.prepareNodes);
  realmRouter.put("/:realmId/nodes/:key", deps.canUploadMiddleware, deps.scopeValidationMiddleware, deps.chunks.put);
  realmRouter.get("/:realmId/nodes/:key", deps.scopeValidationMiddleware, deps.chunks.get);
  realmRouter.get("/:realmId/nodes/:key/metadata", deps.scopeValidationMiddleware, deps.chunks.getMetadata);

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
  realmRouter.delete("/:realmId/depots/:depotId", deps.canManageDepotMiddleware, deps.depots.delete);
  realmRouter.post(
    "/:realmId/depots/:depotId/commit",
    deps.canUploadMiddleware,
    zValidator("json", DepotCommitSchema),
    deps.depots.commit
  );

  app.route("/api/realm", realmRouter);

  // ============================================================================
  // 404 Handler
  // ============================================================================

  app.notFound((c) => c.json({ error: "Not found" }, 404));

  return app;
};
