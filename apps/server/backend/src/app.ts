/**
 * CASFA v2 - Application Assembly
 *
 * Pure assembly function that wires up all dependencies.
 * All dependencies must be injected - no fallback logic.
 */

import { decodeNode, isWellKnownNode } from "@casfa/core";
import type { PopContext } from "@casfa/proof";
import type { StorageProvider } from "@casfa/storage-core";
import { blake3 } from "@noble/hashes/blake3";
import type { Hono, MiddlewareHandler } from "hono";
import type { DbInstances } from "./bootstrap.ts";
import type { AppConfig } from "./config.ts";
// Controllers
import {
  createAdminController,
  createChunksController,
  createClaimController,
  createDelegatesController,
  createDepotsController,
  createFilesystemController,
  createHealthController,
  createInfoController,
  createOAuthAuthController,
  createOAuthController,
  createRealmController,
  createRefreshController,
} from "./controllers/index.ts";
import { createLocalAuthController } from "./controllers/local-auth.ts";
// MCP
import { createMcpController } from "./mcp/index.ts";
// Middleware
import {
  createAccessTokenMiddleware,
  createAdminAccessMiddleware,
  createAuthorizedUserMiddleware,
  createCanManageDepotMiddleware,
  createCanUploadMiddleware,
  createJwtAuthMiddleware,
  createRealmAccessMiddleware,
  type JwtVerifier,
} from "./middleware/index.ts";
import { createProofValidationMiddleware } from "./middleware/proof-validation.ts";
// Router
import { createRouter } from "./router.ts";
// Services
import { createFsService } from "./services/fs/index.ts";
import type { Env } from "./types.ts";
import { toCrockfordBase32 } from "./util/encoding.ts";
import type { CombinedKeyProvider } from "./util/hash-provider.ts";

// Re-export DbInstances for convenience
export type { DbInstances } from "./bootstrap.ts";

// Re-export hash provider from util
export { type CombinedKeyProvider, createNodeKeyProvider } from "./util/hash-provider.ts";

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
  keyProvider: CombinedKeyProvider;
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
  /** Static file serving middleware (local dev only, not used on Lambda) */
  serveStaticMiddleware?: MiddlewareHandler<Env>;
  serveStaticFallbackMiddleware?: MiddlewareHandler<Env>;
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
  const {
    config,
    db,
    storage,
    keyProvider,
    jwtVerifier,
    mockJwtSecret,
    runtimeInfo,
    serveStaticMiddleware,
    serveStaticFallbackMiddleware,
  } = deps;
  const {
    authCodesDb,
    delegatesDb,
    oauthClientsDb,
    scopeSetNodesDb,
    ownershipV2Db,
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
  const accessTokenMiddleware = createAccessTokenMiddleware({
    delegatesDb,
    jwtVerifier,
    userRolesDb,
  });
  const realmAccessMiddleware = createRealmAccessMiddleware();
  const adminAccessMiddleware = createAdminAccessMiddleware();
  const authorizedUserMiddleware = createAuthorizedUserMiddleware();
  const proofValidationMiddleware = createProofValidationMiddleware({
    hasOwnership: (nodeHash, delegateId) =>
      isWellKnownNode(nodeHash)
        ? Promise.resolve(true)
        : ownershipV2Db.hasOwnership(nodeHash, delegateId),
    isRootDelegate: async (delegateId) => {
      // Root delegate = depth 0, parentId null.
      // The delegateId comes from the auth context, and we can look it
      // up in any realm — but we don't know the realm here.
      // However, the proof-validation middleware always runs after
      // accessTokenMiddleware, so auth.delegate is already available.
      // We use the delegates DB to check. Since delegateId is unique
      // within a realm, we need the realm. As a pragmatic workaround,
      // we check the delegate's depth from the auth context set in
      // the middleware. The middleware calls buildContext which has
      // access to auth — so we can use a closure-based approach instead.
      //
      // Note: The actual check happens inside the middleware's buildContext
      // where auth.delegate.depth === 0 is checked directly. This fallback
      // is kept for compatibility but should not normally be reached.
      return false;
    },
    getScopeRoots: async (_delegateId) => {
      // This is handled by the fast-path in buildContext using auth.delegate
      return [];
    },
    resolveNode: async (_realm, hash) => {
      const data = await storage.get(hash);
      if (!data) return null;
      const decoded = decodeNode(new Uint8Array(data));
      if (!decoded || decoded.kind !== "dict" || !decoded.children) return { children: [] };
      return {
        children: decoded.children.map((c) => Buffer.from(c).toString("hex")),
      };
    },
    resolveDepotVersion: async (_realm, depotId, version) => {
      const depot = await depotsDb.get(_realm, depotId);
      if (!depot) return null;
      // For now, just use the current root
      return depot.root ?? null;
    },
    hasDepotAccess: async (_delegateId, _depotId) => {
      // TODO: implement depot-level ACL
      return true;
    },
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
    delegatesDb,
  });
  const admin = createAdminController({
    userRolesDb,
    cognitoConfig: config.cognito,
  });
  const realm = createRealmController({
    usageDb,
    serverConfig: config.server,
  });
  const chunks = createChunksController({
    storage,
    keyProvider,
    ownershipV2Db,
    refCountDb,
    usageDb,
    scopeSetNodesDb,
  });
  const depots = createDepotsController({
    depotsDb,
    storage,
    ownershipV2Db,
  });
  const mcp = createMcpController({
    depotsDb,
  });
  const oauthAuth = createOAuthAuthController({
    serverConfig: config.server,
    authCodesDb,
    delegatesDb,
    oauthClientsDb,
  });

  // New delegate model controllers
  const delegates = createDelegatesController({
    delegatesDb,
    scopeSetNodesDb,
    depotsDb,
    getNode: (realm: string, hash: string) => storage.get(hash),
  });
  const refreshToken = createRefreshController({
    delegatesDb,
  });

  // Claim controller
  const claim = createClaimController({
    ownershipDb: ownershipV2Db,
    getNodeContent: (_realm: string, hash: string) => storage.get(hash),
    popContext: createPopContext(),
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
    keyProvider,
    ownershipV2Db,
    refCountDb,
    usageDb,
    depotsDb,
    scopeSetNodesDb,
    nodeLimit: config.server.nodeLimit,
    maxFileSize: config.server.nodeLimit,
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
    chunks,
    depots,
    filesystem,
    delegates,
    claim,
    refreshToken,
    mcp,
    oauthAuth,
    jwtAuthMiddleware,
    authorizedUserMiddleware,
    accessTokenMiddleware,
    realmAccessMiddleware,
    adminAccessMiddleware,
    proofValidationMiddleware,
    canUploadMiddleware,
    canManageDepotMiddleware,
    serveStaticMiddleware,
    serveStaticFallbackMiddleware,
  });
};

// ============================================================================
// Helpers
// ============================================================================

/**
 * Create a PopContext with real Blake3 hash functions for PoP verification.
 */
function createPopContext(): PopContext {
  return {
    blake3_256: (data: Uint8Array): Uint8Array => blake3(data),
    blake3_128_keyed: (data: Uint8Array, key: Uint8Array): Uint8Array =>
      blake3(data, { dkLen: 16, key }),
    crockfordBase32Encode: toCrockfordBase32,
  };
}
