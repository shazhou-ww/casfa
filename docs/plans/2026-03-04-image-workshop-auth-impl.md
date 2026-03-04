# Image Workshop Auth & Delegate System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Cognito login (Google/Microsoft) and Delegate token system to image-workshop, with frontend UI for login and delegate management.

**Architecture:** Single Lambda function handles all routes via Hono. Auth middleware inspects Bearer token to distinguish User (Cognito JWT) vs Delegate token. DelegateGrantStore persists grants in DynamoDB. Frontend is a single-page React app with login and delegate management (image generation UI deferred to next iteration).

**Tech Stack:** Hono, DynamoDB (via @aws-sdk/lib-dynamodb), jose (JWKS/JWT), React 18, Vite, Bun

---

## Dependencies

Before starting, install required packages:

```bash
cd apps/image-workshop
bun add jose --no-cache
```

`jose` is needed for JWT verification (Cognito JWKS + mock HS256). All other deps (`hono`, `@aws-sdk/*`, `zod`, `react`, `react-dom`, `@modelcontextprotocol/sdk`) are already present or available from workspace.

Also add `@aws-sdk/lib-dynamodb` and `@aws-sdk/client-dynamodb` if not already available from workspace:

```bash
bun add @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb --no-cache
```

---

## Task 1: Auth Types

**Files:**
- Create: `apps/image-workshop/backend/types/auth.ts`

**Step 1: Create auth type definitions**

```typescript
// apps/image-workshop/backend/types/auth.ts

export type DelegatePermission = "use_mcp" | "manage_delegates";

export type UserAuth = {
  type: "user";
  userId: string;
};

export type DelegateAuth = {
  type: "delegate";
  userId: string;
  delegateId: string;
  permissions: DelegatePermission[];
};

export type Auth = UserAuth | DelegateAuth;

export type DelegateGrant = {
  delegateId: string;
  userId: string;
  clientName: string;
  permissions: DelegatePermission[];
  accessTokenHash: string;
  refreshTokenHash: string | null;
  createdAt: number;
  expiresAt: number | null;
};

export type DelegateGrantStore = {
  list(userId: string): Promise<DelegateGrant[]>;
  get(delegateId: string): Promise<DelegateGrant | null>;
  getByAccessTokenHash(userId: string, hash: string): Promise<DelegateGrant | null>;
  getByRefreshTokenHash(userId: string, hash: string): Promise<DelegateGrant | null>;
  insert(grant: DelegateGrant): Promise<void>;
  remove(delegateId: string): Promise<void>;
  updateTokens(
    delegateId: string,
    update: { accessTokenHash: string; refreshTokenHash?: string }
  ): Promise<void>;
};
```

**Step 2: Commit**

```bash
git add apps/image-workshop/backend/types/auth.ts
git commit -m "feat(image-workshop): add auth type definitions"
```

---

## Task 2: Token Utilities

**Files:**
- Create: `apps/image-workshop/backend/utils/token.ts`

**Step 1: Create token utility functions**

These handle SHA-256 hashing, delegate ID generation (Crockford Base32), and delegate token creation.

Reference pattern: `apps/server-next/backend/services/mcp-oauth.ts` lines 165-198 and `apps/server-next/backend/middleware/auth.ts` lines 9-14.

```typescript
// apps/image-workshop/backend/utils/token.ts
import { randomUUID } from "node:crypto";

const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Encode a Uint8Array to Crockford Base32. */
function crockfordBase32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let result = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += CROCKFORD_ALPHABET[(value >>> bits) & 0x1f];
    }
  }
  if (bits > 0) {
    result += CROCKFORD_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return result;
}

/** Generate a delegate ID: `dlg_` + Crockford Base32(128-bit UUID). */
export function generateDelegateId(): string {
  const uuid = randomUUID().replace(/-/g, "");
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = Number.parseInt(uuid.slice(i * 2, i * 2 + 2), 16);
  }
  return `dlg_${crockfordBase32Encode(bytes)}`;
}

/** Generate a cryptographically random token string (base64url). */
export function generateRandomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Create a delegate access token: base64(payload).base64(sig). */
export function createDelegateAccessToken(userId: string, delegateId: string): string {
  const payload = { sub: userId, dlg: delegateId, iat: Math.floor(Date.now() / 1000) };
  const payloadB64 = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const sig = generateRandomToken();
  return `${payloadB64}.${sig}`;
}

/** Decode a delegate access token payload (does NOT verify). */
export function decodeDelegateTokenPayload(
  token: string
): { sub: string; dlg: string } | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  try {
    const json = atob(parts[0].replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(json);
    if (typeof payload.sub === "string" && typeof payload.dlg === "string") {
      return { sub: payload.sub, dlg: payload.dlg };
    }
    return null;
  } catch {
    return null;
  }
}
```

Key differences from server-next:
- Delegate tokens use 2-part format (`payload.sig`) instead of 3-part JWT-like format
- This makes it easy to distinguish from Cognito JWTs (which have 3 parts with `.`)
- `generateDelegateId` uses Crockford Base32 per project convention

**Step 2: Commit**

