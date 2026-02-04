/**
 * E2E Test Setup
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
 */

import { rmSync } from "node:fs";
// casfa-client SDK
import {
  type CasfaAnonymousClient,
  type CasfaDelegateClient,
  type CasfaTicketClient,
  type CasfaUserClient,
  createCasfaClient,
  createDelegateClient,
  createTicketClient,
  createUserClient,
} from "@casfa/client";
import type { StorageProvider } from "@casfa/storage-core";
import { createFsStorage } from "@casfa/storage-fs";
import { createMemoryStorage } from "@casfa/storage-memory";
import type { Server } from "bun";
import { createApp, createNodeHashProvider, type DbInstances } from "../src/app.ts";
import { createMockJwt } from "../src/auth/index.ts";
import { createMockJwtVerifier } from "../src/auth/jwt-verifier.ts";
import { type AppConfig, loadConfig } from "../src/config.ts";
// DB factories
import {
  createAwpPendingDb,
  createAwpPubkeysDb,
  createClientPendingDb,
  createClientPubkeysDb,
  createDepotsDb,
  createOwnershipDb,
  createRefCountDb,
  createTokensDb,
  createUsageDb,
  createUserRolesDb,
} from "../src/db/index.ts";
// Auth service
import { type AuthService, createAuthService } from "../src/services/auth.ts";

// ============================================================================
// Test Utilities
// ============================================================================

import { hexToNodeKey } from "@casfa/protocol";

/** Generate a unique test ID */
export const uniqueId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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
  authService: AuthService;
  helpers: TestHelpers;
  stop: () => void;
};

/** Agent Token creation result */
export type AgentTokenResult = {
  id: string;
  token: string;
  name: string;
  expiresAt: number;
};

/** Ticket creation result */
export type TicketResult = {
  ticketId: string;
  realm: string;
  input?: string[];
  writable: boolean;
  expiresAt: number;
};

