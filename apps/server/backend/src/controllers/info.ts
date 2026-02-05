/**
 * Service info controller
 *
 * Provides public service information for clients and tools.
 * NOTE: This endpoint should NOT expose sensitive deployment details.
 */

import type { AuthType, DatabaseType, ServiceInfo, StorageType } from "@casfa/protocol";
import type { Context } from "hono";
import type { FeaturesConfig, ServerConfig } from "../config.ts";

// ============================================================================
// Types
// ============================================================================

export type InfoControllerDeps = {
  serverConfig: ServerConfig;
  featuresConfig: FeaturesConfig;
  storageType: StorageType;
  authType: AuthType;
  databaseType: DatabaseType;
};

export type InfoController = {
  getInfo: (c: Context) => Response;
};

// ============================================================================
// Version
// ============================================================================

// Read from package.json at build time or use fallback
const SERVICE_VERSION = process.env.npm_package_version ?? "0.1.0";

// ============================================================================
// Controller Factory
// ============================================================================

export const createInfoController = (deps: InfoControllerDeps): InfoController => {
  const { serverConfig, featuresConfig, storageType, authType, databaseType } = deps;

  const info: ServiceInfo = {
    service: "casfa-v2",
    version: SERVICE_VERSION,
    storage: storageType,
    auth: authType,
    database: databaseType,
    limits: {
      maxNodeSize: serverConfig.nodeLimit,
      maxNameBytes: serverConfig.maxNameBytes,
      maxCollectionChildren: serverConfig.maxCollectionChildren,
      maxPayloadSize: serverConfig.maxPayloadSize,
      maxTicketTtl: serverConfig.maxTicketTtl,
      maxDelegateTokenTtl: serverConfig.maxDelegateTokenTtl,
      maxAccessTokenTtl: serverConfig.maxAccessTokenTtl,
      maxTokenDepth: serverConfig.maxTokenDepth,
    },
    features: {
      jwtAuth: featuresConfig.jwtAuth,
      oauthLogin: featuresConfig.oauthLogin,
      awpAuth: featuresConfig.awpAuth,
    },
  };

  return {
    getInfo: (c) => c.json(info),
  };
};