```bash
git add apps/image-workshop/backend/utils/token.ts
git commit -m "feat(image-workshop): add token utilities (hash, delegate ID, token gen)"
```

---

## Task 3: JWT Verification

**Files:**
- Create: `apps/image-workshop/backend/utils/jwt.ts`

**Step 1: Create JWT verifier**

Reference: `apps/server-next/backend/auth/cognito-jwks.ts` lines 22-56.

```typescript
// apps/image-workshop/backend/utils/jwt.ts
import * as jose from "jose";

export type JwtPayload = {
  sub: string;
  email?: string;
  name?: string;
};

export type JwtVerifier = (token: string) => Promise<JwtPayload>;

/**
 * Create a Cognito JWKS-based JWT verifier.
 * Used in deployed environments.
 */
export function createCognitoJwtVerifier(config: {
  region: string;
  userPoolId: string;
  clientId: string;
}): JwtVerifier {
  const { region, userPoolId } = config;
  const jwksUrl = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`;
  const issuer = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
  const jwks = jose.createRemoteJWKSet(new URL(jwksUrl));

  return async (token: string): Promise<JwtPayload> => {
    const { payload } = await jose.jwtVerify(token, jwks, {
      issuer,
    });
    if (typeof payload.sub !== "string") throw new Error("Missing sub in JWT");
    return {
      sub: payload.sub,
      email: payload.email as string | undefined,
      name: payload.name as string | undefined,
    };
  };
}

/**
 * Create an HS256 mock JWT verifier for local development.
 * Uses MOCK_JWT_SECRET env var.
 */
export function createMockJwtVerifier(secret: string): JwtVerifier {
  const key = new TextEncoder().encode(secret);
  return async (token: string): Promise<JwtPayload> => {
    const { payload } = await jose.jwtVerify(token, key, {
      algorithms: ["HS256"],
    });
    if (typeof payload.sub !== "string") throw new Error("Missing sub in mock JWT");
    return {
      sub: payload.sub,
      email: payload.email as string | undefined,
      name: payload.name as string | undefined,
    };
  };
}
```

**Step 2: Commit**

```bash
git add apps/image-workshop/backend/utils/jwt.ts
git commit -m "feat(image-workshop): add JWT verification (Cognito JWKS + mock HS256)"
```

---

## Task 4: Cognito Token Exchange

**Files:**
- Create: `apps/image-workshop/backend/utils/cognito.ts`

**Step 1: Create Cognito OAuth utility**

This handles exchanging authorization codes and refreshing tokens with Cognito.

```typescript
// apps/image-workshop/backend/utils/cognito.ts

export type CognitoConfig = {
  region: string;
  userPoolId: string;
  clientId: string;
  hostedUiUrl: string;
};

export type CognitoTokenResponse = {
  access_token: string;
  id_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
};

/**
 * Exchange an authorization code for tokens via Cognito /oauth2/token.
 */
export async function exchangeCodeForTokens(
  config: CognitoConfig,
  code: string,
  redirectUri: string
): Promise<CognitoTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.clientId,
    code,
    redirect_uri: redirectUri,
  });

  const res = await fetch(`${config.hostedUiUrl}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Cognito token exchange failed (${res.status}): ${text}`);
  }
  return res.json();
}

/**
 * Refresh tokens via Cognito /oauth2/token.
 */
export async function refreshCognitoTokens(
  config: CognitoConfig,
  refreshToken: string
): Promise<CognitoTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: config.clientId,
    refresh_token: refreshToken,
  });

  const res = await fetch(`${config.hostedUiUrl}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Cognito token refresh failed (${res.status}): ${text}`);
  }
  return res.json();
}
```

**Step 2: Commit**

```bash
git add apps/image-workshop/backend/utils/cognito.ts
git commit -m "feat(image-workshop): add Cognito token exchange utility"
```

---

## Task 5: DelegateGrantStore (DynamoDB)

**Files:**
- Create: `apps/image-workshop/backend/db/grant-store.ts`

**Step 1: Create the DynamoDB-backed grant store**

Reference: `apps/server-next/backend/db/dynamo-delegate-grant-store.ts`.

The table schema matches what's defined in `cell.yaml`:
- PK: `GRANT#{delegateId}`, SK: `METADATA`
- GSI1 `user-hash-index`: `gsi1pk=USER#{userId}`, `gsi1sk=HASH#{accessTokenHash}`
- GSI2 `user-refresh-index`: `gsi2pk=USER#{userId}`, `gsi2sk=REFRESH#{refreshTokenHash}`

```typescript
// apps/image-workshop/backend/db/grant-store.ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import type { DelegateGrant, DelegateGrantStore } from "../types/auth";

type GrantStoreConfig = {
  tableName: string;
  clientConfig?: ConstructorParameters<typeof DynamoDBClient>[0];
};

function toItem(g: DelegateGrant) {
  return {
    pk: `GRANT#${g.delegateId}`,
    sk: "METADATA",
    gsi1pk: `USER#${g.userId}`,
    gsi1sk: `HASH#${g.accessTokenHash}`,
    ...(g.refreshTokenHash
      ? { gsi2pk: `USER#${g.userId}`, gsi2sk: `REFRESH#${g.refreshTokenHash}` }
      : {}),
    delegateId: g.delegateId,
    userId: g.userId,
    clientName: g.clientName,
    permissions: g.permissions,
    accessTokenHash: g.accessTokenHash,
    refreshTokenHash: g.refreshTokenHash,
    createdAt: g.createdAt,
    expiresAt: g.expiresAt,
  };
}