export type TestHelpers = {
  /** Create a mock JWT token for a user */
  createUserToken: (userId: string, options?: { exp?: number }) => string;
  /** Create an authorized user with a token */
  createTestUser: (
    userId: string,
    role?: "admin" | "authorized"
  ) => Promise<{
    userId: string;
    token: string;
    realm: string;
  }>;
  /** Make an authenticated request */
  authRequest: (token: string, method: string, path: string, body?: unknown) => Promise<Response>;
  /** Create an Agent Token for a user */
  createAgentToken: (
    token: string,
    options?: { name?: string; description?: string; expiresIn?: number }
  ) => Promise<AgentTokenResult>;
  /** Create a Ticket for a realm */
  createTicket: (
    token: string,
    realm: string,
    options?: {
      input?: string[];
      purpose?: string;
      writable?: { quota?: number; accept?: string[] };
      expiresIn?: number;
    }
  ) => Promise<TicketResult>;
  /** Make a request with Ticket authentication */
  ticketRequest: (
    ticketId: string,
    method: string,
    path: string,
    body?: unknown
  ) => Promise<Response>;
  /** Make a request with Agent Token authentication */
  agentRequest: (
    agentToken: string,
    method: string,
    path: string,
    body?: unknown
  ) => Promise<Response>;

  // ========================================================================
  // SDK Client Factory Methods
  // ========================================================================

  /** Create an anonymous SDK client (no authentication) */
  getAnonymousClient: () => CasfaAnonymousClient;
  /** Create a user-authenticated SDK client */
  getUserClient: (token: string) => CasfaUserClient;
  /** Create an agent-authenticated SDK client (delegate) */
  getDelegateClient: (agentToken: string) => CasfaDelegateClient;
  /** Create a ticket-authenticated SDK client */
  getTicketClient: (ticketId: string, realmId: string) => CasfaTicketClient;
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

  // Create DB instances (uses DYNAMODB_ENDPOINT)
  const db: DbInstances = {
    tokensDb: createTokensDb({ tableName: config.db.tokensTable }),
    ownershipDb: createOwnershipDb({ tableName: config.db.casRealmTable }),
    depotsDb: createDepotsDb({ tableName: config.db.casRealmTable }),
    refCountDb: createRefCountDb({ tableName: config.db.refCountTable }),
    usageDb: createUsageDb({ tableName: config.db.usageTable }),
    userRolesDb: createUserRolesDb({ tableName: config.db.tokensTable }),
    awpPendingDb: createAwpPendingDb({ tableName: config.db.tokensTable }),
    awpPubkeysDb: createAwpPubkeysDb({ tableName: config.db.tokensTable }),
    clientPendingDb: createClientPendingDb({ tableName: config.db.tokensTable }),
    clientPubkeysDb: createClientPubkeysDb({ tableName: config.db.tokensTable }),
  };

  // Create storage
  const storage =
    storageType === "fs"
      ? createFsStorage({ basePath: storageFsPath, prefix: config.storage.prefix })
      : createMemoryStorage();

  // Create JWT verifier
  const jwtVerifier = createMockJwtVerifier(mockJwtSecret);

  // Create auth service
  const authService = createAuthService({
    tokensDb: db.tokensDb,
    userRolesDb: db.userRolesDb,
    cognitoConfig: config.cognito,
  });

  // Create hash provider
  const hashProvider = createNodeHashProvider();

  // Create app
  const app = createApp({
    config,
    db,
    storage,
    authService,
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
    createUserToken: (userId: string, options?: { exp?: number }) => {
      const exp = options?.exp ?? Math.floor(Date.now() / 1000) + 3600; // 1 hour default
      return createMockJwt(mockJwtSecret, { sub: userId, exp });
    },

    createTestUser: async (userId: string, role: "admin" | "authorized" = "authorized") => {
      // Set user role in database
      await db.userRolesDb.setRole(userId, role);

      // Create JWT token
      const token = helpers.createUserToken(userId);

      return {
        userId,
        token,
        realm: `usr_${userId}`,
      };
    },

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

    createAgentToken: async (token: string, options = {}) => {
      const { name = "Test Agent Token", description, expiresIn } = options;
      const response = await helpers.authRequest(token, "POST", "/api/auth/tokens", {
        name,
        description,
        expiresIn,
      });

      if (!response.ok) {
        throw new Error(`Failed to create agent token: ${response.status}`);
      }

      const data = (await response.json()) as AgentTokenResult;
      return data;
    },

    createTicket: async (token: string, realm: string, options = {}) => {
      const { input, purpose, writable, expiresIn } = options;
      const response = await helpers.authRequest(token, "POST", `/api/realm/${realm}/tickets`, {
        input,
        purpose,
        writable,
        expiresIn,
      });

      if (!response.ok) {
        throw new Error(`Failed to create ticket: ${response.status}`);
      }

      const data = (await response.json()) as TicketResult;
      return data;
    },

    ticketRequest: async (ticketId: string, method: string, path: string, body?: unknown) => {
      const headers: Record<string, string> = {
        Authorization: `Ticket ${ticketId}`,
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

    agentRequest: async (agentToken: string, method: string, path: string, body?: unknown) => {
      const headers: Record<string, string> = {
        Authorization: `Agent ${agentToken}`,
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

    // SDK Client Factory Methods
    getAnonymousClient: () => createCasfaClient({ baseUrl: url }),

    getUserClient: (token: string) => createUserClient({ baseUrl: url, accessToken: token }),

    getDelegateClient: (agentToken: string) =>
      createDelegateClient({ baseUrl: url, authType: "token", token: agentToken }),

    getTicketClient: (ticketId: string, realmId: string) =>
      createTicketClient({ baseUrl: url, ticketId, realmId }),
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
    authService,
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
// Re-export SDK Types for Test Convenience
// ============================================================================

export type { CasfaAnonymousClient, CasfaUserClient, CasfaDelegateClient, CasfaTicketClient };
