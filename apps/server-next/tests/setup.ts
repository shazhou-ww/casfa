/**
 * E2E test setup.
 * When BASE_URL is set: hit serverless-offline (DynamoDB + S3 via dev-test), mock auth uses decode-only verifier.
 * When BASE_URL is not set: in-process server with memory stores (no DynamoDB/S3), mock auth decode-only so user and delegate tokens work.
 */
process.env.DYNAMODB_ENDPOINT ??= "http://localhost:7102";
process.env.S3_ENDPOINT ??= "http://localhost:7104";
process.env.S3_BUCKET ??= "casfa-next-local-test-blob";
process.env.STAGE ??= "local-test";

import * as jose from "jose";
import {
  type CognitoConfig,
  createMockJwtVerifier,
} from "@casfa/cell-cognito";
import {
  type DelegateGrantStore as CellOAuthGrantStore,
  type DelegateGrant as CellOAuthGrant,
  createOAuthServer,
} from "@casfa/cell-oauth";
import { loadConfig } from "../backend/config.ts";
import { createApp } from "../backend/app.ts";
import { createCasFacade } from "../backend/services/cas.ts";
import { createMemoryDerivedDataStore } from "../backend/db/derived-data.ts";
import { createMemoryRealmUsageStore } from "../backend/db/realm-usage-store.ts";
import { createMemoryUserSettingsStore } from "../backend/db/user-settings.ts";
import { createMemoryDelegateGrantStore } from "../backend/db/delegate-grants.ts";
import { createMemoryBranchStore } from "../backend/db/branch-store.ts";

export type TestServer = {
  url: string;
  stop: () => void;
  helpers: TestHelpers;
};

export type TestHelpers = {
  createUserToken(realmId: string): Promise<string>;
  authRequest(
    token: string,
    method: string,
    path: string,
    body?: unknown
  ): Promise<Response>;
  assignDelegate(
    userToken: string,
    realmId: string,
    options?: { client_id?: string; ttl?: number }
  ): Promise<{ accessToken: string; delegateId: string; expiresAt?: number }>;
  createBranch(
    userToken: string,
    realmId: string,
    body: { mountPath: string; ttl?: number; parentBranchId?: string }
  ): Promise<{ branchId: string; accessToken: string; expiresAt?: number }>;
  mcpRequest(token: string, method: string, params?: unknown): Promise<Response>;
};

/** E2E JWT: signed with same secret as startTestServer's testConfig (and dev-test when BASE_URL is set). */
async function createUserToken(realmId: string): Promise<string> {
  const secret = "test-secret-e2e";
  const key = new Uint8Array(new TextEncoder().encode(secret));
  return await new jose.SignJWT({
    email: "test@example.com",
    name: "Test User",
  })
    .setSubject(realmId)
    .setExpirationTime("1h")
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .sign(key);
}