function fromItem(item: Record<string, unknown>): DelegateGrant {
  return {
    delegateId: item.delegateId as string,
    userId: item.userId as string,
    clientName: item.clientName as string,
    permissions: item.permissions as DelegateGrant["permissions"],
    accessTokenHash: item.accessTokenHash as string,
    refreshTokenHash: (item.refreshTokenHash as string) ?? null,
    createdAt: item.createdAt as number,
    expiresAt: (item.expiresAt as number) ?? null,
  };
}

export function createGrantStore(config: GrantStoreConfig): DelegateGrantStore {
  const client = new DynamoDBClient(config.clientConfig ?? {});
  const doc = DynamoDBDocumentClient.from(client);
  const tableName = config.tableName;

  return {
    async list(userId) {
      const result = await doc.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: "user-hash-index",
          KeyConditionExpression: "gsi1pk = :pk",
          ExpressionAttributeValues: { ":pk": `USER#${userId}` },
        })
      );
      return (result.Items ?? []).map(fromItem);
    },

    async get(delegateId) {
      const result = await doc.send(
        new GetCommand({
          TableName: tableName,
          Key: { pk: `GRANT#${delegateId}`, sk: "METADATA" },
        })
      );
      return result.Item ? fromItem(result.Item) : null;
    },

    async getByAccessTokenHash(userId, hash) {
      const result = await doc.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: "user-hash-index",
          KeyConditionExpression: "gsi1pk = :pk AND gsi1sk = :sk",
          ExpressionAttributeValues: {
            ":pk": `USER#${userId}`,
            ":sk": `HASH#${hash}`,
          },
        })
      );
      const items = result.Items ?? [];
      return items.length > 0 ? fromItem(items[0]) : null;
    },

    async getByRefreshTokenHash(userId, hash) {
      const result = await doc.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: "user-refresh-index",
          KeyConditionExpression: "gsi2pk = :pk AND gsi2sk = :sk",
          ExpressionAttributeValues: {
            ":pk": `USER#${userId}`,
            ":sk": `REFRESH#${hash}`,
          },
        })
      );
      const items = result.Items ?? [];
      return items.length > 0 ? fromItem(items[0]) : null;
    },

    async insert(grant) {
      await doc.send(
        new PutCommand({ TableName: tableName, Item: toItem(grant) })
      );
    },

    async remove(delegateId) {
      await doc.send(
        new DeleteCommand({
          TableName: tableName,
          Key: { pk: `GRANT#${delegateId}`, sk: "METADATA" },
        })
      );
    },

    async updateTokens(delegateId, update) {
      const existing = await doc.send(
        new GetCommand({
          TableName: tableName,
          Key: { pk: `GRANT#${delegateId}`, sk: "METADATA" },
        })
      );
      if (!existing.Item) throw new Error("Grant not found");
      const grant = fromItem(existing.Item);
      grant.accessTokenHash = update.accessTokenHash;
      if (update.refreshTokenHash !== undefined) {
        grant.refreshTokenHash = update.refreshTokenHash;
      }
      await doc.send(
        new PutCommand({ TableName: tableName, Item: toItem(grant) })
      );
    },
  };
}
```

**Step 2: Commit**

```bash
git add apps/image-workshop/backend/db/grant-store.ts
git commit -m "feat(image-workshop): add DynamoDB DelegateGrantStore"
```

---

## Task 6: Auth Middleware

**Files:**
- Create: `apps/image-workshop/backend/middleware/auth.ts`

**Step 1: Create auth middleware**

Reference: `apps/server-next/backend/middleware/auth.ts` lines 79-90 (deps), and the flow described in the design doc.

The middleware:
1. Reads `Authorization: Bearer <token>`
2. JWT (3 parts with `.`): verify via JWKS/mock → extract `sub` → check if delegate grant exists → UserAuth or DelegateAuth
3. Non-JWT (2 parts): decode payload → extract userId → lookup by accessTokenHash → DelegateAuth or 401
4. No token → skip (route handlers decide if auth is required)

```typescript
// apps/image-workshop/backend/middleware/auth.ts
import type { Context, Next } from "hono";
import type { Auth, DelegateGrantStore } from "../types/auth";
import type { JwtVerifier } from "../utils/jwt";
import { sha256Hex } from "../utils/token";
import { decodeDelegateTokenPayload } from "../utils/token";

declare module "hono" {
  interface ContextVariableMap {
    auth: Auth | null;
  }
}

export type AuthMiddlewareDeps = {
  jwtVerifier: JwtVerifier;
  grantStore: DelegateGrantStore;
};

