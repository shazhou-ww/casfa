/**
 * CASFA v2 - Application Assembly
 *
 * Pure assembly function that wires up all dependencies.
 * All dependencies must be injected - no fallback logic.
 */

import type { StorageProvider } from "@casfa/storage-core";
import type { Hono } from "hono";
import type { DbInstances } from "./bootstrap.ts";
import type { AppConfig } from "./config.ts";
// Controllers
import {
  createAdminController,
  createChunksController,
  createDepotsController,
  createHealthController,
  createInfoController,
  createOAuthController,
  createRealmController,
  createTicketsController,
  createTokensController,
  createTokenRequestsController,
} from "./controllers/index.ts";
// MCP
import { createMcpController } from "./mcp/index.ts";

// Middleware
import {
  createAccessTokenMiddleware,
  createAdminAccessMiddleware,
  createCanManageDepotMiddleware,
  createCanUploadMiddleware,
  createDelegateTokenMiddleware,
  createJwtAuthMiddleware,
  createRealmAccessMiddleware,
  createScopeValidationMiddleware,
  type JwtVerifier,
} from "./middleware/index.ts";
// Router
import { createRouter } from "./router.ts";
import type { Env } from "./types.ts";
import type { CombinedHashProvider } from "./util/hash-provider.ts";

// Re-export DbInstances for convenience
export type { DbInstances } from "./bootstrap.ts";

// Re-export hash provider from util
export { type CombinedHashProvider, createNodeHashProvider } from "./util/hash-provider.ts";

// ============================================================================
// Types
// ============================================================================

/**
 * All dependencies required by the application.
 * All fields are required - no optional/fallback logic.
 */
export type AppDependencies = {
  config: AppConfig;
  db: DbInstances;
  storage: StorageProvider;
  hashProvider: CombinedHashProvider;
  /** JWT verifier for Bearer token auth */
  jwtVerifier: JwtVerifier;
  /** Runtime configuration for /api/info endpoint */
  runtimeInfo?: {
    storageType: "memory" | "fs" | "s3";
    authType: "mock" | "cognito" | "jwt";
    databaseType: "local" | "aws";
  };
};

// ============================================================================
// App Factory
// ============================================================================

/**
 * Create the Hono app with all dependencies wired up.
 *
 * This is a pure assembly function - all dependencies must be provided.
 */
export const createApp = (deps: AppDependencies): Hono<Env> => {
  const { config, db, storage, hashProvider, jwtVerifier, runtimeInfo } = deps;
  const {
    delegateTokensDb,
    ticketsDb,
    scopeSetNodesDb,
    tokenRequestsDb,
    tokenAuditDb,
    ownershipDb,
    depotsDb,
    refCountDb,
    usageDb,
    userRolesDb,
  } = db;

  // Middleware
  const jwtAuthMiddleware = createJwtAuthMiddleware({
    jwtVerifier,
    userRolesDb,
  });
  const delegateTokenMiddleware = createDelegateTokenMiddleware({
    delegateTokensDb,
  });
  const accessTokenMiddleware = createAccessTokenMiddleware({
    delegateTokensDb,
  });
  const realmAccessMiddleware = createRealmAccessMiddleware();
  const adminAccessMiddleware = createAdminAccessMiddleware();
  const scopeValidationMiddleware = createScopeValidationMiddleware({
    storage,
    scopeSetNodesDb,
  });
  const canUploadMiddleware = createCanUploadMiddleware();
  const canManageDepotMiddleware = createCanManageDepotMiddleware();

  // Controllers
  const health = createHealthController();
  const info = createInfoController({
    serverConfig: config.server,
    featuresConfig: config.features,
    storageType: runtimeInfo?.storageType ?? "memory",
    authType: runtimeInfo?.authType ?? "jwt",
    databaseType: runtimeInfo?.databaseType ?? "aws",
  });
  const oauth = createOAuthController({
    cognitoConfig: config.cognito,
  });
  const admin = createAdminController({
    userRolesDb,
    cognitoConfig: config.cognito,
  });
  const realm = createRealmController({
    usageDb,
    serverConfig: config.server,
  });
  const tickets = createTicketsController({
    ticketsDb,
    depotsDb,
  });
  const chunks = createChunksController({
    storage,
    hashProvider,
    ownershipDb,
    refCountDb,
    usageDb,
  });
  const depots = createDepotsController({
    depotsDb,
    storage,
  });
  const tokens = createTokensController({
    delegateTokensDb,
    scopeSetNodesDb,
    tokenAuditDb,
    depotsDb,
  });
  const tokenRequests = createTokenRequestsController({
    tokenRequestsDb,
    delegateTokensDb,
    scopeSetNodesDb,
    depotsDb,
    authorizeUrlBase: config.server.baseUrl ?? "http://localhost:3500",
  });
  const mcp = createMcpController({
    delegateTokensDb,
    ownershipDb,
    storage,
    serverConfig: config.server,
  });

  // Create router
  return createRouter({
    health,
    info,
    oauth,
    admin,
    realm,
    tickets,
    chunks,
    depots,
    tokens,
    tokenRequests,
    mcp,
    jwtAuthMiddleware,
    delegateTokenMiddleware,
    accessTokenMiddleware,
    realmAccessMiddleware,
    adminAccessMiddleware,
    scopeValidationMiddleware,
    canUploadMiddleware,
    canManageDepotMiddleware,
  });
};
