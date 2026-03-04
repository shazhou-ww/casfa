# Cell Auth Packages Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract Cognito auth, OAuth authorization server, and delegate management from image-workshop into three reusable packages (`@casfa/cell-cognito`, `@casfa/cell-oauth`, `@casfa/cell-auth-client`).

**Architecture:** Declarative orchestrator pattern — `cell-cognito` provides framework-agnostic Cognito/JWT utilities; `cell-oauth` provides `createOAuthServer()` which returns a set of handler functions that cell apps wire into their own Hono routes; `cell-auth-client` provides frontend auth utilities. `cell-oauth` depends on `cell-cognito`. All packages follow the existing monorepo patterns (bun build, exports with `bun`/`types`/`import` conditions, tsconfig extending root).

**Tech Stack:** TypeScript, Bun, jose (JWT), @aws-sdk/client-dynamodb + @aws-sdk/lib-dynamodb (grant store)

**Design doc:** `docs/plans/2026-03-05-cell-auth-packages-design.md`

---

### Task 1: Scaffold `@casfa/cell-cognito` package

**Files:**
- Create: `packages/cell-cognito/package.json`
- Create: `packages/cell-cognito/tsconfig.json`
- Create: `packages/cell-cognito/src/index.ts` (empty re-exports for now)

**Step 1: Create package.json**

```json
{
  "name": "@casfa/cell-cognito",
  "version": "0.1.0",
  "description": "Cognito/IdP integration for cell apps: JWT verification, token exchange, token refresh",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "bun": "./src/index.ts",
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "bun ../../scripts/build-pkg.ts",
    "test": "bun run test:unit",
    "test:unit": "bun test src/",
    "typecheck": "tsc --noEmit",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "check": "tsc --noEmit && biome check .",
    "prepublishOnly": "bun run build"
  },
  "dependencies": {
    "jose": "^6.0.11"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.3.0"
  },
  "files": ["dist", "README.md"],
  "publishConfig": { "access": "public" },
  "license": "MIT"
}
```

**Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": { "noEmit": true },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Create src/index.ts (placeholder)**

```typescript
export {};
```

**Step 4: Run typecheck to verify scaffold**

Run: `cd packages/cell-cognito && bunx tsc --noEmit`
Expected: no errors

**Step 5: Commit**

```bash
git add packages/cell-cognito/
git commit -m "chore: scaffold @casfa/cell-cognito package"
```

---

### Task 2: Implement `cell-cognito` types

**Files:**
- Create: `packages/cell-cognito/src/types.ts`
- Modify: `packages/cell-cognito/src/index.ts`

**Step 1: Create src/types.ts**

```typescript
export type CognitoConfig = {
  region: string;
  userPoolId: string;
  clientId: string;
  hostedUiUrl: string;
};

export type CognitoTokenSet = {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

export type CognitoRefreshedTokenSet = {
  idToken: string;
  accessToken: string;
  expiresAt: number;
};

export type VerifiedUser = {
  userId: string;
  email: string;
  name: string;
  rawClaims: Record<string, unknown>;
};

export type JwtVerifier = (token: string) => Promise<VerifiedUser>;
```

**Step 2: Update src/index.ts to re-export types**

```typescript
export type {
  CognitoConfig,
  CognitoTokenSet,
  CognitoRefreshedTokenSet,
  VerifiedUser,
  JwtVerifier,
} from "./types.ts";
```

**Step 3: Run typecheck**

Run: `cd packages/cell-cognito && bunx tsc --noEmit`
Expected: no errors

**Step 4: Commit**

```bash
git add packages/cell-cognito/src/
git commit -m "feat(cell-cognito): add core types"
```

---

### Task 3: Implement `cell-cognito` JWT verifier

**Files:**
- Create: `packages/cell-cognito/src/jwt-verifier.ts`
- Create: `packages/cell-cognito/src/jwt-verifier.test.ts`
- Modify: `packages/cell-cognito/src/index.ts`

**Step 1: Write the test**

```typescript
import { describe, expect, it } from "bun:test";
import * as jose from "jose";
import { createMockJwt, createMockJwtVerifier } from "./jwt-verifier.ts";

describe("createMockJwtVerifier", () => {
  const secret = "test-secret-key-for-unit-tests";

  it("verifies a valid mock JWT", async () => {
    const token = await createMockJwt(secret, {
      sub: "user-123",
      email: "test@example.com",
      name: "Test User",
    });
    const verifier = createMockJwtVerifier(secret);
    const result = await verifier(token);
    expect(result.userId).toBe("user-123");
    expect(result.email).toBe("test@example.com");
    expect(result.name).toBe("Test User");
    expect(result.rawClaims.sub).toBe("user-123");
  });

  it("rejects a token signed with wrong secret", async () => {
    const token = await createMockJwt("wrong-secret", {
      sub: "user-123",
      email: "test@example.com",
      name: "Test User",
    });
    const verifier = createMockJwtVerifier(secret);
    await expect(verifier(token)).rejects.toThrow();
  });

  it("throws if sub is missing", async () => {
    const key = new TextEncoder().encode(secret);
    const token = await new jose.SignJWT({ email: "test@example.com", name: "No Sub" })
      .setProtectedHeader({ alg: "HS256" })
      .sign(key);
    const verifier = createMockJwtVerifier(secret);
    await expect(verifier(token)).rejects.toThrow("Missing sub");
  });

  it("throws if email is missing", async () => {
    const token = await createMockJwt(secret, {
      sub: "user-123",
      name: "No Email",
    });
    const verifier = createMockJwtVerifier(secret);
    await expect(verifier(token)).rejects.toThrow("Missing email");
  });

  it("throws if name is missing", async () => {
    const token = await createMockJwt(secret, {
      sub: "user-123",
      email: "test@example.com",
    });
    const verifier = createMockJwtVerifier(secret);
    await expect(verifier(token)).rejects.toThrow("Missing name");
  });
});

describe("createMockJwt", () => {
  it("creates a JWT with the given payload", async () => {
    const secret = "test-secret";
    const token = await createMockJwt(secret, {
      sub: "user-456",
      email: "a@b.com",
      name: "A B",
    });
    expect(token.split(".")).toHaveLength(3);
  });
});
```

**Step 2: Run the test to verify it fails**

Run: `cd packages/cell-cognito && bun test src/jwt-verifier.test.ts`
Expected: FAIL (module not found)

**Step 3: Implement jwt-verifier.ts**

```typescript
import * as jose from "jose";
import type { JwtVerifier, VerifiedUser } from "./types.ts";

export function createCognitoJwtVerifier(config: {
  region: string;
  userPoolId: string;
}): JwtVerifier {
  const { region, userPoolId } = config;
  const jwksUrl = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`;
  const issuer = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
  const jwks = jose.createRemoteJWKSet(new URL(jwksUrl));

  return async (token: string): Promise<VerifiedUser> => {
    const { payload } = await jose.jwtVerify(token, jwks, { issuer });
    if (typeof payload.sub !== "string") throw new Error("Missing sub in JWT");
    if (typeof payload.email !== "string") throw new Error("Missing email in JWT");
    if (typeof payload.name !== "string") throw new Error("Missing name in JWT");
    return {
      userId: payload.sub,
      email: payload.email,
      name: payload.name,
      rawClaims: payload as Record<string, unknown>,
    };
  };
}