/** In-memory grant store for cell-oauth (userId, clientName) used by in-process E2E. */
function createMemoryCellOAuthGrantStore(): CellOAuthGrantStore {
  const byId = new Map<string, CellOAuthGrant>();
  const byUserHash = new Map<string, CellOAuthGrant>();
  const byUserRefresh = new Map<string, CellOAuthGrant>();
  const key = (u: string, h: string) => `${u}:${h}`;
  return {
    async list(userId) {
      return Array.from(byId.values()).filter((g) => g.userId === userId);
    },
    async get(delegateId) {
      return byId.get(delegateId) ?? null;
    },
    async getByAccessTokenHash(userId, hash) {
      return byUserHash.get(key(userId, hash)) ?? null;
    },
    async getByRefreshTokenHash(userId, hash) {
      return byUserRefresh.get(key(userId, hash)) ?? null;
    },
    async insert(grant) {
      byId.set(grant.delegateId, grant);
      byUserHash.set(key(grant.userId, grant.accessTokenHash), grant);
      if (grant.refreshTokenHash) {
        byUserRefresh.set(key(grant.userId, grant.refreshTokenHash), grant);
      }
    },
    async remove(delegateId) {
      const g = byId.get(delegateId);
      if (g) {
        byId.delete(delegateId);
        byUserHash.delete(key(g.userId, g.accessTokenHash));
        if (g.refreshTokenHash) byUserRefresh.delete(key(g.userId, g.refreshTokenHash));
      }
    },
    async updateTokens(delegateId, update) {
      const g = byId.get(delegateId);
      if (!g) return;
      byUserHash.delete(key(g.userId, g.accessTokenHash));
      if (g.refreshTokenHash) byUserRefresh.delete(key(g.userId, g.refreshTokenHash));
      const updated: CellOAuthGrant = {
        ...g,
        accessTokenHash: update.accessTokenHash,
        refreshTokenHash: update.refreshTokenHash ?? g.refreshTokenHash,
      };
      byId.set(delegateId, updated);
      byUserHash.set(key(updated.userId, updated.accessTokenHash), updated);
      if (updated.refreshTokenHash) {
        byUserRefresh.set(key(updated.userId, updated.refreshTokenHash), updated);
      }
    },
  };
}

function createHelpers(url: string): TestHelpers {
  const authRequest = async (
    token: string,
    method: string,
    path: string,
    body?: unknown
  ): Promise<Response> => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    return fetch(`${url}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  };

  const assignDelegate = async (
    userToken: string,
    realmId: string,
    options?: { client_id?: string; ttl?: number }
  ): Promise<{ accessToken: string; delegateId: string; expiresAt?: number }> => {
    const body: Record<string, unknown> = {};
    if (options?.client_id != null) body.client_id = options.client_id;
    if (options?.ttl != null) body.ttl = options.ttl;
    const res = await authRequest(
      userToken,
      "POST",
      `/api/realm/${realmId}/delegates/assign`,
      Object.keys(body).length > 0 ? body : undefined
    );
    const data = (await res.json()) as {
      accessToken?: string;
      delegateId?: string;
      expiresAt?: number;
    };
    if (!res.ok) {
      throw new Error(
        `assignDelegate failed: ${res.status} ${JSON.stringify(data)}`
      );
    }
    if (!data.accessToken || !data.delegateId) {
      throw new Error(`assignDelegate missing accessToken/delegateId: ${JSON.stringify(data)}`);
    }
    return {
      accessToken: data.accessToken,
      delegateId: data.delegateId,
      ...(data.expiresAt != null && { expiresAt: data.expiresAt }),
    };
  };

  const createBranch = async (
    userToken: string,
    realmId: string,
    body: { mountPath: string; ttl?: number; parentBranchId?: string }
  ): Promise<{ branchId: string; accessToken: string; expiresAt?: number }> => {
    const res = await authRequest(
      userToken,
      "POST",
      `/api/realm/${realmId}/branches`,
      body
    );
    const data = (await res.json()) as {
      branchId?: string;
      accessToken?: string;
      expiresAt?: number;
    };
    if (!res.ok) {
      throw new Error(
        `createBranch failed: ${res.status} ${JSON.stringify(data)}`
      );
    }
    if (!data.branchId || !data.accessToken) {
      throw new Error(`createBranch missing branchId/accessToken: ${JSON.stringify(data)}`);
    }
    return {
      branchId: data.branchId,
      accessToken: data.accessToken,
      ...(data.expiresAt != null && { expiresAt: data.expiresAt }),
    };
  };

  const mcpRequest = async (
    token: string,
    method: string,
    params?: unknown
  ): Promise<Response> => {
    return fetch(`${url}/api/mcp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params,
      }),
    });
  };

  return {
    createUserToken,
    authRequest,
    assignDelegate,
    createBranch,
    mcpRequest,
  };
}