export function createAuthMiddleware(deps: AuthMiddlewareDeps) {
  return async (c: Context, next: Next) => {
    const header = c.req.header("authorization");
    if (!header?.startsWith("Bearer ")) {
      c.set("auth", null);
      return next();
    }

    const token = header.slice(7);
    const parts = token.split(".");
    const hash = await sha256Hex(token);

    if (parts.length >= 3) {
      // JWT-like token (Cognito)
      try {
        const jwt = await deps.jwtVerifier(token);
        const grant = await deps.grantStore.getByAccessTokenHash(jwt.sub, hash);
        if (grant) {
          c.set("auth", {
            type: "delegate",
            userId: jwt.sub,
            delegateId: grant.delegateId,
            permissions: grant.permissions,
          });
        } else {
          c.set("auth", { type: "user", userId: jwt.sub });
        }
      } catch {
        c.set("auth", null);
      }
    } else if (parts.length === 2) {
      // Delegate token (payload.sig)
      const payload = decodeDelegateTokenPayload(token);
      if (!payload) {
        c.set("auth", null);
        return next();
      }
      const grant = await deps.grantStore.getByAccessTokenHash(payload.sub, hash);
      if (grant) {
        c.set("auth", {
          type: "delegate",
          userId: payload.sub,
          delegateId: grant.delegateId,
          permissions: grant.permissions,
        });
      } else {
        c.set("auth", null);
      }
    } else {
      c.set("auth", null);
    }

    return next();
  };
}

/** Require any auth (user or delegate). Returns 401 if not authenticated. */
export function requireAuth(c: Context): Auth {
  const auth = c.get("auth");
  if (!auth) throw new Error("Unauthorized");
  return auth;
}

/** Check if auth has a specific permission. User tokens always pass. */
export function hasPermission(auth: Auth, permission: string): boolean {
  if (auth.type === "user") return true;
  return auth.permissions.includes(permission as Auth extends { permissions: infer P } ? P extends (infer U)[] ? U : never : never);
}
```

Note: The `hasPermission` function's type can be simplified to just `auth.permissions.includes(permission)` with a cast. Adjust as needed.

**Step 2: Commit**

```bash
git add apps/image-workshop/backend/middleware/auth.ts
git commit -m "feat(image-workshop): add auth middleware"
```

---

## Task 7: OAuth Controller

**Files:**
- Create: `apps/image-workshop/backend/controllers/oauth.ts`

**Step 1: Create OAuth controller**

This handles:
- `GET /.well-known/oauth-authorization-server` — discovery metadata
- `GET /oauth/authorize` — redirect to Cognito
- `POST /oauth/token` — code exchange or refresh

```typescript
// apps/image-workshop/backend/controllers/oauth.ts
import { Hono } from "hono";
import type { CognitoConfig } from "../utils/cognito";
import { exchangeCodeForTokens, refreshCognitoTokens } from "../utils/cognito";
import type { DelegateGrantStore } from "../types/auth";
import {
  generateDelegateId,
  createDelegateAccessToken,
  generateRandomToken,
  sha256Hex,
} from "../utils/token";

type OAuthControllerDeps = {
  cognitoConfig: CognitoConfig;
  grantStore: DelegateGrantStore;
};

const DEFAULT_ACCESS_TTL_MS = 24 * 60 * 60 * 1000; // 24h

