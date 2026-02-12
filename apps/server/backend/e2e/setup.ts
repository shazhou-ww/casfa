/**
 * E2E Test Setup (v2 - Delegate Token API)
 *
 * Shared setup and utilities for e2e tests.
 *
 * Requirements:
 * - DynamoDB Local running at DYNAMODB_ENDPOINT (default: http://localhost:8700)
 * - Test tables created in DynamoDB Local
 *
 * Environment variables (set automatically by this module if not already set):
 * - DYNAMODB_ENDPOINT: http://localhost:8700
 * - STORAGE_TYPE: memory
 * - MOCK_JWT_SECRET: test-secret-key-for-e2e
 * - CAS_NODE_LIMIT: 1024 (1KB for testing file chunking)
 *
 * Token Hierarchy:
 * - User JWT: OAuth login token, highest authority
 * - Delegate Token: Re-delegation token, can issue child tokens
 * - Access Token: Data access token, used for CAS operations
 */

import { rmSync } from "node:fs";
import type { StorageProvider } from "@casfa/storage-core";
import { createFsStorage } from "@casfa/storage-fs";
import { createMemoryStorage } from "@casfa/storage-memory";
import type { Server } from "bun";
import { createApp, createNodeKeyProvider, type DbInstances } from "../src/app.ts";
import { createMockJwt } from "../src/auth/index.ts";
import { createMockJwtVerifier } from "../src/auth/jwt-verifier.ts";
import { type AppConfig, loadConfig } from "../src/config.ts";
// DB factories - aligned with bootstrap.ts DbInstances
import {
  createDelegatesDb,
  createDepotsDb,
  createOwnershipV2Db,
  createRefCountDb,
  createScopeSetNodesDb,
  createUsageDb,
  createUserRolesDb,
} from "../src/db/index.ts";
import { createLocalUsersDb } from "../src/db/local-users.ts";

// ============================================================================
// Test Utilities
// ============================================================================

import { randomUUID } from "node:crypto";
import { hashToNodeKey } from "@casfa/protocol";
import { uuidToUserId } from "../src/util/encoding.ts";

/** Generate a unique test ID (UUID format like Cognito) */
export const uniqueId = () => randomUUID();

/**
 * Generate a test node key from a simple numeric value
 * Creates a valid nod_base32 format key
 */
export const testNodeKey = (n: number): string => {
  // Create a 16-byte hash with the number at the end
  const bytes = new Uint8Array(16);
  const view = new DataView(bytes.buffer);
  // Put the number in the last 4 bytes (big-endian)
  view.setUint32(12, n);
  return hashToNodeKey(bytes);
};

// ============================================================================
// Test Configuration
// ============================================================================

/** Default test configuration */
const TEST_CONFIG = {
  DYNAMODB_ENDPOINT: "http://localhost:8700",
  STORAGE_TYPE: "memory" as const,
  STORAGE_FS_PATH: "./test-storage",
  MOCK_JWT_SECRET: "test-secret-key-for-e2e",
  DYNAMODB_MAX_RETRIES: 5,
  DYNAMODB_RETRY_DELAY_MS: 1000,
  // Minimal node limit for testing file chunking (1KB)
  NODE_LIMIT: "1024",
};

/**
 * Check if DynamoDB is available and wait for it
 */
async function waitForDynamoDB(): Promise<void> {
  const { DynamoDBClient, ListTablesCommand } = await import("@aws-sdk/client-dynamodb");
  const endpoint = process.env.DYNAMODB_ENDPOINT ?? TEST_CONFIG.DYNAMODB_ENDPOINT;
  const client = new DynamoDBClient({
    region: "us-east-1",
    endpoint,
    credentials: {
      accessKeyId: "local",
      secretAccessKey: "local",
    },
  });

  for (let i = 0; i < TEST_CONFIG.DYNAMODB_MAX_RETRIES; i++) {
    try {
      await client.send(new ListTablesCommand({}));
      return; // Success
    } catch (_err) {
      if (i === TEST_CONFIG.DYNAMODB_MAX_RETRIES - 1) {
        throw new Error(
          `DynamoDB at ${endpoint} not available after ${TEST_CONFIG.DYNAMODB_MAX_RETRIES} retries.\n` +
            "Please ensure DynamoDB Local is running: docker compose up -d dynamodb\n" +
            "Then create tables: bun run db:create"
        );
      }
      await Bun.sleep(TEST_CONFIG.DYNAMODB_RETRY_DELAY_MS);
    }
  }
}

