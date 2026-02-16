/**
 * CASFA v2 - Unified Server
 *
 * This server uses environment variables to select implementations:
 *
 * Database:
 * - DYNAMODB_ENDPOINT: DynamoDB endpoint (default: AWS, set to http://localhost:8700 for local)
 *
 * Storage (STORAGE_TYPE):
 * - "s3": S3 storage (requires CAS_BUCKET)
 * - "fs": File system storage (requires STORAGE_FS_PATH)
 * - "memory": In-memory storage (default if no CAS_BUCKET)
 *
 * Authentication:
 * - MOCK_JWT_SECRET: If set, uses mock JWT verification instead of Cognito
 * - COGNITO_USER_POOL_ID: Cognito user pool ID (for production)
 */

import { createFsStorage } from "@casfa/storage-fs";
import { createMemoryStorage } from "@casfa/storage-memory";
import { createS3Storage } from "@casfa/storage-s3";
import { serveStatic } from "hono/bun";
import { createApp, createNodeKeyProvider } from "./src/app.ts";
import { createCognitoJwtVerifier, createMockJwtVerifier } from "./src/auth/index.ts";
import { createDbInstances, createRedis } from "./src/bootstrap.ts";
import { loadConfig } from "./src/config.ts";

// ============================================================================
// Configuration
// ============================================================================

const port = Number.parseInt(process.env.PORT_CASFA_V2_API ?? process.env.PORT ?? "8801", 10);

// Storage configuration
const storageType = process.env.STORAGE_TYPE ?? (process.env.CAS_BUCKET ? "s3" : "memory");
const storageFsPath = process.env.STORAGE_FS_PATH;

// JWT configuration
const mockJwtSecret = process.env.MOCK_JWT_SECRET;

// Load configuration
const config = loadConfig();

// ============================================================================
// Create Dependencies
// ============================================================================

// Create Redis client (returns null when disabled)
const redis = createRedis(config);

// Create DB instances with optional Redis cache layer
const db = createDbInstances(config, redis);

// Create storage based on STORAGE_TYPE
const createStorage = () => {
  switch (storageType) {
    case "fs":
      if (!storageFsPath) {
        throw new Error("STORAGE_FS_PATH is required when STORAGE_TYPE=fs");
      }
      return createFsStorage({ basePath: storageFsPath, prefix: config.storage.prefix });
    case "memory":
      return createMemoryStorage();
    default:
      return createS3Storage({
        bucket: config.storage.bucket,
        prefix: config.storage.prefix,
        region: config.storage.region,
      });
  }
};

const storage = createStorage();

// Create JWT verifier based on environment
const createJwtVerifier = () => {
  // Mock JWT takes precedence (for testing)
  if (mockJwtSecret) {
    return createMockJwtVerifier(mockJwtSecret);
  }
  // Cognito JWT for production
  if (config.cognito.userPoolId) {
    return createCognitoJwtVerifier(config.cognito);
  }
  // No JWT verification - always reject (stored tokens only mode)
  return async () => null;
};

const jwtVerifier = createJwtVerifier();

// Create key provider
const keyProvider = createNodeKeyProvider();

// Determine runtime info for /api/info endpoint
const getAuthType = (): "mock" | "cognito" | "tokens-only" => {
  if (mockJwtSecret) return "mock";
  if (config.cognito.userPoolId) return "cognito";
  return "tokens-only";
};

const getDatabaseType = (): "local" | "aws" => {
  return process.env.DYNAMODB_ENDPOINT ? "local" : "aws";
};

// ============================================================================
// Create App
// ============================================================================

const app = createApp({
  config,
  db,
  storage,
  keyProvider,
  jwtVerifier,
  mockJwtSecret,
  runtimeInfo: {
    storageType: storageType as "memory" | "fs" | "s3",
    authType: getAuthType(),
    databaseType: getDatabaseType(),
  },
  // Static file serving for local dev (production uses S3 + CloudFront)
  serveStaticMiddleware: serveStatic({ root: "./backend/public" }),
  serveStaticFallbackMiddleware: serveStatic({ root: "./backend/public", path: "index.html" }),
});

// ============================================================================
// Start Server
// ============================================================================

const getStorageDescription = () => {
  switch (storageType) {
    case "fs":
      return `file system (${storageFsPath})`;
    case "memory":
      return "in-memory";
    default:
      return `S3 (${config.storage.bucket})`;
  }
};

const getAuthDescription = () => {
  if (mockJwtSecret) return "Mock JWT";
  if (config.cognito.userPoolId) return "Cognito JWT";
  return "stored tokens only";
};

console.log(`[CASFA v2] Starting server...`);
console.log(`[CASFA v2] Listening on http://localhost:${port}`);
console.log(`[CASFA v2] Storage: ${getStorageDescription()}`);
console.log(`[CASFA v2] Auth: ${getAuthDescription()}`);
console.log(`[CASFA v2] Redis: ${redis ? config.redis.url : "disabled"}`);
if (process.env.DYNAMODB_ENDPOINT) {
  console.log(`[CASFA v2] DynamoDB: ${process.env.DYNAMODB_ENDPOINT}`);
}

Bun.serve({
  port,
  fetch: app.fetch,
});