export function createMockJwtVerifier(secret: string): JwtVerifier {
  const key = new TextEncoder().encode(secret);
  return async (token: string): Promise<VerifiedUser> => {
    const { payload } = await jose.jwtVerify(token, key, { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string") throw new Error("Missing sub in mock JWT");
    if (typeof payload.email !== "string") throw new Error("Missing email in mock JWT");
    if (typeof payload.name !== "string") throw new Error("Missing name in mock JWT");
    return {
      userId: payload.sub,
      email: payload.email,
      name: payload.name,
      rawClaims: payload as Record<string, unknown>,
    };
  };
}

export async function createMockJwt(
  secret: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return new jose.SignJWT(payload as jose.JWTPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .sign(key);
}
```

**Step 4: Run tests to verify they pass**

Run: `cd packages/cell-cognito && bun test src/jwt-verifier.test.ts`
Expected: all tests PASS

**Step 5: Update index.ts**

Add to `packages/cell-cognito/src/index.ts`:

```typescript
export type {
  CognitoConfig,
  CognitoTokenSet,
  CognitoRefreshedTokenSet,
  VerifiedUser,
  JwtVerifier,
} from "./types.ts";

export {
  createCognitoJwtVerifier,
  createMockJwtVerifier,
  createMockJwt,
} from "./jwt-verifier.ts";
```

**Step 6: Commit**

```bash
git add packages/cell-cognito/src/
git commit -m "feat(cell-cognito): implement JWT verifier with Cognito and mock modes"
```

---

### Task 4: Implement `cell-cognito` token exchange and authorize URL

**Files:**
- Create: `packages/cell-cognito/src/cognito-client.ts`
- Create: `packages/cell-cognito/src/cognito-client.test.ts`
- Modify: `packages/cell-cognito/src/index.ts`

**Step 1: Write the test**

```typescript
import { describe, expect, it, mock } from "bun:test";
import { buildCognitoAuthorizeUrl } from "./cognito-client.ts";
import type { CognitoConfig } from "./types.ts";

const testConfig: CognitoConfig = {
  region: "us-east-1",
  userPoolId: "us-east-1_test",
  clientId: "test-client-id",
  hostedUiUrl: "https://test.auth.us-east-1.amazoncognito.com",
};

describe("buildCognitoAuthorizeUrl", () => {
  it("builds correct URL with all params", () => {
    const url = buildCognitoAuthorizeUrl(testConfig, {
      redirectUri: "https://example.com/callback",
      state: "abc123",
      scope: "openid profile",
      identityProvider: "Google",
    });
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://test.auth.us-east-1.amazoncognito.com");
    expect(parsed.pathname).toBe("/oauth2/authorize");
    expect(parsed.searchParams.get("client_id")).toBe("test-client-id");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("redirect_uri")).toBe("https://example.com/callback");
    expect(parsed.searchParams.get("state")).toBe("abc123");
    expect(parsed.searchParams.get("scope")).toBe("openid profile");
    expect(parsed.searchParams.get("identity_provider")).toBe("Google");
  });

  it("omits scope and identity_provider when null", () => {
    const url = buildCognitoAuthorizeUrl(testConfig, {
      redirectUri: "https://example.com/callback",
      state: "abc123",
      scope: null,
      identityProvider: null,
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.has("scope")).toBe(false);
    expect(parsed.searchParams.has("identity_provider")).toBe(false);
  });
});
```

Note: `exchangeCodeForTokens` and `refreshCognitoTokens` call external Cognito endpoints, so unit tests would need fetch mocking. We test `buildCognitoAuthorizeUrl` directly; the exchange functions are structurally simple HTTP calls.

**Step 2: Run test to verify it fails**

Run: `cd packages/cell-cognito && bun test src/cognito-client.test.ts`
Expected: FAIL (module not found)

**Step 3: Implement cognito-client.ts**

```typescript
import type { CognitoConfig, CognitoRefreshedTokenSet, CognitoTokenSet } from "./types.ts";

type CognitoTokenResponse = {
  access_token: string;
  id_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
};

export async function exchangeCodeForTokens(
  config: CognitoConfig,
  code: string,
  redirectUri: string,
): Promise<CognitoTokenSet> {
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

  const data: CognitoTokenResponse = await res.json();
  if (!data.refresh_token) {
    throw new Error("Cognito did not return a refresh_token for authorization_code grant");
  }
  return {
    idToken: data.id_token,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Math.floor(Date.now() / 1000) + data.expires_in,
  };
}

export async function refreshCognitoTokens(
  config: CognitoConfig,
  refreshToken: string,
): Promise<CognitoRefreshedTokenSet> {
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

  const data: CognitoTokenResponse = await res.json();
  return {
    idToken: data.id_token,
    accessToken: data.access_token,
    expiresAt: Math.floor(Date.now() / 1000) + data.expires_in,
  };
}

export function buildCognitoAuthorizeUrl(
  config: CognitoConfig,
  params: {
    redirectUri: string;
    state: string;
    scope: string | null;
    identityProvider: string | null;
  },
): string {
  const query = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: params.redirectUri,
    state: params.state,
  });
  if (params.scope) query.set("scope", params.scope);
  if (params.identityProvider) query.set("identity_provider", params.identityProvider);
  return `${config.hostedUiUrl}/oauth2/authorize?${query}`;
}
```

**Step 4: Run tests to verify they pass**

Run: `cd packages/cell-cognito && bun test src/cognito-client.test.ts`
Expected: all tests PASS

**Step 5: Update index.ts**

Final `packages/cell-cognito/src/index.ts`:

```typescript
export type {
  CognitoConfig,
  CognitoTokenSet,
  CognitoRefreshedTokenSet,
  VerifiedUser,
  JwtVerifier,
} from "./types.ts";

export {
  createCognitoJwtVerifier,
  createMockJwtVerifier,
  createMockJwt,
} from "./jwt-verifier.ts";

export {
  exchangeCodeForTokens,
  refreshCognitoTokens,
  buildCognitoAuthorizeUrl,
} from "./cognito-client.ts";
```

**Step 6: Run all cell-cognito tests**

Run: `cd packages/cell-cognito && bun test src/`
Expected: all PASS

**Step 7: Commit**

```bash
git add packages/cell-cognito/src/
git commit -m "feat(cell-cognito): implement token exchange, refresh, and authorize URL builder"
```

---

### Task 5: Scaffold `@casfa/cell-oauth` package

**Files:**
- Create: `packages/cell-oauth/package.json`
- Create: `packages/cell-oauth/tsconfig.json`
- Create: `packages/cell-oauth/src/index.ts` (placeholder)

**Step 1: Create package.json**

```json
{
  "name": "@casfa/cell-oauth",
  "version": "0.1.0",
  "description": "OAuth 2.0 authorization server + delegate management for cell apps",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "bun": "./src/index.ts",
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "bun ../../scripts/build-pkg.ts",
    "test": "bun run test:unit",
    "test:unit": "bun test src/",
    "typecheck": "tsc --noEmit",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "check": "tsc --noEmit && biome check .",
    "prepublishOnly": "bun run build"
  },
  "dependencies": {
    "@casfa/cell-cognito": "workspace:*",
    "@aws-sdk/client-dynamodb": "^3.700.0",
    "@aws-sdk/lib-dynamodb": "^3.700.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.3.0"
  },
  "files": ["dist", "README.md"],
  "publishConfig": { "access": "public" },
  "license": "MIT"
}
```

**Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": { "noEmit": true },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Create src/index.ts (placeholder)**

```typescript
export {};
```

**Step 4: Run typecheck**

Run: `cd packages/cell-oauth && bunx tsc --noEmit`
Expected: no errors

**Step 5: Commit**

```bash
git add packages/cell-oauth/
git commit -m "chore: scaffold @casfa/cell-oauth package"
```

---

### Task 6: Implement `cell-oauth` types

**Files:**
- Create: `packages/cell-oauth/src/types.ts`
- Modify: `packages/cell-oauth/src/index.ts`

**Step 1: Create src/types.ts**

```typescript
export type DelegatePermission = "use_mcp" | "manage_delegates" | (string & {});

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
  expiresAt: number;
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
    update: { accessTokenHash: string; refreshTokenHash: string | null },
  ): Promise<void>;
};

export type OAuthMetadata = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
  response_types_supported: string[];
  grant_types_supported: string[];
  code_challenge_methods_supported: string[];
  scopes_supported: string[];
};

export type RegisteredClient = {
  clientId: string;
  clientName: string;
  redirectUris: string[];
};

export type CallbackResult =
  | { type: "tokens"; redirectUrl: string }
  | { type: "consent_required"; sessionId: string; redirectUrl: string };

export type ConsentInfo = {
  defaultClientName: string;
  userEmail: string;
  userName: string;
  permissions: DelegatePermission[];
};