export function createOAuthRoutes(deps: OAuthControllerDeps) {
  const routes = new Hono();
  const { cognitoConfig, grantStore } = deps;

  // OAuth discovery
  routes.get("/.well-known/oauth-authorization-server", (c) => {
    const origin = new URL(c.req.url).origin;
    return c.json({
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["openid", "profile", "email", "delegate"],
    });
  });

  // Redirect to Cognito hosted UI
  routes.get("/oauth/authorize", (c) => {
    const scope = c.req.query("scope") ?? "openid profile email";
    const state = c.req.query("state") ?? "";
    const codeChallenge = c.req.query("code_challenge") ?? "";
    const codeChallengeMethod = c.req.query("code_challenge_method") ?? "";
    const identityProvider = c.req.query("identity_provider") ?? "";

    const origin = new URL(c.req.url).origin;
    const redirectUri = `${origin}/oauth/callback`;

    const params = new URLSearchParams({
      client_id: cognitoConfig.clientId,
      response_type: "code",
      scope: scope.includes("delegate") ? "openid profile email" : scope,
      redirect_uri: redirectUri,
    });
    if (state) params.set("state", state);
    if (codeChallenge) params.set("code_challenge", codeChallenge);
    if (codeChallengeMethod) params.set("code_challenge_method", codeChallengeMethod);
    if (identityProvider) params.set("identity_provider", identityProvider);

    return c.redirect(`${cognitoConfig.hostedUiUrl}/oauth2/authorize?${params}`);
  });

  // Token exchange
  routes.post("/oauth/token", async (c) => {
    const body = await c.req.parseBody();
    const grantType = body.grant_type as string;

    if (grantType === "authorization_code") {
      const code = body.code as string;
      const scope = (body.scope as string) ?? "";
      const origin = new URL(c.req.url).origin;
      const redirectUri = `${origin}/oauth/callback`;

      const cognitoTokens = await exchangeCodeForTokens(
        cognitoConfig,
        code,
        redirectUri
      );

      if (scope.includes("delegate")) {
        // MCP OAuth flow: mint a delegate token
        const idToken = cognitoTokens.id_token;
        const payload = JSON.parse(atob(idToken.split(".")[1]));
        const userId = payload.sub as string;
        const clientName = (body.client_name as string) ?? "MCP Client";

        const delegateId = generateDelegateId();
        const accessToken = createDelegateAccessToken(userId, delegateId);
        const refreshToken = generateRandomToken();
        const now = Date.now();

        await grantStore.insert({
          delegateId,
          userId,
          clientName,
          permissions: ["use_mcp"],
          accessTokenHash: await sha256Hex(accessToken),
          refreshTokenHash: await sha256Hex(refreshToken),
          createdAt: now,
          expiresAt: now + DEFAULT_ACCESS_TTL_MS,
        });

        return c.json({
          access_token: accessToken,
          refresh_token: refreshToken,
          token_type: "Bearer",
          expires_in: DEFAULT_ACCESS_TTL_MS / 1000,
        });
      }

      // Standard Cognito flow: return Cognito tokens
      return c.json({
        access_token: cognitoTokens.access_token,
        id_token: cognitoTokens.id_token,
        refresh_token: cognitoTokens.refresh_token,
        token_type: cognitoTokens.token_type,
        expires_in: cognitoTokens.expires_in,
      });
    }

    if (grantType === "refresh_token") {
      const refreshToken = body.refresh_token as string;
      if (!refreshToken) return c.json({ error: "missing refresh_token" }, 400);

      // Try delegate refresh first
      // Delegate refresh tokens are short random strings, Cognito ones are JWTs
      const isLikelyCognito = refreshToken.split(".").length >= 3;

      if (!isLikelyCognito) {
        const hash = await sha256Hex(refreshToken);
        // We need userId to query; try to extract from the grant store
        // Use a scan-like approach via the stored token hash
        // Actually, delegate refresh tokens don't carry userId.
        // We need to search by refresh hash. The GSI2 requires userId prefix.
        // Solution: client must also send userId or we extract from current auth context.
        // For simplicity, require the access_token to be sent alongside for context.
        // Alternative: store refreshTokenHash as pk in a separate index.
        //
        // For now, return error — delegate refresh is handled via /api route if needed.
        // MCP clients will use grant_type=refresh_token with their own flow.
        return c.json({ error: "delegate_refresh_not_supported_here" }, 400);
      }

      // Cognito refresh
      const cognitoTokens = await refreshCognitoTokens(
        cognitoConfig,
        refreshToken
      );
      return c.json({
        access_token: cognitoTokens.access_token,
        id_token: cognitoTokens.id_token,
        token_type: cognitoTokens.token_type,
        expires_in: cognitoTokens.expires_in,
      });
    }

    return c.json({ error: "unsupported_grant_type" }, 400);
  });

  return routes;
}
```

Note on delegate refresh: The GSI2 requires `userId` as partition key. Since OAuth token refresh endpoint doesn't inherently know the userId, delegate token refresh can either:
- Store a separate global index on refreshTokenHash (adds complexity)
- Require the caller to include userId (breaks OAuth spec)
- Handle delegate refresh through the authenticated `/api/delegates` routes

The implementation above follows the simplest approach. Can be refined later.

**Step 2: Commit**

```bash
git add apps/image-workshop/backend/controllers/oauth.ts
git commit -m "feat(image-workshop): add OAuth controller (authorize, token, discovery)"
```

---

## Task 8: Delegates Controller

**Files:**
- Create: `apps/image-workshop/backend/controllers/delegates.ts`

**Step 1: Create delegates controller**

Reference: `apps/server-next/backend/controllers/delegates.ts` lines 45-127.

```typescript
// apps/image-workshop/backend/controllers/delegates.ts
import { Hono } from "hono";
import type { Auth, DelegateGrantStore } from "../types/auth";
import {
  generateDelegateId,
  createDelegateAccessToken,
  generateRandomToken,
  sha256Hex,
} from "../utils/token";

type DelegatesControllerDeps = {
  grantStore: DelegateGrantStore;
};

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

function requireManageDelegates(auth: Auth | null) {
  if (!auth) throw new Error("Unauthorized");
  if (auth.type === "user") return auth;
  if (auth.permissions.includes("manage_delegates")) return auth;
  throw new Error("Forbidden: manage_delegates required");
}

