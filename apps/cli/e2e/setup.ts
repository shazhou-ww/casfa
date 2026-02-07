/**
 * CLI E2E Test Setup
 *
 * Provides test environment setup for CLI e2e tests:
 * - Starts a test server (reuses server e2e setup)
 * - Creates temporary HOME directory to isolate CLI config
 * - Provides test helpers for creating users, tokens, etc.
 *
 * Requirements:
 * - DynamoDB Local running at DYNAMODB_ENDPOINT (default: http://localhost:8701)
 * - Test tables created in DynamoDB Local
 */

import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Lazy imports to avoid triggering server setup on module load
let serverSetup: typeof import("../../server/backend/e2e/setup.ts") | null = null;

async function getServerSetup() {
  if (!serverSetup) {
    serverSetup = await import("../../server/backend/e2e/setup.ts");
  }
  return serverSetup;
}

// Re-export uniqueId as a local function to avoid importing
export const uniqueId = () => randomUUID();

// ============================================================================
// CLI Test Configuration
// ============================================================================

export interface TestServer {
  url: string;
  helpers: {
    createUserToken: (userId: string, options?: { exp?: number }) => string;
    createTestUser: (
      userUuid: string,
      role?: "admin" | "authorized"
    ) => Promise<{
      userId: string;
      userUuid: string;
      token: string;
      realm: string;
      mainDepotId: string;
    }>;
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
    ) => Promise<{ tokenId: string; tokenBase64: string; expiresAt: number }>;
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
    ) => Promise<{ tokenId: string; tokenBase64: string; expiresAt: number }>;
  };
  stop: () => void;
}

export interface CliTestContext {
  /** The test server instance */
  server: TestServer;
  /** Base URL of the test server */
  baseUrl: string;
  /** Test helpers from server e2e */
  helpers: TestServer["helpers"];
  /** Temporary HOME directory for CLI isolation */
  tempHome: string;
  /** Base environment for CLI execution */
  baseEnv: Record<string, string>;
  /** Cleanup function */
  cleanup: () => void;
  /** Wait for server to be ready */
  ready: () => Promise<void>;
}

// ============================================================================
// Temporary Directory Management
// ============================================================================

/**
 * Create a temporary HOME directory for CLI isolation
 */
export function createTempHome(): string {
  return mkdtempSync(join(tmpdir(), "casfa-cli-test-"));
}

/**
 * Clean up temporary HOME directory
 */
export function cleanupTempHome(tempHome: string): void {
  try {
    rmSync(tempHome, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

// ============================================================================
// CLI Test Context
// ============================================================================

// Cached server instance to share across test files
let cachedServer: TestServer | null = null;
let serverStartPromise: Promise<TestServer> | null = null;

async function getOrCreateServer(): Promise<TestServer> {
  if (cachedServer) {
    return cachedServer;
  }
  if (serverStartPromise) {
    return serverStartPromise;
  }

  serverStartPromise = (async () => {
    const setup = await getServerSetup();
    const server = await setup.startTestServer();
    cachedServer = server as unknown as TestServer;
    return cachedServer;
  })();

  return serverStartPromise;
}

/**
 * Create a CLI test context
 *
 * This creates:
 * 1. A test server (reusing server e2e setup)
 * 2. A temporary HOME directory for CLI isolation
 * 3. Base environment variables for CLI execution
 */
export function createCliTestContext(): CliTestContext {
  const tempHome = createTempHome();
  let resolvedServer: TestServer | null = null;

  return {
    get server() {
      if (!resolvedServer) {
        throw new Error("Server not ready - call await ctx.ready() first in beforeAll");
      }
      return resolvedServer;
    },
    get baseUrl() {
      if (!resolvedServer) {
        throw new Error("Server not ready - call await ctx.ready() first in beforeAll");
      }
      return resolvedServer.url;
    },
    get helpers() {
      if (!resolvedServer) {
        throw new Error("Server not ready - call await ctx.ready() first in beforeAll");
      }
      return resolvedServer.helpers;
    },
    tempHome,
    get baseEnv() {
      if (!resolvedServer) {
        throw new Error("Server not ready - call await ctx.ready() first in beforeAll");
      }
      return {
        HOME: tempHome,
        CASFA_BASE_URL: resolvedServer.url,
        // Disable cache to avoid complications in tests
        CASFA_NO_CACHE: "1",
        // Ensure consistent output
        NO_COLOR: "1",
        FORCE_COLOR: "0",
      };
    },
    cleanup: () => {
      if (resolvedServer) {
        resolvedServer.stop();
        resolvedServer = null;
        cachedServer = null;
        serverStartPromise = null;
      }
      cleanupTempHome(tempHome);
    },
    ready: async () => {
      resolvedServer = await getOrCreateServer();
    },
  };
}

// ============================================================================
// Test User Setup
// ============================================================================

export interface TestUserSetup {
  /** User ID in user:base32 format */
  userId: string;
  /** User UUID (Cognito-style) */
  userUuid: string;
  /** User JWT token */
  userToken: string;
  /** User's realm ID */
  realm: string;
  /** Main depot ID */
  mainDepotId: string;
  /** Delegate token for CLI operations */
  delegateToken: string;
  /** Delegate token ID */
  delegateTokenId: string;
}

/**
 * Create a test user with delegate token for CLI operations
 */
export async function createTestUserWithToken(
  ctx: CliTestContext,
  options: {
    canUpload?: boolean;
    canManageDepot?: boolean;
  } = {}
): Promise<TestUserSetup> {
  const { canUpload = true, canManageDepot = true } = options;

  const userUuid = uniqueId();
  const {
    userId,
    token: userToken,
    realm,
    mainDepotId,
  } = await ctx.helpers.createTestUser(userUuid, "authorized");

  // Create a delegate token for CLI operations
  const delegateResult = await ctx.helpers.createDelegateToken(userToken, realm, {
    name: "CLI E2E Test Token",
    canUpload,
    canManageDepot,
  });

  return {
    userId,
    userUuid,
    userToken,
    realm,
    mainDepotId,
    delegateToken: delegateResult.tokenBase64,
    delegateTokenId: delegateResult.tokenId,
  };
}

// ============================================================================
// Environment Helpers
// ============================================================================

/**
 * Create environment for CLI execution with authentication
 */
export function createAuthEnv(ctx: CliTestContext, user: TestUserSetup): Record<string, string> {
  return {
    ...ctx.baseEnv,
    CASFA_REALM: user.realm,
    CASFA_TOKEN: user.delegateToken,
  };
}

/**
 * Create environment for CLI execution without authentication
 */
export function createUnauthEnv(ctx: CliTestContext): Record<string, string> {
  return {
    ...ctx.baseEnv,
  };
}
