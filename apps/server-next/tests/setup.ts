/**
 * E2E test setup: in-process server uses DynamoDB + S3 (set DYNAMODB_ENDPOINT, S3_ENDPOINT when not using BASE_URL).
 * When BASE_URL is set, tests hit existing serverless-offline (which uses serverless-dynamodb-local + serverless-s3-local).
 */
process.env.MOCK_JWT_SECRET ??= "test-secret-e2e";
process.env.DYNAMODB_ENDPOINT ??= "http://localhost:7102";
process.env.S3_ENDPOINT ??= "http://localhost:7104";
process.env.S3_BUCKET ??= "casfa-next-local-test-blob";
process.env.STAGE ??= "local-test";

import { loadConfig } from "../backend/config.ts";
import { createApp } from "../backend/app.ts";
import { createCasFacade } from "../backend/services/cas.ts";
import { createDynamoDelegateGrantStore } from "../backend/db/dynamo-delegate-grant-store.ts";
import { createDynamoBranchStore } from "../backend/db/dynamo-branch-store.ts";
import { createMemoryDerivedDataStore } from "../backend/db/derived-data.ts";
import { createMemoryUserSettingsStore } from "../backend/db/user-settings.ts";

export type TestServer = {
  url: string;
  stop: () => void;
  helpers: TestHelpers;
};

export type TestHelpers = {
  createUserToken(realmId: string): string;
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

function base64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Minimal JWT for e2e: server mock verifier only decodes payload, no signature check. */
function createUserToken(realmId: string): string {
  const header = base64urlEncode(
    new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" }))
  );
  const payload = base64urlEncode(
    new TextEncoder().encode(
      JSON.stringify({
        sub: realmId,
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
    )
  );
  const signature = base64urlEncode(new TextEncoder().encode("e2e"));
  return `${header}.${payload}.${signature}`;
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
  const { cas, key } = createCasFacade(config);
  const branchStore = createDynamoBranchStore({
    tableName: config.dynamodbTableDelegates,
    clientConfig: config.dynamodbEndpoint
      ? { endpoint: config.dynamodbEndpoint, region: "us-east-1" }
      : undefined,
  });
  const delegateGrantStore = createDynamoDelegateGrantStore({
    tableName: config.dynamodbTableGrants,
    clientConfig: config.dynamodbEndpoint
      ? { endpoint: config.dynamodbEndpoint, region: "us-east-1" }
      : undefined,
  });
  const derivedDataStore = createMemoryDerivedDataStore();
  const userSettingsStore = createMemoryUserSettingsStore();
  const app = createApp({
    config,
    cas,
    key,
    branchStore,
    delegateGrantStore,
    derivedDataStore,
    userSettingsStore,
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
