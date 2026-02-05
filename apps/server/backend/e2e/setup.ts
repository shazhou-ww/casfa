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
import { createApp, createNodeHashProvider, type DbInstances } from "../src/app.ts";
import { createMockJwt } from "../src/auth/index.ts";
import { createMockJwtVerifier } from "../src/auth/jwt-verifier.ts";
import { type AppConfig, loadConfig } from "../src/config.ts";
// DB factories - aligned with bootstrap.ts DbInstances
import {
  createDelegateTokensDb,
  createTicketsDb,
  createScopeSetNodesDb,
  createTokenRequestsDb,
  createTokenAuditDb,
  createDepotsDb,
  createOwnershipDb,
  createRefCountDb,
  createUsageDb,
  createUserRolesDb,
} from "../src/db/index.ts";

// ============================================================================
// Test Utilities
// ============================================================================

import { hexToNodeKey } from "@casfa/protocol";
import { randomUUID } from "node:crypto";
import { uuidToUserId } from "../src/util/encoding.ts";

/** Generate a unique test ID (UUID format like Cognito) */
export const uniqueId = () => randomUUID();

/**
 * Generate a test node key from a simple numeric value
 * Creates a valid node:base32 format key
 */
export const testNodeKey = (n: number): string => {
  // Create a 16-byte hash with the number at the end
  const hex = n.toString(16).padStart(32, "0");
  return hexToNodeKey(hex);
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

/** Delegate Token creation result */
export type DelegateTokenResult = {
  tokenId: string;
  tokenBase64: string;
  expiresAt: number;
};

/** Access Token creation result */
export type AccessTokenResult = {
  tokenId: string;
  tokenBase64: string;
  expiresAt: number;
};

/** Ticket creation result (Access Token creates Ticket) */
export type TicketResult = {
  ticketId: string;
  title: string;
  status: "pending" | "submitted";
  expiresAt: number;
};

/** Client Auth Request result */
export type ClientAuthRequestResult = {
  requestId: string;
  displayCode: string;
  authorizeUrl: string;
  expiresAt: number;
  pollInterval: number;
  /** The client secret used to create the request (for test use) */
  clientSecret: string;
  /** The hash of clientSecret (for verification) */
  clientSecretHash: string;
};

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
    userId: string;      // user:base32 format (internal format)
    userUuid: string;    // UUID format (JWT sub claim)
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
  // Token Management Helpers (User JWT required)
  // ========================================================================

  /** Create a Delegate Token (User JWT → Delegate Token) */
  createDelegateToken: (
    userToken: string,
    realm: string,
    options?: {
      name?: string;
      expiresIn?: number;
      canUpload?: boolean;
      canManageDepot?: boolean;
      scope?: string[];  // Optional - defaults to MAIN depot
    }
  ) => Promise<DelegateTokenResult>;

  /** Create an Access Token (User JWT → Access Token) */
  createAccessToken: (
    userToken: string,
    realm: string,
    options?: {
      name?: string;
      expiresIn?: number;
      canUpload?: boolean;
      canManageDepot?: boolean;
      scope?: string[];  // Optional - defaults to MAIN depot
    }
  ) => Promise<AccessTokenResult>;

  // ========================================================================
  // Token Delegation Helpers (Delegate Token required)
  // ========================================================================

  /** Delegate a new token from a Delegate Token */
  delegateToken: (
    parentTokenBase64: string,
    options: {
      type: "delegate" | "access";
      expiresIn?: number;
      canUpload?: boolean;
      canManageDepot?: boolean;
      scope?: string[];
    }
  ) => Promise<DelegateTokenResult | AccessTokenResult>;

  // ========================================================================
  // Ticket Helpers (Access Token required)
  // ========================================================================

  /** Create a Ticket (Access Token creates Ticket) */
  createTicket: (
    accessTokenBase64: string,
    realm: string,
    options?: {
      title?: string;
      expiresIn?: number;
    }
  ) => Promise<TicketResult>;

  // ========================================================================
  // Client Auth Helpers
  // ========================================================================

  /** Initiate a client auth request (no auth required) */
  createClientAuthRequest: (options?: {
    clientName?: string;
    description?: string;
    /** Optional: provide your own clientSecret (will generate hash). If not provided, generates a random one */
    clientSecret?: string;
  }) => Promise<ClientAuthRequestResult>;
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
    delegateTokensDb: createDelegateTokensDb({ tableName: config.db.tokensTable }),
    ticketsDb: createTicketsDb({ tableName: config.db.casRealmTable }),
    scopeSetNodesDb: createScopeSetNodesDb({ tableName: config.db.tokensTable }),
    tokenRequestsDb: createTokenRequestsDb({ tableName: config.db.tokensTable }),
    tokenAuditDb: createTokenAuditDb({ tableName: config.db.tokensTable }),
    ownershipDb: createOwnershipDb({ tableName: config.db.casRealmTable }),
    depotsDb: createDepotsDb({ tableName: config.db.casRealmTable }),
    refCountDb: createRefCountDb({ tableName: config.db.refCountTable }),
    usageDb: createUsageDb({ tableName: config.db.usageTable }),
    userRolesDb: createUserRolesDb({ tableName: config.db.tokensTable }),
  };

  // Create storage
  const storage =
    storageType === "fs"
      ? createFsStorage({ basePath: storageFsPath, prefix: config.storage.prefix })
      : createMemoryStorage();

  // Create JWT verifier
  const jwtVerifier = createMockJwtVerifier(mockJwtSecret);

  // Create hash provider
  const hashProvider = createNodeHashProvider();

  // Create app
  const app = createApp({
    config,
    db,
    storage,
    hashProvider,
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
      const realm = `usr_${userId}`;

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
        userId,    // user:base32 format (what the system uses internally)
        userUuid,  // UUID format (what's in the JWT sub claim)
        token,
        realm,
        mainDepotId: mainDepot.depotId,  // The actual depot ID to use in scope
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
    // Token Management Helpers (User JWT required)
    // ========================================================================

    createDelegateToken: async (userToken, realm, options = {}) => {
      const {
        name = "Test Delegate Token",
        expiresIn,
        canUpload = false,
        canManageDepot = false,
        scope,  // Optional - if not provided, will use main depot
      } = options;

      // If scope not provided, get the main depot for this realm
      let finalScope = scope;
      if (!finalScope || finalScope.length === 0) {
        const mainDepot = await db.depotsDb.getByName(realm, "main");
        if (!mainDepot) {
          throw new Error(`main depot not found for realm ${realm}`);
        }
        finalScope = [`cas://depot:${mainDepot.depotId}`];
      }

      const response = await helpers.authRequest(userToken, "POST", "/api/tokens", {
        realm,
        name,
        type: "delegate",
        expiresIn,
        canUpload,
        canManageDepot,
        scope: finalScope,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to create delegate token: ${response.status} - ${error}`);
      }

      return (await response.json()) as DelegateTokenResult;
    },

    createAccessToken: async (userToken, realm, options = {}) => {
      const {
        name = "Test Access Token",
        expiresIn,
        canUpload = false,
        canManageDepot = false,
        scope,  // Optional - if not provided, will use main depot
      } = options;

      // If scope not provided, get the main depot for this realm
      let finalScope = scope;
      if (!finalScope || finalScope.length === 0) {
        const mainDepot = await db.depotsDb.getByName(realm, "main");
        if (!mainDepot) {
          throw new Error(`main depot not found for realm ${realm}`);
        }
        finalScope = [`cas://depot:${mainDepot.depotId}`];
      }

      const response = await helpers.authRequest(userToken, "POST", "/api/tokens", {
        realm,
        name,
        type: "access",
        expiresIn,
        canUpload,
        canManageDepot,
        scope: finalScope,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to create access token: ${response.status} - ${error}`);
      }

      return (await response.json()) as AccessTokenResult;
    },

    // ========================================================================
    // Token Delegation Helpers (Delegate Token required)
    // ========================================================================

    delegateToken: async (parentTokenBase64, options) => {
      const { type, expiresIn, canUpload = false, canManageDepot = false, scope } = options;

      const response = await helpers.delegateRequest(
        parentTokenBase64,
        "POST",
        "/api/tokens/delegate",
        {
          type,
          expiresIn,
          canUpload,
          canManageDepot,
          scope,
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to delegate token: ${response.status} - ${error}`);
      }

      return (await response.json()) as DelegateTokenResult | AccessTokenResult;
    },

    // ========================================================================
    // Ticket Helpers (Access Token required)
    // ========================================================================

    createTicket: async (accessTokenBase64, realm, options = {}) => {
      const { title = "Test Ticket", expiresIn } = options;

      const response = await helpers.accessRequest(
        accessTokenBase64,
        "POST",
        `/api/realm/${realm}/tickets`,
        {
          title,
          expiresIn,
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to create ticket: ${response.status} - ${error}`);
      }

      return (await response.json()) as TicketResult;
    },

    // ========================================================================
    // Client Auth Helpers
    // ========================================================================

    createClientAuthRequest: async (options = {}) => {
      const { clientName = "Test Client", description, clientSecret: providedSecret } = options;

      // Generate a client secret if not provided (32 bytes = 64 hex chars)
      const clientSecret = providedSecret ?? Array.from({ length: 32 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, "0")).join("");

      // Hash the client secret using SHA-256 (produces 64 hex chars)
      const encoder = new TextEncoder();
      const data = encoder.encode(clientSecret);
      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      const clientSecretHash = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      const response = await fetch(`${url}/api/tokens/requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientName, description, clientSecretHash }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to create client auth request: ${response.status} - ${error}`);
      }

      const result = (await response.json()) as Omit<ClientAuthRequestResult, "clientSecret" | "clientSecretHash">;
      return {
        ...result,
        clientSecret,
        clientSecretHash,
      };
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
  const hashHex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .padStart(32, "0")
    .slice(0, 32);
  return hexToNodeKey(hashHex);
};