export type TokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  id_token?: string;
  refresh_token?: string;
};
```

**Step 2: Update index.ts**

```typescript
export type {
  DelegatePermission,
  UserAuth,
  DelegateAuth,
  Auth,
  DelegateGrant,
  DelegateGrantStore,
  OAuthMetadata,
  RegisteredClient,
  CallbackResult,
  ConsentInfo,
  TokenResponse,
} from "./types.ts";
```

**Step 3: Typecheck**

Run: `cd packages/cell-oauth && bunx tsc --noEmit`
Expected: no errors

**Step 4: Commit**

```bash
git add packages/cell-oauth/src/
git commit -m "feat(cell-oauth): add core types"
```

---

### Task 7: Implement `cell-oauth` token utilities

**Files:**
- Create: `packages/cell-oauth/src/token.ts`
- Create: `packages/cell-oauth/src/token.test.ts`
- Modify: `packages/cell-oauth/src/index.ts`

**Step 1: Write the test**

```typescript
import { describe, expect, it } from "bun:test";
import {
  createDelegateAccessToken,
  decodeDelegateTokenPayload,
  generateDelegateId,
  generateRandomToken,
  sha256Hex,
  verifyCodeChallenge,
} from "./token.ts";

describe("sha256Hex", () => {
  it("produces a 64-char hex string", async () => {
    const hash = await sha256Hex("hello");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic", async () => {
    const a = await sha256Hex("test-input");
    const b = await sha256Hex("test-input");
    expect(a).toBe(b);
  });
});

describe("generateDelegateId", () => {
  it("starts with dlg_", () => {
    const id = generateDelegateId();
    expect(id.startsWith("dlg_")).toBe(true);
  });

  it("generates unique IDs", () => {
    const a = generateDelegateId();
    const b = generateDelegateId();
    expect(a).not.toBe(b);
  });
});

describe("generateRandomToken", () => {
  it("returns a base64url string", () => {
    const token = generateRandomToken();
    expect(token.length).toBeGreaterThan(20);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("delegate access token", () => {
  it("roundtrips encode/decode", () => {
    const token = createDelegateAccessToken("user-123", "dlg_ABC");
    const payload = decodeDelegateTokenPayload(token);
    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe("user-123");
    expect(payload!.dlg).toBe("dlg_ABC");
  });

  it("returns null for invalid tokens", () => {
    expect(decodeDelegateTokenPayload("not-a-token")).toBeNull();
    expect(decodeDelegateTokenPayload("a.b.c")).toBeNull();
    expect(decodeDelegateTokenPayload("")).toBeNull();
  });
});

describe("verifyCodeChallenge", () => {
  it("verifies S256 challenge", async () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const hash = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    );
    const challenge = btoa(String.fromCharCode(...hash))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(await verifyCodeChallenge(verifier, challenge, "S256")).toBe(true);
    expect(await verifyCodeChallenge("wrong", challenge, "S256")).toBe(false);
  });

  it("verifies plain challenge", async () => {
    expect(await verifyCodeChallenge("abc", "abc", "plain")).toBe(true);
    expect(await verifyCodeChallenge("abc", "def", "plain")).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/cell-oauth && bun test src/token.test.ts`
Expected: FAIL

**Step 3: Implement token.ts**

```typescript
import { randomUUID } from "node:crypto";

const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

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

export function generateDelegateId(): string {
  const uuid = randomUUID().replace(/-/g, "");
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = Number.parseInt(uuid.slice(i * 2, i * 2 + 2), 16);
  }
  return `dlg_${crockfordBase32Encode(bytes)}`;
}

export function generateRandomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function createDelegateAccessToken(userId: string, delegateId: string): string {
  const payload = { sub: userId, dlg: delegateId, iat: Math.floor(Date.now() / 1000) };
  const payloadB64 = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const sig = generateRandomToken();
  return `${payloadB64}.${sig}`;
}

export function decodeDelegateTokenPayload(
  token: string,
): { sub: string; dlg: string; iat: number } | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  try {
    const json = atob(parts[0].replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(json);
    if (typeof payload.sub === "string" && typeof payload.dlg === "string") {
      return { sub: payload.sub, dlg: payload.dlg, iat: payload.iat ?? 0 };
    }
    return null;
  } catch {
    return null;
  }
}

export async function verifyCodeChallenge(
  verifier: string,
  challenge: string,
  method: string,
): Promise<boolean> {
  if (method === "S256") {
    const hash = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    );
    const encoded = btoa(String.fromCharCode(...hash))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    return encoded === challenge;
  }
  return verifier === challenge;
}
```

**Step 4: Run tests**

Run: `cd packages/cell-oauth && bun test src/token.test.ts`
Expected: all PASS

**Step 5: Add exports to index.ts**

```typescript
export type {
  DelegatePermission,
  UserAuth,
  DelegateAuth,
  Auth,
  DelegateGrant,
  DelegateGrantStore,
  OAuthMetadata,
  RegisteredClient,
  CallbackResult,
  ConsentInfo,
  TokenResponse,
} from "./types.ts";

export {
  sha256Hex,
  generateDelegateId,
  generateRandomToken,
  createDelegateAccessToken,
  decodeDelegateTokenPayload,
  verifyCodeChallenge,
} from "./token.ts";
```

**Step 6: Commit**

```bash
git add packages/cell-oauth/src/
git commit -m "feat(cell-oauth): implement token utilities (sha256, delegate tokens, PKCE)"
```

---

### Task 8: Implement `cell-oauth` DynamoDB grant store

**Files:**
- Create: `packages/cell-oauth/src/dynamo-grant-store.ts`
- Modify: `packages/cell-oauth/src/index.ts`

Note: DynamoDB grant store interacts with real AWS services. We skip unit tests here — it will be tested via integration tests during image-workshop migration.

**Step 1: Implement dynamo-grant-store.ts**

```typescript
import {
  DeleteCommand,
  type DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import type { DelegateGrant, DelegateGrantStore } from "./types.ts";

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
    expiresAt: item.expiresAt as number,
  };
}

export function createDynamoGrantStore(params: {
  tableName: string;
  client: DynamoDBDocumentClient;
}): DelegateGrantStore {
  const { tableName, client } = params;

  return {
    async list(userId) {
      const result = await client.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: "user-hash-index",
          KeyConditionExpression: "gsi1pk = :pk",
          ExpressionAttributeValues: { ":pk": `USER#${userId}` },
        }),
      );
      return (result.Items ?? []).map(fromItem);
    },

    async get(delegateId) {
      const result = await client.send(
        new GetCommand({
          TableName: tableName,
          Key: { pk: `GRANT#${delegateId}`, sk: "METADATA" },
        }),
      );
      return result.Item ? fromItem(result.Item) : null;
    },

    async getByAccessTokenHash(userId, hash) {
      const result = await client.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: "user-hash-index",
          KeyConditionExpression: "gsi1pk = :pk AND gsi1sk = :sk",
          ExpressionAttributeValues: {
            ":pk": `USER#${userId}`,
            ":sk": `HASH#${hash}`,
          },
        }),
      );
      const items = result.Items ?? [];
      return items.length > 0 ? fromItem(items[0]) : null;
    },

    async getByRefreshTokenHash(userId, hash) {
      const result = await client.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: "user-refresh-index",
          KeyConditionExpression: "gsi2pk = :pk AND gsi2sk = :sk",
          ExpressionAttributeValues: {
            ":pk": `USER#${userId}`,
            ":sk": `REFRESH#${hash}`,
          },
        }),
      );
      const items = result.Items ?? [];
      return items.length > 0 ? fromItem(items[0]) : null;
    },

    async insert(grant) {
      await client.send(new PutCommand({ TableName: tableName, Item: toItem(grant) }));
    },

    async remove(delegateId) {
      await client.send(
        new DeleteCommand({
          TableName: tableName,
          Key: { pk: `GRANT#${delegateId}`, sk: "METADATA" },
        }),
      );
    },

    async updateTokens(delegateId, update) {
      const existing = await client.send(
        new GetCommand({
          TableName: tableName,
          Key: { pk: `GRANT#${delegateId}`, sk: "METADATA" },
        }),
      );
      if (!existing.Item) throw new Error("Grant not found");
      const grant = fromItem(existing.Item);
      grant.accessTokenHash = update.accessTokenHash;
      grant.refreshTokenHash = update.refreshTokenHash;
      await client.send(new PutCommand({ TableName: tableName, Item: toItem(grant) }));
    },
  };
}
```

**Step 2: Add to index.ts**

Add this line to exports:

```typescript
export { createDynamoGrantStore } from "./dynamo-grant-store.ts";
```

**Step 3: Typecheck**

Run: `cd packages/cell-oauth && bunx tsc --noEmit`
Expected: no errors

**Step 4: Commit**

```bash
git add packages/cell-oauth/src/
git commit -m "feat(cell-oauth): implement DynamoDB grant store"
```

---

### Task 9: Implement `cell-oauth` OAuth server orchestrator

This is the largest task. The orchestrator `createOAuthServer` encapsulates the entire OAuth flow + delegate management + auth resolution.

**Files:**
- Create: `packages/cell-oauth/src/oauth-server.ts`
- Create: `packages/cell-oauth/src/oauth-server.test.ts`
- Modify: `packages/cell-oauth/src/index.ts`

**Step 1: Write the test**

```typescript
import { describe, expect, it, beforeEach } from "bun:test";
import type { DelegateGrant, DelegateGrantStore } from "./types.ts";
import type { CognitoConfig, JwtVerifier } from "@casfa/cell-cognito";
import { createOAuthServer } from "./oauth-server.ts";

