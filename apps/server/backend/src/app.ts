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
  createFilesystemController,
  createHealthController,
  createInfoController,
  createOAuthController,
  createRealmController,
  createTicketsController,
  createTokenRequestsController,
  createTokensController,
} from "./controllers/index.ts";
import { createLocalAuthController } from "./controllers/local-auth.ts";
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
// Services
import { createFsService } from "./services/fs/index.ts";
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
  /** Mock JWT secret for local auth (enables local register/login) */
  mockJwtSecret?: string;
  /** Runtime configuration for /api/info endpoint */
  runtimeInfo?: {
    storageType: "memory" | "fs" | "s3";
    authType: "mock" | "cognito" | "tokens-only";
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
  const { config, db, storage, hashProvider, jwtVerifier, mockJwtSecret, runtimeInfo } = deps;
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
    localUsersDb,
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
    scopeSetNodesDb,
    getNode: (realm: string, hash: string) => storage.get(hash),
  });
  const canUploadMiddleware = createCanUploadMiddleware();
  const canManageDepotMiddleware = createCanManageDepotMiddleware();

  // Controllers
  const health = createHealthController();
  const info = createInfoController({
    serverConfig: config.server,
    featuresConfig: config.features,
    storageType: runtimeInfo?.storageType ?? "memory",
    authType: runtimeInfo?.authType ?? "tokens-only",
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
    scopeSetNodesDb,
  });
  const depots = createDepotsController({
    depotsDb,
    storage,
    ownershipDb,
  });
  const tokens = createTokensController({
    delegateTokensDb,
    scopeSetNodesDb,
    tokenAuditDb,
    depotsDb,
    getNode: (realm: string, hash: string) => storage.get(hash),
  });
  const tokenRequests = createTokenRequestsController({
    tokenRequestsDb,
    delegateTokensDb,
    scopeSetNodesDb,
    depotsDb,
    authorizeUrlBase: config.server.baseUrl ?? "http://localhost:3500",
  });
  const mcp = createMcpController({
    ticketsDb,
    ownershipDb,
    storage,
    serverConfig: config.server,
  });

  // Local Auth controller (only in mock JWT mode)
  const localAuth = mockJwtSecret
    ? createLocalAuthController({
        localUsersDb,
        userRolesDb,
        mockJwtSecret,
      })
    : undefined;

  // Filesystem service & controller
  const fsService = createFsService({
    storage,
    hashProvider,
    ownershipDb,
    refCountDb,
    usageDb,
    depotsDb,
    scopeSetNodesDb,
  });
  const filesystem = createFilesystemController({ fsService });

  // Create router
  return createRouter({
    health,
    info,
    oauth,
    localAuth,
    admin,
    realm,
    tickets,
    chunks,
    depots,
    filesystem,
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