/**
 * Set test environment variables if not already set
 */
export const setupTestEnv = async () => {
  process.env.DYNAMODB_ENDPOINT ??= TEST_CONFIG.DYNAMODB_ENDPOINT;
  process.env.STORAGE_TYPE ??= TEST_CONFIG.STORAGE_TYPE;
  process.env.MOCK_JWT_SECRET ??= TEST_CONFIG.MOCK_JWT_SECRET;
  // Set minimal node limit for testing chunking
  process.env.CAS_NODE_LIMIT ??= TEST_CONFIG.NODE_LIMIT;

  if (process.env.STORAGE_TYPE === "fs") {
    process.env.STORAGE_FS_PATH ??= TEST_CONFIG.STORAGE_FS_PATH;
  }

  // Wait for DynamoDB to be available
  await waitForDynamoDB();
};

// Auto-setup test environment (async init)
let setupPromise: Promise<void> | null = null;
const ensureSetup = () => {
  if (!setupPromise) {
    setupPromise = setupTestEnv();
  }
  return setupPromise;
};

// Start setup immediately
ensureSetup();

// ============================================================================
// Test Server Types
// ============================================================================

export type TestServer = {
  server: Server<unknown>;
  url: string;
  config: AppConfig;
  db: DbInstances;
  storage: StorageProvider;
  helpers: TestHelpers;
  stop: () => void;
};

/** Root Token creation result (no RT/AT — root uses JWT auth directly) */
export type RootTokenResult = {
  delegate: {
    delegateId: string;
    realm: string;
    depth: number;
    canUpload: boolean;
    canManageDepot: boolean;
  };
};

/** Delegate Token creation result (child delegates that have RT/AT) */
export type DelegateTokenResult = {
  delegate: {
    delegateId: string;
    realm: string;
    depth: number;
    canUpload: boolean;
    canManageDepot: boolean;
  };
  refreshToken: string;
  accessToken: string;
  accessTokenExpiresAt: number;
};

/** Access Token creation result (same as DelegateTokenResult in new model) */
export type AccessTokenResult = DelegateTokenResult;

export type TestHelpers = {
  // ========================================================================
  // User JWT Helpers
  // ========================================================================

  /** Create a mock JWT token for a user (userUuid is the Cognito-style UUID) */
  createUserToken: (userUuid: string, options?: { exp?: number }) => string;

  /** Create an authorized user with a JWT token */
  createTestUser: (
    userUuid: string,
    role?: "admin" | "authorized"
  ) => Promise<{
    userId: string; // user:base32 format (internal format)
    userUuid: string; // UUID format (JWT sub claim)
    token: string;
    realm: string;
    mainDepotId: string; // The depot ID to use in scope URIs
  }>;

  // ========================================================================
  // Request Helpers
  // ========================================================================

  /** Make an authenticated request with User JWT (Bearer token) */
  authRequest: (token: string, method: string, path: string, body?: unknown) => Promise<Response>;

  /** Make a request with Delegate Token authentication (Base64) */
  delegateRequest: (
    delegateTokenBase64: string,
    method: string,
    path: string,
    body?: unknown
  ) => Promise<Response>;

  /** Make a request with Access Token authentication (Base64) */
  accessRequest: (
    accessTokenBase64: string,
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>
  ) => Promise<Response>;

  // ========================================================================
  // Token Management Helpers (User JWT required → Root Delegate + AT)
  // ========================================================================

  /** Create a root delegate token (User JWT → Root Delegate metadata, no RT/AT) */
  createRootToken: (userToken: string, realm: string) => Promise<RootTokenResult>;

  /** Create a child delegate (Access Token → Child Delegate + RT + AT) */
  createChildDelegate: (
    accessTokenBase64: string,
    realm: string,
    options?: {
      name?: string;
      expiresIn?: number;
      canUpload?: boolean;
      canManageDepot?: boolean;
      scope?: string[]; // Optional scope
    }
  ) => Promise<DelegateTokenResult>;

  // For backward compat in tests: createDelegateToken = createRootToken + optional child
  /** Create a Delegate Token (creates root, optionally with custom permissions via child) */
  createDelegateToken: (
    userToken: string,
    realm: string,
    options?: {
      name?: string;
      expiresIn?: number;
      canUpload?: boolean;
      canManageDepot?: boolean;
      scope?: string[];
    }
  ) => Promise<DelegateTokenResult>;

  /** Create an Access Token (alias for createDelegateToken in new model) */
  createAccessToken: (
    userToken: string,
    realm: string,
    options?: {
      name?: string;
      expiresIn?: number;
      canUpload?: boolean;
      canManageDepot?: boolean;
      scope?: string[];
    }
  ) => Promise<AccessTokenResult>;
};