export function createDelegatesRoutes(deps: DelegatesControllerDeps) {
  const routes = new Hono();
  const { grantStore } = deps;

  // List delegates
  routes.get("/api/delegates", async (c) => {
    const auth = requireManageDelegates(c.get("auth"));
    const grants = await grantStore.list(auth.userId);
    return c.json(
      grants.map((g) => ({
        delegateId: g.delegateId,
        clientName: g.clientName,
        permissions: g.permissions,
        createdAt: g.createdAt,
        expiresAt: g.expiresAt,
      }))
    );
  });

  // Create delegate
  routes.post("/api/delegates", async (c) => {
    const auth = requireManageDelegates(c.get("auth"));
    const body = await c.req.json<{
      clientName: string;
      permissions?: string[];
      ttl?: number;
    }>();

    const delegateId = generateDelegateId();
    const accessToken = createDelegateAccessToken(auth.userId, delegateId);
    const refreshToken = generateRandomToken();
    const now = Date.now();
    const ttl = body.ttl ?? DEFAULT_TTL_MS;
    const permissions = (body.permissions ?? ["use_mcp"]) as ("use_mcp" | "manage_delegates")[];

    await grantStore.insert({
      delegateId,
      userId: auth.userId,
      clientName: body.clientName,
      permissions,
      accessTokenHash: await sha256Hex(accessToken),
      refreshTokenHash: await sha256Hex(refreshToken),
      createdAt: now,
      expiresAt: now + ttl,
    });

    return c.json({
      delegateId,
      clientName: body.clientName,
      accessToken,
      refreshToken,
      permissions,
      expiresAt: now + ttl,
    });
  });

  // Revoke delegate
  routes.post("/api/delegates/:id/revoke", async (c) => {
    const auth = requireManageDelegates(c.get("auth"));
    const delegateId = c.req.param("id");
    const grant = await grantStore.get(delegateId);
    if (!grant || grant.userId !== auth.userId) {
      return c.json({ error: "not_found" }, 404);
    }
    await grantStore.remove(delegateId);
    return c.json({ ok: true });
  });

  return routes;
}
```

**Step 2: Commit**

```bash
git add apps/image-workshop/backend/controllers/delegates.ts
git commit -m "feat(image-workshop): add delegates controller (list, create, revoke)"
```

---

## Task 9: MCP Controller (Auth-Protected)

**Files:**
- Create: `apps/image-workshop/backend/controllers/mcp.ts`
- Existing (will be modified later): `apps/image-workshop/backend/app.ts`

**Step 1: Extract MCP handling into a controller**

Move the MCP transport logic from `app.ts` into a controller that enforces auth.

```typescript
// apps/image-workshop/backend/controllers/mcp.ts
import { Hono } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "../index";
import type { Auth } from "../types/auth";

function requireUseMcp(auth: Auth | null) {
  if (!auth) throw new Error("Unauthorized");
  if (auth.type === "user") return auth;
  if (auth.permissions.includes("use_mcp")) return auth;
  throw new Error("Forbidden: use_mcp required");
}

export function createMcpRoutes() {
  const routes = new Hono();

  routes.post("/mcp", async (c) => {
    requireUseMcp(c.get("auth"));

    const req = c.req.raw;
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const mcpServer = createMcpServer();
    await mcpServer.connect(transport);
    const res = await transport.handleRequest(req);
    await mcpServer.close();
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  });

  routes.get("/mcp", (c) => {
    return c.json(
      { error: "METHOD_NOT_ALLOWED", message: "SSE not supported. Use POST for JSON-RPC only." },
      405
    );
  });

  return routes;
}
```

**Step 2: Commit**

```bash
git add apps/image-workshop/backend/controllers/mcp.ts
git commit -m "feat(image-workshop): add auth-protected MCP controller"
```

---

## Task 10: Rewire app.ts

**Files:**
- Modify: `apps/image-workshop/backend/app.ts` (currently 44 lines)

**Step 1: Rewrite app.ts to register all routes**

Replace the current catch-all MCP handler with the new route structure:

```typescript
// apps/image-workshop/backend/app.ts
import { Hono } from "hono";
import { createAuthMiddleware } from "./middleware/auth";
import { createOAuthRoutes } from "./controllers/oauth";
import { createDelegatesRoutes } from "./controllers/delegates";
import { createMcpRoutes } from "./controllers/mcp";
import { createGrantStore } from "./db/grant-store";
import {
  createCognitoJwtVerifier,
  createMockJwtVerifier,
} from "./utils/jwt";
import type { CognitoConfig } from "./utils/cognito";

const cognitoConfig: CognitoConfig = {
  region: process.env.COGNITO_REGION ?? "us-east-1",
  userPoolId: process.env.COGNITO_USER_POOL_ID ?? "",
  clientId: process.env.COGNITO_CLIENT_ID ?? "",
  hostedUiUrl: process.env.COGNITO_HOSTED_UI_URL ?? "",
};

const grantStore = createGrantStore({
  tableName: process.env.DYNAMODB_TABLE_GRANTS ?? "image-workshop-grants",
  clientConfig: process.env.DYNAMODB_ENDPOINT
    ? { endpoint: process.env.DYNAMODB_ENDPOINT, region: "us-east-1" }
    : undefined,
});

const jwtVerifier = process.env.MOCK_JWT_SECRET
  ? createMockJwtVerifier(process.env.MOCK_JWT_SECRET)
  : createCognitoJwtVerifier(cognitoConfig);

const app = new Hono();

// Public routes (no auth)
const oauthRoutes = createOAuthRoutes({ cognitoConfig, grantStore });
app.route("/", oauthRoutes);