function createMemoryGrantStore(): DelegateGrantStore {
  const grants = new Map<string, DelegateGrant>();

  return {
    async list(userId) {
      return [...grants.values()].filter((g) => g.userId === userId);
    },
    async get(delegateId) {
      return grants.get(delegateId) ?? null;
    },
    async getByAccessTokenHash(userId, hash) {
      return (
        [...grants.values()].find(
          (g) => g.userId === userId && g.accessTokenHash === hash,
        ) ?? null
      );
    },
    async getByRefreshTokenHash(userId, hash) {
      return (
        [...grants.values()].find(
          (g) => g.userId === userId && g.refreshTokenHash === hash,
        ) ?? null
      );
    },
    async insert(grant) {
      grants.set(grant.delegateId, grant);
    },
    async remove(delegateId) {
      grants.delete(delegateId);
    },
    async updateTokens(delegateId, update) {
      const g = grants.get(delegateId);
      if (!g) throw new Error("not found");
      g.accessTokenHash = update.accessTokenHash;
      g.refreshTokenHash = update.refreshTokenHash;
    },
  };
}

const mockCognitoConfig: CognitoConfig = {
  region: "us-east-1",
  userPoolId: "us-east-1_test",
  clientId: "test-client",
  hostedUiUrl: "https://test.auth.us-east-1.amazoncognito.com",
};

const mockJwtVerifier: JwtVerifier = async (token: string) => {
  const parts = token.split(".");
  if (parts.length < 3) throw new Error("Not a JWT");
  const payload = JSON.parse(atob(parts[1]));
  return {
    userId: payload.sub,
    email: payload.email ?? "test@test.com",
    name: payload.name ?? "Test",
    rawClaims: payload,
  };
};