// ============================================================================
// Test Server Factory
// ============================================================================

/**
 * Start a test server with the current environment configuration
 *
 * Uses:
 * - DynamoDB Local (via DYNAMODB_ENDPOINT)
 * - Memory or file system storage (via STORAGE_TYPE)
 * - Mock JWT authentication (via MOCK_JWT_SECRET)
 */
export const startTestServer = async (options?: { port?: number }): Promise<TestServer> => {
  // Ensure DynamoDB is ready before starting
  await ensureSetup();

  const config = loadConfig();
  const mockJwtSecret = process.env.MOCK_JWT_SECRET ?? TEST_CONFIG.MOCK_JWT_SECRET;
  const storageType = process.env.STORAGE_TYPE ?? TEST_CONFIG.STORAGE_TYPE;
  const storageFsPath = process.env.STORAGE_FS_PATH ?? TEST_CONFIG.STORAGE_FS_PATH;

  // Create DB instances (aligned with DbInstances from bootstrap.ts)
  const db: DbInstances = {
    delegatesDb: createDelegatesDb({ tableName: config.db.tokensTable }),
    scopeSetNodesDb: createScopeSetNodesDb({ tableName: config.db.tokensTable }),
    ownershipV2Db: createOwnershipV2Db({ tableName: config.db.tokensTable }),
    depotsDb: createDepotsDb({ tableName: config.db.casRealmTable }),
    refCountDb: createRefCountDb({ tableName: config.db.refCountTable }),
    usageDb: createUsageDb({ tableName: config.db.usageTable }),
    userRolesDb: createUserRolesDb({ tableName: config.db.tokensTable }),
    localUsersDb: createLocalUsersDb({ tableName: config.db.tokensTable }),
  };

  // Create storage
  const storage =
    storageType === "fs"
      ? createFsStorage({ basePath: storageFsPath, prefix: config.storage.prefix })
      : createMemoryStorage();

  // Create JWT verifier
  const jwtVerifier = createMockJwtVerifier(mockJwtSecret);

  // Create key provider
  const keyProvider = createNodeKeyProvider();

  // Create app
  const app = createApp({
    config,
    db,
    storage,
    keyProvider,
    jwtVerifier,
  });

  // Start server
  const port = options?.port ?? 0;
  const server = Bun.serve({
    fetch: app.fetch,
    port,
  });

  const url = `http://localhost:${server.port}`;

  // Test helpers
  const helpers: TestHelpers = {
    // ========================================================================
    // User JWT Helpers
    // ========================================================================

    createUserToken: (userId: string, options?: { exp?: number }) => {
      const exp = options?.exp ?? Math.floor(Date.now() / 1000) + 3600; // 1 hour default
      return createMockJwt(mockJwtSecret, { sub: userId, exp });
    },

    createTestUser: async (userUuid: string, role: "admin" | "authorized" = "authorized") => {
      // Convert UUID to user:base32 format (like the real JWT verifier does)
      const userId = uuidToUserId(userUuid);
      const realm = userId; // realm = userId (already has usr_ prefix)

      // Set user role in database (uses user:base32 format)
      await db.userRolesDb.setRole(userId, role);

      // Create default MAIN depot for the user's realm if it doesn't exist
      // Note: MAIN_DEPOT_NAME is "main" (lowercase), matching db/depots.ts
      let mainDepot = await db.depotsDb.getByName(realm, "main");
      if (!mainDepot) {
        mainDepot = await db.depotsDb.create(realm, {
          name: "main",
          root: "0".repeat(52), // Empty root hash placeholder
        });
      }

      // Create JWT token (sub is UUID, like Cognito)
      const token = helpers.createUserToken(userUuid);

      return {
        userId, // user:base32 format (what the system uses internally)
        userUuid, // UUID format (what's in the JWT sub claim)
        token,
        realm,
        mainDepotId: mainDepot.depotId, // The actual depot ID to use in scope
      };
    },

    // ========================================================================
    // Request Helpers
    // ========================================================================

    authRequest: async (token: string, method: string, path: string, body?: unknown) => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
      };
      if (body !== undefined) {
        headers["Content-Type"] = "application/json";
      }
      const request = new Request(`${url}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      return app.fetch(request);
    },

    delegateRequest: async (
      delegateTokenBase64: string,
      method: string,
      path: string,
      body?: unknown
    ) => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${delegateTokenBase64}`,
      };
      if (body !== undefined) {
        headers["Content-Type"] = "application/json";
      }
      const request = new Request(`${url}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      return app.fetch(request);
    },

    accessRequest: async (
      accessTokenBase64: string,
      method: string,
      path: string,
      body?: unknown,
      extraHeaders?: Record<string, string>
    ) => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${accessTokenBase64}`,
        ...extraHeaders,
      };
      if (body !== undefined) {
        headers["Content-Type"] = "application/json";
      }
      const request = new Request(`${url}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      return app.fetch(request);
    },

    // ========================================================================
    // Token Management Helpers (New Delegate Model)
    // ========================================================================

    createRootToken: async (userToken, realm) => {
      const response = await helpers.authRequest(userToken, "POST", "/api/tokens/root", {
        realm,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to create root token: ${response.status} - ${error}`);
      }

      const raw = (await response.json()) as any;
      return raw as RootTokenResult;
    },

    createChildDelegate: async (accessTokenBase64, realm, options = {}) => {
      const {
        name = "Test Child Delegate",
        expiresIn,
        canUpload = false,
        canManageDepot = false,
        scope,
      } = options;

      const body: Record<string, unknown> = {
        name,
        canUpload,
        canManageDepot,
      };
      if (expiresIn !== undefined) body.expiresIn = expiresIn;
      if (scope) body.scope = scope;

      const response = await helpers.accessRequest(
        accessTokenBase64,
        "POST",
        `/api/realm/${realm}/delegates`,
        body
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to create child delegate: ${response.status} - ${error}`);
      }

      const raw = (await response.json()) as any;
      return raw as DelegateTokenResult;
    },

    createDelegateToken: async (userToken, realm, options = {}) => {
      // In the new model, first ensure root delegate exists, then create
      // a child delegate using the JWT directly (middleware supports JWT auth).
      await helpers.createRootToken(userToken, realm);

      const { canUpload, canManageDepot, scope, name, expiresIn } = options;

      // Always create a child delegate — root delegates don't have AT/RT.
      // Use JWT (userToken) directly as the access token for authentication.
      return helpers.createChildDelegate(userToken, realm, {
        name: name ?? "Test Delegate",
        expiresIn,
        canUpload: canUpload ?? true,
        canManageDepot: canManageDepot ?? true,
        scope,
      });
    },

    createAccessToken: async (userToken, realm, options = {}) => {
      // In the new model, access tokens come from root delegate creation
      // or child delegate creation — both return AT
      return helpers.createDelegateToken(userToken, realm, options);
    },
  };

  const stop = () => {
    server.stop();
    // Clean up file storage if used
    if (storageType === "fs" && storageFsPath) {
      try {
        rmSync(storageFsPath, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  };

  return {
    server,
    url,
    config,
    db,
    storage,
    helpers,
    stop,
  };
};

// ============================================================================
// E2E Context
// ============================================================================

/**
 * E2E test context - provides isolated test environment
 */
export type E2EContext = {
  server: TestServer;
  baseUrl: string;
  helpers: TestHelpers;
  db: DbInstances;
  cleanup: () => void;
  /** Wait for server to be ready - call this in beforeAll */
  ready: () => Promise<void>;
};

/**
 * Create an E2E test context
 * Note: Uses a cached server instance to avoid async setup in each test file
 */
let cachedServer: TestServer | null = null;
let serverPromise: Promise<TestServer> | null = null;

const getOrCreateServer = async (): Promise<TestServer> => {
  if (cachedServer) return cachedServer;
  if (serverPromise) return serverPromise;

  serverPromise = startTestServer();
  cachedServer = await serverPromise;
  return cachedServer;
};

export const createE2EContext = (): E2EContext => {
  // Start server initialization immediately (non-blocking)
  const serverPromise = getOrCreateServer();

  // Create a lazy wrapper that will wait for server on first access
  let resolvedServer: TestServer | null = null;

  const getServer = (): TestServer => {
    if (!resolvedServer) {
      throw new Error("Server not ready - call await ctx.ready() first in beforeAll");
    }
    return resolvedServer;
  };

  return {
    get server() {
      return getServer();
    },
    get baseUrl() {
      return getServer().url;
    },
    get helpers() {
      return getServer().helpers;
    },
    get db() {
      return getServer().db;
    },
    cleanup: () => {
      if (resolvedServer) {
        resolvedServer.stop();
        resolvedServer = null;
        cachedServer = null;
      }
    },
    // New async ready method
    ready: async () => {
      resolvedServer = await serverPromise;
    },
  } as E2EContext & { ready: () => Promise<void> };
};

// ============================================================================
// Fetch Helpers
// ============================================================================

/**
 * Fetch helper with base URL
 */
export const createFetcher = (baseUrl: string) => {
  return async (path: string, options?: RequestInit) => {
    return fetch(`${baseUrl}${path}`, options);
  };
};

/**
 * Authenticated fetch helper
 */
export const createAuthFetcher = (baseUrl: string, token: string) => {
  return async (path: string, options?: RequestInit) => {
    const headers = new Headers(options?.headers);
    headers.set("Authorization", `Bearer ${token}`);

    return fetch(`${baseUrl}${path}`, {
      ...options,
      headers,
    });
  };
};

// ============================================================================
// Node Tree Test Helpers
// ============================================================================

/**
 * Build the X-CAS-Index-Path header value
 * Index-path format: colon-separated child indices from scope root
 * Example: "0:1:2" means root -> child[0] -> child[1] -> child[2]
 */
export const buildIndexPath = (...indices: number[]): string => {
  return indices.join(":");
};

/**
 * A simple test node structure for building test trees
 */
export type TestNodeData = {
  key: string;
  data: Uint8Array;
  kind: "dict" | "file" | "successor" | "set";
};

/**
 * Build a minimal CAS file node for testing
 * Note: This is a simplified version - real implementation would use @casfa/core
 */
export const buildTestFileData = (content: string): Uint8Array => {
  return new TextEncoder().encode(content);
};

/**
 * Generate a deterministic test hash from content
 * For testing purposes only - real hashes would use BLAKE3s-128
 */
export const testHashFromContent = (content: string): string => {
  const bytes = new TextEncoder().encode(content);
  // Pad or truncate to 16 bytes
  const hash = new Uint8Array(16);
  hash.set(bytes.subarray(0, 16));
  return hashToNodeKey(hash);
};