// Auth middleware for all other routes
const authMiddleware = createAuthMiddleware({ jwtVerifier, grantStore });
app.use("*", authMiddleware);

// Protected routes
const delegateRoutes = createDelegatesRoutes({ grantStore });
app.route("/", delegateRoutes);

const mcpRoutes = createMcpRoutes();
app.route("/", mcpRoutes);

export type App = typeof app;
export { app };
```

Important: The `app` field in `cell.yaml` backend entry (or convention `app.ts`) exports `app`, which is used by `cell dev` to start the local server and by `lambda.ts` for the Lambda handler.

**Step 2: Verify lambda.ts still works**

`lambda.ts` imports `{ app }` from `"./app"` — this export is preserved, so no changes needed.

**Step 3: Commit**

```bash
git add apps/image-workshop/backend/app.ts
git commit -m "feat(image-workshop): rewire app.ts with auth, oauth, delegates, mcp routes"
```

---

## Task 11: Update cell.yaml and .env.example

**Files:**
- Modify: `apps/image-workshop/cell.yaml` (add tables — already done in previous session)
- Modify: `apps/image-workshop/.env.example`

**Step 1: Verify cell.yaml has grants table**

Check that `cell.yaml` already has the `tables.grants` section from the previous session. If not, add it.

**Step 2: Update .env.example**

```
# Secrets for image-workshop (copy to .env and fill in values)
BFL_API_KEY=
PORT_BASE=7200
MOCK_JWT_SECRET=dev-secret-change-me
VITE_MOCK_JWT_SECRET=dev-secret-change-me
```

**Step 3: Commit**

```bash
git add apps/image-workshop/.env.example apps/image-workshop/cell.yaml
git commit -m "feat(image-workshop): update env example with mock JWT secret"
```

---

## Task 12: Frontend — Auth Store & API Fetch

**Files:**
- Create: `apps/image-workshop/frontend/lib/auth.ts`
- Create: `apps/image-workshop/frontend/lib/api.ts`

**Step 1: Create auth store**

```typescript
// apps/image-workshop/frontend/lib/auth.ts

const TOKEN_KEY = "iw_token";
const REFRESH_KEY = "iw_refresh";

type AuthState = {
  token: string;
  userId: string;
  email?: string;
};

let currentAuth: AuthState | null = null;
const listeners: Set<() => void> = new Set();

function notify() {
  for (const fn of listeners) fn();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getAuth(): AuthState | null {
  if (currentAuth) return currentAuth;
  const stored = localStorage.getItem(TOKEN_KEY);
  if (!stored) return null;
  try {
    const parts = stored.split(".");
    // Works for both JWT (3 parts) and mock JWT
    const payload = JSON.parse(atob(parts[1]));
    currentAuth = { token: stored, userId: payload.sub, email: payload.email };
    return currentAuth;
  } catch {
    localStorage.removeItem(TOKEN_KEY);
    return null;
  }
}

export function setTokens(token: string, refreshToken?: string) {
  localStorage.setItem(TOKEN_KEY, token);
  if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
  currentAuth = null; // reset cache
  getAuth(); // re-parse
  notify();
}

export function logout() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  currentAuth = null;
  notify();
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}
```

**Step 2: Create API fetch wrapper**

```typescript
// apps/image-workshop/frontend/lib/api.ts
import { getAuth, logout } from "./auth";

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const auth = getAuth();
  const headers = new Headers(init?.headers);
  if (auth) headers.set("Authorization", `Bearer ${auth.token}`);
  if (!headers.has("Content-Type") && init?.body) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(path, { ...init, headers });
  if (res.status === 401) {
    logout();
  }
  return res;
}
```

**Step 3: Commit**

```bash
git add apps/image-workshop/frontend/lib/
git commit -m "feat(image-workshop): add frontend auth store and API fetch wrapper"
```

---

## Task 13: Frontend — Mock JWT for Dev

**Files:**
- Create: `apps/image-workshop/frontend/lib/mock-jwt.ts`

**Step 1: Create mock JWT signer for dev mode**

In dev mode, the frontend signs its own mock JWT using `VITE_MOCK_JWT_SECRET`, bypassing Cognito. This token is validated by the backend's mock verifier.

```typescript
// apps/image-workshop/frontend/lib/mock-jwt.ts