/** When BASE_URL is set, use it as remote server (no process start/stop). */
function createRemoteTestServer(baseUrl: string): TestServer {
  const url = baseUrl.replace(/\/$/, "");
  return {
    url,
    stop: () => {},
    helpers: createHelpers(url),
  };
}

export function startTestServer(options?: { port?: number }): TestServer {
  const config = loadConfig();
  // E2E in-process: force mock auth but use decode-only verifier (no mockJwtSecret) so that
  // 1) our signed user token is accepted (payload valid), 2) server-issued delegate token (header.payload.sig) is accepted.
  const testConfig: typeof config = {
    ...config,
    auth: {
      ...config.auth,
      mockJwtSecret: undefined,
      cognitoRegion: undefined,
      cognitoUserPoolId: undefined,
      cognitoClientId: undefined,
      cognitoHostedUiUrl: undefined,
      cognitoClientSecret: undefined,
    },
  };
  const { cas, key } = createCasFacade(testConfig);
  const branchStore = createMemoryBranchStore();
  const delegateGrantStore = createMemoryDelegateGrantStore();
  const derivedDataStore = createMemoryDerivedDataStore();
  const realmUsageStore = createMemoryRealmUsageStore();
  const userSettingsStore = createMemoryUserSettingsStore();

  const cognitoConfig: CognitoConfig = {
    region: "us-east-1",
    userPoolId: "",
    clientId: "",
    hostedUiUrl: "",
  };
  const cellOAuthGrantStore: CellOAuthGrantStore = createMemoryCellOAuthGrantStore();
  const oauthServer = createOAuthServer({
    issuerUrl: "http://localhost",
    cognitoConfig,
    jwtVerifier: createMockJwtVerifier("test-secret-e2e"),
    grantStore: cellOAuthGrantStore,
    permissions: ["use_mcp", "manage_delegates", "file_read", "file_write", "branch_manage", "delegate_manage"],
  });

  const app = createApp({
    config: testConfig,
    cas,
    key,
    branchStore,
    delegateGrantStore,
    derivedDataStore,
    realmUsageStore,
    userSettingsStore,
    oauthServer,
  });

  const port = options?.port ?? 0;
  const server = Bun.serve({
    fetch: app.fetch,
    port,
  });

  const url = `http://localhost:${server.port}`;
  return {
    url,
    stop: () => server.stop(),
    helpers: createHelpers(url),
  };
}

let cachedServer: TestServer | null = null;
let serverPromise: Promise<TestServer> | null = null;

function clearCachedServer(): void {
  cachedServer = null;
  serverPromise = null;
}

async function getOrCreateServer(): Promise<TestServer> {
  const baseUrl = process.env.BASE_URL;
  if (baseUrl) {
    if (!cachedServer) cachedServer = createRemoteTestServer(baseUrl);
    return cachedServer;
  }
  if (cachedServer) return cachedServer;
  if (serverPromise) return serverPromise;
  serverPromise = Promise.resolve(startTestServer());
  cachedServer = await serverPromise;
  return cachedServer;
}

export type E2EContext = {
  get baseUrl(): string;
  get helpers(): TestHelpers;
  ready(): Promise<void>;
  cleanup(): void;
};

export function createE2EContext(): E2EContext {
  const serverPromise = getOrCreateServer();
  let resolved: TestServer | null = null;

  return {
    get baseUrl(): string {
      if (!resolved) {
        throw new Error("E2E context not ready — call await ctx.ready() in beforeAll");
      }
      return resolved.url;
    },
    get helpers(): TestHelpers {
      if (!resolved) {
        throw new Error("E2E context not ready — call await ctx.ready() in beforeAll");
      }
      return resolved.helpers;
    },
    async ready(): Promise<void> {
      resolved = await serverPromise;
    },
    cleanup(): void {
      if (resolved && !process.env.BASE_URL) {
        resolved.stop();
      }
      resolved = null;
      clearCachedServer();
    },
  };
}