describe("createOAuthServer", () => {
  let grantStore: DelegateGrantStore;

  beforeEach(() => {
    grantStore = createMemoryGrantStore();
  });

  function createServer() {
    return createOAuthServer({
      issuerUrl: "https://example.com",
      cognitoConfig: mockCognitoConfig,
      jwtVerifier: mockJwtVerifier,
      grantStore,
      permissions: ["use_mcp", "manage_delegates"],
    });
  }

  describe("getMetadata", () => {
    it("returns correct OAuth metadata", () => {
      const server = createServer();
      const meta = server.getMetadata();
      expect(meta.issuer).toBe("https://example.com");
      expect(meta.authorization_endpoint).toBe("https://example.com/oauth/authorize");
      expect(meta.token_endpoint).toBe("https://example.com/oauth/token");
      expect(meta.registration_endpoint).toBe("https://example.com/oauth/register");
      expect(meta.code_challenge_methods_supported).toContain("S256");
    });
  });

  describe("registerClient", () => {
    it("registers a client and returns client_id", () => {
      const server = createServer();
      const client = server.registerClient({
        clientName: "My App",
        redirectUris: ["https://app.com/callback"],
      });
      expect(client.clientId).toBeTruthy();
      expect(client.clientName).toBe("My App");
      expect(client.redirectUris).toEqual(["https://app.com/callback"]);
    });
  });

  describe("delegate CRUD", () => {
    it("creates, lists, and revokes delegates", async () => {
      const server = createServer();

      const result = await server.createDelegate({
        userId: "user-1",
        clientName: "Test Client",
        permissions: ["use_mcp"],
      });

      expect(result.grant.delegateId).toMatch(/^dlg_/);
      expect(result.grant.userId).toBe("user-1");
      expect(result.accessToken).toBeTruthy();
      expect(result.refreshToken).toBeTruthy();

      const list = await server.listDelegates("user-1");
      expect(list).toHaveLength(1);
      expect(list[0].delegateId).toBe(result.grant.delegateId);

      await server.revokeDelegate(result.grant.delegateId);
      const listAfter = await server.listDelegates("user-1");
      expect(listAfter).toHaveLength(0);
    });
  });

  describe("resolveAuth", () => {
    it("resolves a delegate access token", async () => {
      const server = createServer();

      const { accessToken } = await server.createDelegate({
        userId: "user-1",
        clientName: "Test",
        permissions: ["use_mcp"],
      });

      const auth = await server.resolveAuth(accessToken);
      expect(auth).not.toBeNull();
      expect(auth!.type).toBe("delegate");
      if (auth!.type === "delegate") {
        expect(auth!.userId).toBe("user-1");
        expect(auth!.permissions).toContain("use_mcp");
      }
    });

    it("returns null for unknown token", async () => {
      const server = createServer();
      const auth = await server.resolveAuth("random-invalid-token");
      expect(auth).toBeNull();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/cell-oauth && bun test src/oauth-server.test.ts`
Expected: FAIL

**Step 3: Implement oauth-server.ts**

This is the core file. It wraps all the OAuth logic from `image-workshop/backend/controllers/oauth.ts` into a framework-agnostic orchestrator.

```typescript
import type { CognitoConfig, JwtVerifier } from "@casfa/cell-cognito";
import { exchangeCodeForTokens, refreshCognitoTokens } from "@casfa/cell-cognito";
import type {
  Auth,
  CallbackResult,
  ConsentInfo,
  DelegateGrant,
  DelegateGrantStore,
  DelegatePermission,
  OAuthMetadata,
  RegisteredClient,
  TokenResponse,
} from "./types.ts";
import {
  createDelegateAccessToken,
  decodeDelegateTokenPayload,
  generateDelegateId,
  generateRandomToken,
  sha256Hex,
  verifyCodeChallenge,
} from "./token.ts";

const DEFAULT_ACCESS_TTL_MS = 24 * 60 * 60 * 1000;
const AUTH_CODE_TTL_MS = 5 * 60 * 1000;
const CONSENT_TTL_MS = 10 * 60 * 1000;
const REGISTRATION_TTL_MS = 60 * 60 * 1000;

type PendingAuthCode = {
  accessToken: string;
  refreshToken: string;
  idToken: string | null;
  expiresIn: number;
  isDelegateFlow: boolean;
  createdAt: number;
  codeChallenge: string | null;
  codeChallengeMethod: string | null;
};

type PendingConsent = {
  userId: string;
  userEmail: string;
  userName: string;
  clientRedirectUri: string;
  clientState: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  defaultClientName: string;
  createdAt: number;
};

type InternalRegisteredClient = {
  clientName: string;
  redirectUris: string[];
  createdAt: number;
};

export type OAuthServerConfig = {
  issuerUrl: string;
  cognitoConfig: CognitoConfig;
  jwtVerifier: JwtVerifier;
  grantStore: DelegateGrantStore;
  permissions: DelegatePermission[];
};

export type OAuthServer = {
  getMetadata(): OAuthMetadata;
  registerClient(params: { clientName: string; redirectUris: string[] }): RegisteredClient;
  handleAuthorize(params: {
    responseType: string;
    clientId: string;
    redirectUri: string;
    state: string;
    scope: string | null;
    codeChallenge: string | null;
    codeChallengeMethod: string | null;
    identityProvider: string | null;
  }): { redirectUrl: string };
  handleCallback(params: { code: string; state: string }): Promise<CallbackResult>;
  getConsentInfo(sessionId: string): ConsentInfo | null;
  approveConsent(params: {
    sessionId: string;
    clientName: string;
  }): Promise<{ redirectUrl: string }>;
  denyConsent(sessionId: string): { redirectUrl: string | null };
  handleToken(params: {
    grantType: string;
    code: string | null;
    codeVerifier: string | null;
    refreshToken: string | null;
    clientId: string | null;
  }): Promise<TokenResponse>;
  resolveAuth(bearerToken: string): Promise<Auth | null>;
  listDelegates(userId: string): Promise<DelegateGrant[]>;
  createDelegate(params: {
    userId: string;
    clientName: string;
    permissions: DelegatePermission[];
  }): Promise<{ grant: DelegateGrant; accessToken: string; refreshToken: string }>;
  revokeDelegate(delegateId: string): Promise<void>;
};

export function createOAuthServer(config: OAuthServerConfig): OAuthServer {
  const { issuerUrl, cognitoConfig, jwtVerifier, grantStore, permissions } = config;

  const pendingCodes = new Map<string, PendingAuthCode>();
  const pendingConsents = new Map<string, PendingConsent>();
  const registeredClients = new Map<string, InternalRegisteredClient>();

  function cleanExpired() {
    const now = Date.now();
    for (const [k, v] of pendingCodes) {
      if (now - v.createdAt > AUTH_CODE_TTL_MS) pendingCodes.delete(k);
    }
    for (const [k, v] of pendingConsents) {
      if (now - v.createdAt > CONSENT_TTL_MS) pendingConsents.delete(k);
    }
    for (const [k, v] of registeredClients) {
      if (now - v.createdAt > REGISTRATION_TTL_MS) registeredClients.delete(k);
    }
  }

  return {
    getMetadata(): OAuthMetadata {
      return {
        issuer: issuerUrl,
        authorization_endpoint: `${issuerUrl}/oauth/authorize`,
        token_endpoint: `${issuerUrl}/oauth/token`,
        registration_endpoint: `${issuerUrl}/oauth/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        scopes_supported: ["openid", "profile", "email", "delegate"],
      };
    },

    registerClient(params) {
      cleanExpired();
      const virtualId = `${cognitoConfig.clientId}:${generateRandomToken().substring(0, 16)}`;
      registeredClients.set(virtualId, {
        clientName: params.clientName,
        redirectUris: params.redirectUris,
        createdAt: Date.now(),
      });
      return {
        clientId: virtualId,
        clientName: params.clientName,
        redirectUris: params.redirectUris,
      };
    },

    handleAuthorize(params) {
      const registered = registeredClients.get(params.clientId);
      const clientName = registered?.clientName ?? "MCP Client";

      const scope = params.scope ?? "openid profile email";
      const serverCallbackUri = `${issuerUrl}/oauth/callback`;

      const wrappedState = btoa(
        JSON.stringify({
          s: params.state,
          r: params.redirectUri,
          sc: scope,
          cc: params.codeChallenge ?? "",
          ccm: params.codeChallengeMethod ?? "",
          cn: clientName,
        }),
      );

      const query = new URLSearchParams({
        client_id: cognitoConfig.clientId,
        response_type: "code",
        scope: "openid profile email",
        redirect_uri: serverCallbackUri,
        state: wrappedState,
      });
      if (params.identityProvider) query.set("identity_provider", params.identityProvider);

      return {
        redirectUrl: `${cognitoConfig.hostedUiUrl}/oauth2/authorize?${query}`,
      };
    },

    async handleCallback(params) {
      let clientState = "";
      let clientRedirectUri = "";
      let scope = "openid profile email";
      let codeChallenge = "";
      let codeChallengeMethod = "";
      let clientName = "MCP Client";

      try {
        const parsed = JSON.parse(atob(params.state));
        clientState = parsed.s ?? "";
        clientRedirectUri = parsed.r ?? "";
        scope = parsed.sc ?? scope;
        codeChallenge = parsed.cc ?? "";
        codeChallengeMethod = parsed.ccm ?? "";
        clientName = parsed.cn ?? clientName;
      } catch {
        /* state not wrapped, treat as frontend flow */
      }

      const serverCallbackUri = `${issuerUrl}/oauth/callback`;
      const cognitoTokens = await exchangeCodeForTokens(
        cognitoConfig,
        params.code,
        serverCallbackUri,
      );

      const idTokenPayload = JSON.parse(atob(cognitoTokens.idToken.split(".")[1]));
      const userId = idTokenPayload.sub as string;

      cleanExpired();

      if (scope.includes("delegate")) {
        const sessionToken = generateRandomToken();
        pendingConsents.set(sessionToken, {
          userId,
          userEmail: idTokenPayload.email ?? "",
          userName: idTokenPayload.name ?? "",
          clientRedirectUri,
          clientState,
          codeChallenge,
          codeChallengeMethod,
          defaultClientName: clientName,
          createdAt: Date.now(),
        });

        const consentUrl = new URL(`${issuerUrl}/oauth/consent`);
        consentUrl.searchParams.set("session", sessionToken);
        return {
          type: "consent_required" as const,
          sessionId: sessionToken,
          redirectUrl: consentUrl.toString(),
        };
      }

      const ourCode = generateRandomToken();
      pendingCodes.set(ourCode, {
        accessToken: cognitoTokens.accessToken,
        refreshToken: cognitoTokens.refreshToken,
        idToken: cognitoTokens.idToken,
        expiresIn: cognitoTokens.expiresAt - Math.floor(Date.now() / 1000),
        isDelegateFlow: false,
        createdAt: Date.now(),
        codeChallenge: codeChallenge || null,
        codeChallengeMethod: codeChallengeMethod || null,
      });

      const redirectUrl = new URL(`${issuerUrl}/oauth/callback-complete`);
      redirectUrl.searchParams.set("code", ourCode);
      return { type: "tokens" as const, redirectUrl: redirectUrl.toString() };
    },

    getConsentInfo(sessionId) {
      cleanExpired();
      const pending = pendingConsents.get(sessionId);
      if (!pending) return null;
      return {
        defaultClientName: pending.defaultClientName,
        userEmail: pending.userEmail,
        userName: pending.userName,
        permissions: ["use_mcp"] as DelegatePermission[],
      };
    },

    async approveConsent(params) {
      cleanExpired();
      const pending = pendingConsents.get(params.sessionId);
      if (!pending) throw new Error("expired_or_invalid_session");
      pendingConsents.delete(params.sessionId);

      const clientName = params.clientName.trim() || pending.defaultClientName;
      const delegateId = generateDelegateId();
      const accessToken = createDelegateAccessToken(pending.userId, delegateId);
      const refreshToken = generateRandomToken();
      const now = Date.now();

      await grantStore.insert({
        delegateId,
        userId: pending.userId,
        clientName,
        permissions: ["use_mcp"],
        accessTokenHash: await sha256Hex(accessToken),
        refreshTokenHash: await sha256Hex(refreshToken),
        createdAt: now,
        expiresAt: now + DEFAULT_ACCESS_TTL_MS,
      });

      const ourCode = generateRandomToken();
      pendingCodes.set(ourCode, {
        accessToken,
        refreshToken,
        idToken: null,
        expiresIn: DEFAULT_ACCESS_TTL_MS / 1000,
        isDelegateFlow: true,
        createdAt: now,
        codeChallenge: pending.codeChallenge || null,
        codeChallengeMethod: pending.codeChallengeMethod || null,
      });

      if (pending.clientRedirectUri) {
        const redirectUrl = new URL(pending.clientRedirectUri);
        redirectUrl.searchParams.set("code", ourCode);
        if (pending.clientState) redirectUrl.searchParams.set("state", pending.clientState);
        return { redirectUrl: redirectUrl.toString() };
      }

      return { redirectUrl: `${issuerUrl}/oauth/callback-complete?code=${ourCode}` };
    },

    denyConsent(sessionId) {
      cleanExpired();
      const pending = pendingConsents.get(sessionId);
      pendingConsents.delete(sessionId);
      if (pending?.clientRedirectUri) {
        const url = new URL(pending.clientRedirectUri);
        url.searchParams.set("error", "access_denied");
        if (pending.clientState) url.searchParams.set("state", pending.clientState);
        return { redirectUrl: url.toString() };
      }
      return { redirectUrl: null };
    },

    async handleToken(params) {
      if (params.grantType === "authorization_code") {
        if (!params.code) throw new Error("missing code");
        cleanExpired();
        const pending = pendingCodes.get(params.code);
        if (!pending) throw new Error("invalid_grant: unknown or expired code");
        pendingCodes.delete(params.code);

        if (pending.codeChallenge && pending.codeChallengeMethod) {
          if (!params.codeVerifier) throw new Error("invalid_request: code_verifier required");
          const valid = await verifyCodeChallenge(
            params.codeVerifier,
            pending.codeChallenge,
            pending.codeChallengeMethod,
          );
          if (!valid) throw new Error("invalid_grant: code_verifier mismatch");
        }

        const response: TokenResponse = {
          access_token: pending.accessToken,
          token_type: "Bearer",
          expires_in: pending.expiresIn,
        };
        if (!pending.isDelegateFlow && pending.idToken) {
          response.id_token = pending.idToken;
        }
        if (pending.refreshToken) {
          response.refresh_token = pending.refreshToken;
        }
        return response;
      }

      if (params.grantType === "refresh_token") {
        if (!params.refreshToken) throw new Error("missing refresh_token");
        const cognitoTokens = await refreshCognitoTokens(cognitoConfig, params.refreshToken);
        return {
          access_token: cognitoTokens.accessToken,
          token_type: "Bearer",
          expires_in: cognitoTokens.expiresAt - Math.floor(Date.now() / 1000),
          id_token: cognitoTokens.idToken,
        };
      }

      throw new Error("unsupported_grant_type");
    },

    async resolveAuth(bearerToken) {
      const parts = bearerToken.split(".");
      const hash = await sha256Hex(bearerToken);

      if (parts.length >= 3) {
        try {
          const verified = await jwtVerifier(bearerToken);
          const grant = await grantStore.getByAccessTokenHash(verified.userId, hash);
          if (grant) {
            return {
              type: "delegate",
              userId: verified.userId,
              delegateId: grant.delegateId,
              permissions: grant.permissions,
            };
          }
          return { type: "user", userId: verified.userId };
        } catch {
          return null;
        }
      }

      if (parts.length === 2) {
        const payload = decodeDelegateTokenPayload(bearerToken);
        if (!payload) return null;
        const grant = await grantStore.getByAccessTokenHash(payload.sub, hash);
        if (grant) {
          return {
            type: "delegate",
            userId: payload.sub,
            delegateId: grant.delegateId,
            permissions: grant.permissions,
          };
        }
        return null;
      }

      return null;
    },

    async listDelegates(userId) {
      return grantStore.list(userId);
    },

    async createDelegate(params) {
      const delegateId = generateDelegateId();
      const accessToken = createDelegateAccessToken(params.userId, delegateId);
      const refreshToken = generateRandomToken();
      const now = Date.now();

      const grant: DelegateGrant = {
        delegateId,
        userId: params.userId,
        clientName: params.clientName,
        permissions: params.permissions,
        accessTokenHash: await sha256Hex(accessToken),
        refreshTokenHash: await sha256Hex(refreshToken),
        createdAt: now,
        expiresAt: now + DEFAULT_ACCESS_TTL_MS,
      };

      await grantStore.insert(grant);
      return { grant, accessToken, refreshToken };
    },

    async revokeDelegate(delegateId) {
      await grantStore.remove(delegateId);
    },
  };
}
```

**Step 4: Run tests**

Run: `cd packages/cell-oauth && bun test src/oauth-server.test.ts`
Expected: all PASS

**Step 5: Update index.ts with final exports**

```typescript
export type {
  DelegatePermission,
  UserAuth,
  DelegateAuth,
  Auth,
  DelegateGrant,
  DelegateGrantStore,
  OAuthMetadata,
  RegisteredClient,
  CallbackResult,
  ConsentInfo,
  TokenResponse,
} from "./types.ts";

export {
  sha256Hex,
  generateDelegateId,
  generateRandomToken,
  createDelegateAccessToken,
  decodeDelegateTokenPayload,
  verifyCodeChallenge,
} from "./token.ts";

export { createDynamoGrantStore } from "./dynamo-grant-store.ts";

export {
  createOAuthServer,
  type OAuthServer,
  type OAuthServerConfig,
} from "./oauth-server.ts";
```

**Step 6: Run all cell-oauth tests**

Run: `cd packages/cell-oauth && bun test src/`
Expected: all PASS

**Step 7: Commit**

```bash
git add packages/cell-oauth/src/
git commit -m "feat(cell-oauth): implement OAuth server orchestrator with delegate management"
```

---

### Task 10: Create `@casfa/cell-auth-client` package

**Files:**
- Create: `packages/cell-auth-client/package.json`
- Create: `packages/cell-auth-client/tsconfig.json`
- Create: `packages/cell-auth-client/src/index.ts`
- Create: `packages/cell-auth-client/src/types.ts`
- Create: `packages/cell-auth-client/src/auth-client.ts`
- Create: `packages/cell-auth-client/src/api-fetch.ts`

**Step 1: Create package.json**

```json
{
  "name": "@casfa/cell-auth-client",
  "version": "0.1.0",
  "description": "Frontend auth utilities for cell apps: token storage, apiFetch, login/logout",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "bun": "./src/index.ts",
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "bun ../../scripts/build-pkg.ts",
    "test": "bun run test:unit",
    "test:unit": "bun test src/",
    "typecheck": "tsc --noEmit",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "check": "tsc --noEmit && biome check .",
    "prepublishOnly": "bun run build"
  },
  "buildConfig": {
    "bunFlags": ["--target=browser"]
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.3.0"
  },
  "files": ["dist", "README.md"],
  "publishConfig": { "access": "public" },
  "license": "MIT"
}
```

Note: `buildConfig.bunFlags` includes `--target=browser` since this runs in the browser.

**Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": { "noEmit": true },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Create src/types.ts**

```typescript
export type ClientAuth = {
  token: string;
  userId: string;
  email: string;
  refreshToken: string | null;
};

export type AuthSubscriber = (auth: ClientAuth | null) => void;

export type AuthClient = {
  getAuth(): ClientAuth | null;
  setTokens(token: string, refreshToken: string | null): void;
  logout(): void;
  subscribe(fn: AuthSubscriber): () => void;
};
```

**Step 4: Create src/auth-client.ts**

```typescript
import type { AuthClient, AuthSubscriber, ClientAuth } from "./types.ts";

export function createAuthClient(params: { storagePrefix: string }): AuthClient {
  const tokenKey = `${params.storagePrefix}_token`;
  const refreshKey = `${params.storagePrefix}_refresh`;

  let currentAuth: ClientAuth | null = null;
  const listeners = new Set<AuthSubscriber>();

  function notify() {
    const auth = currentAuth;
    for (const fn of listeners) fn(auth);
  }

  function parseTokenPayload(token: string): { userId: string; email: string } | null {
    try {
      const parts = token.split(".");
      if (parts.length < 2) return null;
      const payload = JSON.parse(atob(parts[1]));
      if (typeof payload.sub !== "string" || typeof payload.email !== "string") return null;
      return { userId: payload.sub, email: payload.email };
    } catch {
      return null;
    }
  }

  return {
    getAuth() {
      if (currentAuth) return currentAuth;
      const stored = localStorage.getItem(tokenKey);
      if (!stored) return null;
      const parsed = parseTokenPayload(stored);
      if (!parsed) {
        localStorage.removeItem(tokenKey);
        return null;
      }
      const refreshToken = localStorage.getItem(refreshKey);
      currentAuth = {
        token: stored,
        userId: parsed.userId,
        email: parsed.email,
        refreshToken,
      };
      return currentAuth;
    },

    setTokens(token, refreshToken) {
      localStorage.setItem(tokenKey, token);
      if (refreshToken) {
        localStorage.setItem(refreshKey, refreshToken);
      } else {
        localStorage.removeItem(refreshKey);
      }
      currentAuth = null;
      this.getAuth();
      notify();
    },

    logout() {
      localStorage.removeItem(tokenKey);
      localStorage.removeItem(refreshKey);
      currentAuth = null;
      notify();
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
```

**Step 5: Create src/api-fetch.ts**

```typescript
import type { AuthClient } from "./types.ts";

export function createApiFetch(params: {
  authClient: AuthClient;
  baseUrl: string;
  onUnauthorized: () => void;
}): (path: string, init: RequestInit | null) => Promise<Response> {
  const { authClient, baseUrl, onUnauthorized } = params;

  return async (path, init) => {
    const auth = authClient.getAuth();
    const headers = new Headers(init?.headers);
    if (auth) headers.set("Authorization", `Bearer ${auth.token}`);
    if (!headers.has("Content-Type") && init?.body) {
      headers.set("Content-Type", "application/json");
    }

    const res = await fetch(`${baseUrl}${path}`, { ...init, headers });
    if (res.status === 401) {
      onUnauthorized();
    }
    return res;
  };
}
```

**Step 6: Create src/index.ts**

```typescript
export type { ClientAuth, AuthSubscriber, AuthClient } from "./types.ts";
export { createAuthClient } from "./auth-client.ts";
export { createApiFetch } from "./api-fetch.ts";
```

**Step 7: Typecheck**

Run: `cd packages/cell-auth-client && bunx tsc --noEmit`
Expected: no errors

**Step 8: Commit**

```bash
git add packages/cell-auth-client/
git commit -m "feat: add @casfa/cell-auth-client package with token storage and apiFetch"
```

---

### Task 11: Update root configuration

**Files:**
- Modify: `tsconfig.json` (root — add paths for new packages)
- Modify: `package.json` (root — add to build:packages)

**Step 1: Add paths to root tsconfig.json**

Add these entries to `compilerOptions.paths`:

```json
"@casfa/cell-cognito": ["./packages/cell-cognito/src/index.ts"],
"@casfa/cell-oauth": ["./packages/cell-oauth/src/index.ts"],
"@casfa/cell-auth-client": ["./packages/cell-auth-client/src/index.ts"]
```

**Step 2: Update build:packages in root package.json**

Insert the three new packages into the build chain. `cell-cognito` has no internal deps so can go near the end. `cell-oauth` depends on `cell-cognito` so must come after it. `cell-auth-client` has no deps so order doesn't matter.

Add after `cd ../oauth-provider && bun run build`:

```
&& cd ../cell-cognito && bun run build && cd ../cell-oauth && bun run build && cd ../cell-auth-client && bun run build
```

**Step 3: Install dependencies**

Run: `cd /path/to/casfa && bun install --no-cache`
Expected: successful install

**Step 4: Build new packages**

Run: `cd packages/cell-cognito && bun run build && cd ../cell-oauth && bun run build && cd ../cell-auth-client && bun run build`
Expected: successful build with no errors

**Step 5: Commit**

```bash
git add tsconfig.json package.json bun.lock
git commit -m "chore: register cell-auth packages in workspace config and build chain"
```

---

### Task 12: Migrate image-workshop backend to use new packages

**Files:**
- Modify: `apps/image-workshop/package.json` (add deps on new packages)
- Delete: `apps/image-workshop/backend/utils/cognito.ts`
- Delete: `apps/image-workshop/backend/utils/jwt.ts`
- Delete: `apps/image-workshop/backend/utils/token.ts`
- Delete: `apps/image-workshop/backend/types/auth.ts`
- Delete: `apps/image-workshop/backend/db/grant-store.ts`
- Rewrite: `apps/image-workshop/backend/app.ts`
- Rewrite: `apps/image-workshop/backend/middleware/auth.ts`
- Rewrite: `apps/image-workshop/backend/controllers/oauth.ts`
- Rewrite: `apps/image-workshop/backend/controllers/delegates.ts`

**Step 1: Add dependencies to image-workshop package.json**

Add to `dependencies`:

```json
"@casfa/cell-cognito": "workspace:*",
"@casfa/cell-oauth": "workspace:*"
```

Run: `cd apps/image-workshop && bun install --no-cache`

**Step 2: Delete old files**

```bash
rm apps/image-workshop/backend/utils/cognito.ts
rm apps/image-workshop/backend/utils/jwt.ts
rm apps/image-workshop/backend/utils/token.ts
rm apps/image-workshop/backend/types/auth.ts
rm apps/image-workshop/backend/db/grant-store.ts
```

**Step 3: Rewrite backend/app.ts**

```typescript
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { Hono } from "hono";
import {
  type CognitoConfig,
  createCognitoJwtVerifier,
  createMockJwtVerifier,
} from "@casfa/cell-cognito";
import { createOAuthServer, createDynamoGrantStore } from "@casfa/cell-oauth";
import { createOAuthRoutes } from "./controllers/oauth";
import { createDelegatesRoutes } from "./controllers/delegates";
import { createMcpRoutes } from "./controllers/mcp";

const cognitoConfig: CognitoConfig = {
  region: process.env.COGNITO_REGION ?? "us-east-1",
  userPoolId: process.env.COGNITO_USER_POOL_ID ?? "",
  clientId: process.env.COGNITO_CLIENT_ID ?? "",
  hostedUiUrl: process.env.COGNITO_HOSTED_UI_URL ?? "",
};

const dynamoClient = new DynamoDBClient(
  process.env.DYNAMODB_ENDPOINT
    ? { endpoint: process.env.DYNAMODB_ENDPOINT, region: "us-east-1" }
    : {},
);
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const grantStore = createDynamoGrantStore({
  tableName: process.env.DYNAMODB_TABLE_GRANTS ?? "image-workshop-grants",
  client: docClient,
});

const jwtVerifier = process.env.E2E_MOCK_JWT_SECRET
  ? createMockJwtVerifier(process.env.E2E_MOCK_JWT_SECRET)
  : createCognitoJwtVerifier(cognitoConfig);

const oauthServer = createOAuthServer({
  issuerUrl: process.env.APP_ORIGIN ?? "",
  cognitoConfig,
  jwtVerifier,
  grantStore,
  permissions: ["use_mcp", "manage_delegates"],
});

const app = new Hono();

const oauthRoutes = createOAuthRoutes({ oauthServer });
app.route("/", oauthRoutes);

app.use("*", async (c, next) => {
  const header = c.req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  c.set("auth", token ? await oauthServer.resolveAuth(token) : null);
  await next();
});

const delegateRoutes = createDelegatesRoutes({ oauthServer });
app.route("/", delegateRoutes);

const mcpRoutes = createMcpRoutes();
app.route("/", mcpRoutes);

export type App = typeof app;
export { app };
```

**Step 4: Rewrite backend/middleware/auth.ts**

This file is no longer needed for the middleware itself (it's now 3 lines in app.ts), but we need to keep the Hono type augmentation so that `c.get("auth")` works:

```typescript
import type { Auth } from "@casfa/cell-oauth";

declare module "hono" {
  interface ContextVariableMap {
    auth: Auth | null;
  }
}
```

**Step 5: Rewrite backend/controllers/oauth.ts**

```typescript
import { Hono } from "hono";
import type { OAuthServer } from "@casfa/cell-oauth";

type OAuthControllerDeps = {
  oauthServer: OAuthServer;
};

export function createOAuthRoutes(deps: OAuthControllerDeps) {
  const routes = new Hono();
  const { oauthServer } = deps;

  routes.get("/.well-known/oauth-authorization-server", (c) => {
    return c.json(oauthServer.getMetadata());
  });

  routes.post("/oauth/register", async (c) => {
    const body = await c.req.json<{ client_name?: string; redirect_uris?: string[] }>();
    const client = oauthServer.registerClient({
      clientName: body.client_name ?? "MCP Client",
      redirectUris: body.redirect_uris ?? [],
    });
    return c.json(
      { client_id: client.clientId, client_name: client.clientName, redirect_uris: client.redirectUris },
      201,
    );
  });

  routes.get("/oauth/authorize", (c) => {
    const result = oauthServer.handleAuthorize({
      responseType: c.req.query("response_type") ?? "code",
      clientId: c.req.query("client_id") ?? "",
      redirectUri: c.req.query("redirect_uri") ?? "",
      state: c.req.query("state") ?? "",
      scope: c.req.query("scope") ?? null,
      codeChallenge: c.req.query("code_challenge") ?? null,
      codeChallengeMethod: c.req.query("code_challenge_method") ?? null,
      identityProvider: c.req.query("identity_provider") ?? null,
    });
    return c.redirect(result.redirectUrl);
  });

  routes.get("/oauth/callback", async (c) => {
    const code = c.req.query("code");
    if (!code) return c.text("Missing authorization code", 400);

    try {
      const result = await oauthServer.handleCallback({
        code,
        state: c.req.query("state") ?? "",
      });
      return c.redirect(result.redirectUrl);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return c.text(`Token exchange failed: ${msg}`, 400);
    }
  });

  routes.get("/oauth/consent-info", (c) => {
    const session = c.req.query("session") ?? "";
    const info = oauthServer.getConsentInfo(session);
    if (!info) return c.json({ error: "expired_or_invalid_session" }, 400);
    return c.json(info);
  });

  routes.post("/oauth/approve", async (c) => {
    const body = await c.req.json<{ session: string; clientName: string }>();
    try {
      const result = await oauthServer.approveConsent({
        sessionId: body.session,
        clientName: body.clientName,
      });
      return c.json({ redirect: result.redirectUrl });
    } catch {
      return c.json({ error: "expired_or_invalid_session" }, 400);
    }
  });

  routes.post("/oauth/deny", (c) => {
    const session = c.req.query("session") ?? "";
    oauthServer.denyConsent(session);
    return c.json({ ok: true });
  });

  routes.post("/oauth/token", async (c) => {
    const body = await c.req.parseBody();
    try {
      const result = await oauthServer.handleToken({
        grantType: body.grant_type as string,
        code: (body.code as string) ?? null,
        codeVerifier: (body.code_verifier as string) ?? null,
        refreshToken: (body.refresh_token as string) ?? null,
        clientId: (body.client_id as string) ?? null,
      });
      return c.json(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown error";
      if (msg.includes("unsupported_grant_type")) return c.json({ error: msg }, 400);
      if (msg.includes("invalid_grant")) return c.json({ error: "invalid_grant", message: msg }, 400);
      if (msg.includes("invalid_request")) return c.json({ error: "invalid_request", message: msg }, 400);
      return c.json({ error: msg }, 400);
    }
  });

  return routes;
}
```

**Step 6: Rewrite backend/controllers/delegates.ts**

```typescript
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Auth, OAuthServer } from "@casfa/cell-oauth";

type DelegatesControllerDeps = {
  oauthServer: OAuthServer;
};

function requireManageDelegates(auth: Auth | null): Auth {
  if (!auth) throw new HTTPException(401, { message: "Unauthorized" });
  if (auth.type === "user") return auth;
  if (auth.permissions.includes("manage_delegates")) return auth;
  throw new HTTPException(403, { message: "Forbidden: manage_delegates required" });
}

export function createDelegatesRoutes(deps: DelegatesControllerDeps) {
  const routes = new Hono();
  const { oauthServer } = deps;

  routes.get("/api/delegates", async (c) => {
    const auth = requireManageDelegates(c.get("auth"));
    const grants = await oauthServer.listDelegates(auth.userId);
    return c.json(
      grants.map((g) => ({
        delegateId: g.delegateId,
        clientName: g.clientName,
        permissions: g.permissions,
        createdAt: g.createdAt,
        expiresAt: g.expiresAt,
      })),
    );
  });

  routes.post("/api/delegates", async (c) => {
    const auth = requireManageDelegates(c.get("auth"));
    const body = await c.req.json<{
      clientName: string;
      permissions?: string[];
    }>();

    const result = await oauthServer.createDelegate({
      userId: auth.userId,
      clientName: body.clientName,
      permissions: (body.permissions ?? ["use_mcp"]) as ("use_mcp" | "manage_delegates")[],
    });

    return c.json({
      delegateId: result.grant.delegateId,
      clientName: result.grant.clientName,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      permissions: result.grant.permissions,
      expiresAt: result.grant.expiresAt,
    });
  });

  routes.post("/api/delegates/:id/revoke", async (c) => {
    const auth = requireManageDelegates(c.get("auth"));
    const delegateId = c.req.param("id");
    const grants = await oauthServer.listDelegates(auth.userId);
    const grant = grants.find((g) => g.delegateId === delegateId);
    if (!grant) return c.json({ error: "not_found" }, 404);
    await oauthServer.revokeDelegate(delegateId);
    return c.json({ ok: true });
  });

  return routes;
}
```

**Step 7: Typecheck the entire image-workshop**

Run: `cd apps/image-workshop && bunx tsc --noEmit`
Expected: no errors (may need to fix minor import issues)

**Step 8: Commit**

```bash
git add -A apps/image-workshop/
git commit -m "refactor(image-workshop): migrate backend auth to @casfa/cell-cognito and @casfa/cell-oauth"
```

---

### Task 13: Migrate image-workshop frontend to use `@casfa/cell-auth-client`

**Files:**
- Modify: `apps/image-workshop/package.json` (add cell-auth-client dep)
- Delete: `apps/image-workshop/frontend/lib/auth.ts`
- Delete: `apps/image-workshop/frontend/lib/api.ts`
- Modify: `apps/image-workshop/frontend/main.tsx` (update imports)

**Step 1: Add dependency**

Add `"@casfa/cell-auth-client": "workspace:*"` to `apps/image-workshop/package.json` dependencies.

Run: `cd apps/image-workshop && bun install --no-cache`

**Step 2: Delete old frontend auth files**

```bash
rm apps/image-workshop/frontend/lib/auth.ts
rm apps/image-workshop/frontend/lib/api.ts
```

**Step 3: Update frontend/main.tsx imports**

Replace all imports from `./lib/auth` and `./lib/api` with imports from `@casfa/cell-auth-client`.

The old code uses:
- `getAuth()` → `authClient.getAuth()`
- `setTokens(token, refreshToken)` → `authClient.setTokens(token, refreshToken)`
- `logout()` → `authClient.logout()`
- `subscribe(fn)` → `authClient.subscribe(fn)`
- `getRefreshToken()` → `authClient.getAuth()?.refreshToken`
- `apiFetch(path, init)` → `apiFetch(path, init)`

Add at the top of main.tsx:

```typescript
import { createAuthClient, createApiFetch } from "@casfa/cell-auth-client";

const authClient = createAuthClient({ storagePrefix: "iw" });
const apiFetch = createApiFetch({
  authClient,
  baseUrl: "",
  onUnauthorized: () => authClient.logout(),
});
```

Then update all call sites:
- `getAuth()` → `authClient.getAuth()`
- `setTokens(...)` → `authClient.setTokens(...)`
- `logout()` → `authClient.logout()`
- `subscribe(...)` → `authClient.subscribe(...)`
- `getRefreshToken()` → `authClient.getAuth()?.refreshToken ?? null`
- `apiFetch(path, init)` → `apiFetch(path, init)`

Note: The `AuthSubscriber` type changed from `() => void` to `(auth: ClientAuth | null) => void`. Update any subscribe callbacks to accept the auth parameter (they can ignore it if they just re-read via `getAuth()`).

**Step 4: Typecheck**

Run: `cd apps/image-workshop && bunx tsc --noEmit`
Expected: no errors

**Step 5: Commit**

```bash
git add -A apps/image-workshop/
git commit -m "refactor(image-workshop): migrate frontend auth to @casfa/cell-auth-client"
```

---

### Task 14: Final verification

**Step 1: Run all package tests**

```bash
cd packages/cell-cognito && bun test src/
cd ../cell-oauth && bun test src/
```

Expected: all PASS

**Step 2: Build all packages**

```bash
cd /path/to/casfa && bun run build:packages
```

Expected: successful build

**Step 3: Typecheck image-workshop**

```bash
cd apps/image-workshop && bunx tsc --noEmit
```

Expected: no errors

**Step 4: Start image-workshop dev server**

```bash
cd apps/image-workshop && bun run dev
```

Expected: server starts without errors

**Step 5: Commit any remaining fixes**

```bash
git add -A
git commit -m "fix: resolve any remaining issues from cell-auth migration"
```