function base64urlEncode(str: string): string {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacSign(data: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", enc.encode(data), key);
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function createMockJwt(sub: string, email?: string): Promise<string> {
  const secret = import.meta.env.VITE_MOCK_JWT_SECRET;
  if (!secret) throw new Error("VITE_MOCK_JWT_SECRET not set");

  const header = base64urlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64urlEncode(
    JSON.stringify({
      sub,
      email: email ?? `${sub}@dev.local`,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 86400,
    })
  );
  const sig = await hmacSign(`${header}.${payload}`, secret);
  return `${header}.${payload}.${sig}`;
}

export function isDevMode(): boolean {
  return import.meta.env.DEV && !!import.meta.env.VITE_MOCK_JWT_SECRET;
}
```

**Step 2: Commit**

```bash
git add apps/image-workshop/frontend/lib/mock-jwt.ts
git commit -m "feat(image-workshop): add mock JWT signer for dev mode"
```

---

## Task 14: Frontend — Full UI (Login + Delegates)

**Files:**
- Rewrite: `apps/image-workshop/frontend/main.tsx` (currently 115 lines)

**Step 1: Rewrite main.tsx with full application**

The UI has:
- **Login page**: shown when not authenticated. Google/Microsoft buttons (prod) or "Dev Login" (dev mode).
- **OAuth callback handler**: parses `?code=` from URL, exchanges for token.
- **Home page (authenticated)**: delegate management.

No image generation tab in this iteration (deferred — requires Casfa branch/token integration).

The component should be a single-file React app with inline styles (as per existing pattern).

Key behaviors:
- In dev mode (`isDevMode()`): show "Dev Login" button that creates mock JWT and stores it
- In prod mode: show "Sign in with Google" / "Sign in with Microsoft" buttons that redirect to `/oauth/authorize?identity_provider=Google` or `identity_provider=Microsoft`
- URL path `/oauth/callback` → exchange code → redirect to `/`
- Delegate management: `GET /api/delegates`, `POST /api/delegates`, `POST /api/delegates/:id/revoke`
- Table of delegates (name, permissions, created, expires, status, revoke action)
- Create dialog (name, permissions, TTL)
- Token display with copy button after creation

The full implementation should be written as clean React with hooks (`useState`, `useEffect`, `useCallback`), using `apiFetch` for all API calls.

**Step 2: Run `bun run dev` and verify the UI loads**

Expected: Login page appears with appropriate login options.

**Step 3: Commit**

```bash
git add apps/image-workshop/frontend/main.tsx
git commit -m "feat(image-workshop): add frontend UI (login, delegate management)"
```

---

## Task 15: Update cell-cli Vite Proxy

**Files:**
- Modify: `apps/cell-cli/src/commands/dev.ts`

**Step 1: Verify proxy config includes all backend routes**

Check that the Vite dev server proxy in `dev.ts` already includes:
- `/api` → backend
- `/oauth` → backend
- `/mcp` → backend
- `/.well-known` → backend

These were added in a previous session. If missing, add them. The proxy config should look like:

```typescript
proxy: {
  "/api": { target: `http://localhost:${httpPort}`, changeOrigin: true, rewrite: (path: string) => path.replace(/^\/api/, "") },
  "/oauth": { target: `http://localhost:${httpPort}`, changeOrigin: true },
  "/mcp": { target: `http://localhost:${httpPort}`, changeOrigin: true },
  "/.well-known": { target: `http://localhost:${httpPort}`, changeOrigin: true },
},
```

Wait — the `/api` proxy has a `rewrite` that strips `/api`. This is because the Hono app currently routes everything under root. But with the new app.ts, routes are at `/api/delegates`, `/oauth/authorize`, etc. — they include the prefix.

Check if the rewrite is correct. The backend Hono app defines routes as `/api/delegates`, so the proxy should NOT strip `/api`. Fix if needed.

**Step 2: Commit if changes were made**

```bash
git add apps/cell-cli/src/commands/dev.ts
git commit -m "fix(cell-cli): fix vite proxy to not strip /api prefix"
```

---

## Task 16: Final Integration Test

**Step 1: Run `bun run dev` in `apps/image-workshop`**

```bash
cd apps/image-workshop
bun run dev
```

Expected:
- Backend starts on port 7201
- Frontend starts on port 7200
- Opening http://localhost:7200 shows the login page

**Step 2: Test dev login flow**

1. Click "Dev Login"
2. Should create mock JWT and redirect to home
3. Should see Delegates management page

**Step 3: Test delegate creation**

1. Go to Delegates tab
2. Click "Create Delegate"
3. Enter name, select permissions
4. Should see delegate created with token

**Step 4: Test MCP endpoint**

With the token from step 3:
```bash
curl -X POST http://localhost:7200/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer <token>" \
  -d '{"jsonrpc":"2.0","method":"initialize","id":1,"params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}}'
```

Expected: MCP initialize response (not 401).

**Step 5: Commit all remaining changes**

```bash
git add -A
git commit -m "feat(image-workshop): complete auth & delegate system integration"
```

---

## Summary of File Changes

| Action | Path |
|--------|------|
| Create | `backend/types/auth.ts` |
| Create | `backend/utils/token.ts` |
| Create | `backend/utils/jwt.ts` |
| Create | `backend/utils/cognito.ts` |
| Create | `backend/db/grant-store.ts` |
| Create | `backend/middleware/auth.ts` |
| Create | `backend/controllers/oauth.ts` |
| Create | `backend/controllers/delegates.ts` |
| Create | `backend/controllers/mcp.ts` |
| Rewrite | `backend/app.ts` |
| Create | `frontend/lib/auth.ts` |
| Create | `frontend/lib/api.ts` |
| Create | `frontend/lib/mock-jwt.ts` |
| Rewrite | `frontend/main.tsx` |
| Modify | `cell.yaml` (verify tables) |
| Modify | `.env.example` |
| Maybe modify | `apps/cell-cli/src/commands/dev.ts` (proxy fix) |
