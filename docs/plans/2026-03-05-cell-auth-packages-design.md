# Cell Auth Packages Design

Extract Cognito auth, OAuth authorization server, and delegate management from image-workshop into three reusable packages for other cell apps.

## Context

image-workshop implements a full auth system inline:
- Cognito JWT verification, token exchange, token refresh
- OAuth 2.0 authorization server (metadata, client registration, authorize, callback, PKCE, token)
- Delegate management (create/revoke/list, consent flow, DynamoDB grant store)
- Auth middleware (JWT + delegate dual-mode)
- Frontend auth utilities (token storage, apiFetch, login/logout)

The monorepo already has `@casfa/oauth-consumer` and `@casfa/oauth-provider`, but those serve the `server` app's CASFA-native delegate chain. The cell ecosystem needs its own independent auth packages.

## Package Structure

```
packages/
  cell-cognito/         # @casfa/cell-cognito
  cell-oauth/           # @casfa/cell-oauth
  cell-auth-client/     # @casfa/cell-auth-client
```

### Dependency Graph

```
cell-oauth → cell-cognito
cell-auth-client → (no internal deps)
```

## Package 1: `@casfa/cell-cognito`

Framework-agnostic Cognito/IdP integration.

**Dependency**: `jose`

### Types

```typescript
type CognitoConfig = {
  region: string;
  userPoolId: string;
  clientId: string;
  hostedUiUrl: string;
};

type CognitoTokenSet = {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp (seconds)
};

type CognitoRefreshedTokenSet = {
  idToken: string;
  accessToken: string;
  expiresAt: number;
};

type VerifiedUser = {
  userId: string;
  email: string;
  name: string;
  rawClaims: Record<string, unknown>;
};

type JwtVerifier = (token: string) => Promise<VerifiedUser>;
```

`CognitoTokenSet` is returned by `exchangeCodeForTokens` (authorization_code grant always includes refresh_token). `CognitoRefreshedTokenSet` is returned by `refreshCognitoTokens` (refresh_token grant does not issue a new refresh_token).

### Functions

```typescript
// JWT verification
function createCognitoJwtVerifier(config: CognitoConfig): JwtVerifier;
function createMockJwtVerifier(secret: string): JwtVerifier;
function createMockJwt(secret: string, payload: Record<string, unknown>): Promise<string>;

// Cognito token exchange
function exchangeCodeForTokens(
  config: CognitoConfig,
  code: string,
  redirectUri: string
): Promise<CognitoTokenSet>;

function refreshCognitoTokens(
  config: CognitoConfig,
  refreshToken: string
): Promise<CognitoRefreshedTokenSet>;

// Authorization URL
function buildCognitoAuthorizeUrl(
  config: CognitoConfig,
  params: {
    redirectUri: string;
    state: string;
    scope: string | null;
    identityProvider: string | null;
  }
): string;
```

### Source Mapping

| image-workshop file | → cell-cognito |
|---|---|
| `backend/utils/jwt.ts` | `createCognitoJwtVerifier`, `createMockJwtVerifier` |
| `backend/utils/cognito.ts` | `exchangeCodeForTokens`, `refreshCognitoTokens` |
| `backend/controllers/oauth.ts` (authorize URL logic) | `buildCognitoAuthorizeUrl` |

## Package 2: `@casfa/cell-oauth`

Framework-agnostic OAuth 2.0 authorization server + delegate management. Uses a declarative orchestrator pattern: `createOAuthServer(config)` returns a set of handler functions. Cell apps wire these into their own Hono routes.

**Dependencies**: `@casfa/cell-cognito`, `@aws-sdk/lib-dynamodb`, `@aws-sdk/client-dynamodb`

### Types

```typescript
type DelegatePermission = "use_mcp" | "manage_delegates" | (string & {});

type UserAuth = {
  type: "user";
  userId: string;
};

type DelegateAuth = {
  type: "delegate";
  userId: string;
  delegateId: string;
  permissions: DelegatePermission[];
};

type Auth = UserAuth | DelegateAuth;

type DelegateGrant = {
  delegateId: string;
  userId: string;
  clientName: string;
  permissions: DelegatePermission[];
  accessTokenHash: string;
  refreshTokenHash: string | null;
  createdAt: number;
  expiresAt: number;
};

type DelegateGrantStore = {
  list(userId: string): Promise<DelegateGrant[]>;
  get(delegateId: string): Promise<DelegateGrant | null>;
  getByAccessTokenHash(userId: string, hash: string): Promise<DelegateGrant | null>;
  getByRefreshTokenHash(userId: string, hash: string): Promise<DelegateGrant | null>;
  insert(grant: DelegateGrant): Promise<void>;
  remove(delegateId: string): Promise<void>;
  updateTokens(
    delegateId: string,
    update: { accessTokenHash: string; refreshTokenHash: string | null }
  ): Promise<void>;
};
```

### OAuth Server Orchestrator

```typescript
type OAuthServerConfig = {
  issuerUrl: string;
  cognitoConfig: CognitoConfig;
  jwtVerifier: JwtVerifier;
  grantStore: DelegateGrantStore;
  permissions: DelegatePermission[];
};

type OAuthServer = {
  // OAuth 2.0 endpoints
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
  approveConsent(params: { sessionId: string; clientName: string }): Promise<{ redirectUrl: string }>;
  denyConsent(sessionId: string): { redirectUrl: string };
  handleToken(params: {
    grantType: string;
    code: string | null;
    codeVerifier: string | null;
    refreshToken: string | null;
    clientId: string | null;
  }): Promise<TokenResponse>;

  // Auth resolution
  resolveAuth(bearerToken: string): Promise<Auth | null>;

  // Delegate CRUD
  listDelegates(userId: string): Promise<DelegateGrant[]>;
  createDelegate(params: {
    userId: string;
    clientName: string;
    permissions: DelegatePermission[];
  }): Promise<{ grant: DelegateGrant; accessToken: string; refreshToken: string }>;
  revokeDelegate(delegateId: string): Promise<void>;
};

function createOAuthServer(config: OAuthServerConfig): OAuthServer;
```

The orchestrator manages ephemeral state internally (pending codes, pending consents, registered clients) using in-memory Maps with TTL cleanup.

### DynamoDB Grant Store

```typescript
function createDynamoGrantStore(params: {
  tableName: string;
  client: DynamoDBDocumentClient;
}): DelegateGrantStore;
```

DynamoDB schema:
- PK: `GRANT#{delegateId}`, SK: `METADATA`
- GSI `user-hash-index`: `gsi1pk = USER#{userId}`, `gsi1sk = HASH#{accessTokenHash}`
- GSI `user-refresh-index`: `gsi2pk = USER#{userId}`, `gsi2sk = REFRESH#{refreshTokenHash}`

### Token Utilities (also exported)

```typescript
function sha256Hex(input: string): string;
function generateDelegateId(): string;
function createDelegateAccessToken(params: { userId: string; delegateId: string }): string;
function decodeDelegateTokenPayload(token: string): { sub: string; dlg: string; iat: number } | null;
```

### Source Mapping

| image-workshop file | → cell-oauth |
|---|---|
| `backend/controllers/oauth.ts` | `createOAuthServer` (orchestrator internals) |
| `backend/controllers/delegates.ts` | `listDelegates`, `createDelegate`, `revokeDelegate` |
| `backend/middleware/auth.ts` | `resolveAuth` |
| `backend/utils/token.ts` | Token utilities |
| `backend/types/auth.ts` | All auth types |
| `backend/db/grant-store.ts` | `createDynamoGrantStore` |

## Package 3: `@casfa/cell-auth-client`

Frontend auth utilities.

**Dependencies**: none

### Types & Functions

```typescript
type ClientAuth = {
  token: string;
  userId: string;
  email: string;
  refreshToken: string | null;
};

type AuthSubscriber = (auth: ClientAuth | null) => void;

type AuthClient = {
  getAuth(): ClientAuth | null;
  setTokens(token: string, refreshToken: string | null): void;
  logout(): void;
  subscribe(fn: AuthSubscriber): () => void;
};

function createAuthClient(params: { storagePrefix: string }): AuthClient;

function createApiFetch(params: {
  authClient: AuthClient;
  baseUrl: string;
  onUnauthorized: () => void;
}): (path: string, init: RequestInit | null) => Promise<Response>;
```

`storagePrefix` avoids localStorage key collisions between cells (e.g. `"iw"` → keys `iw_token`, `iw_refresh`).

### Source Mapping

| image-workshop file | → cell-auth-client |
|---|---|
| `frontend/lib/auth.ts` | `createAuthClient` |
| `frontend/lib/api.ts` | `createApiFetch` |

## Migration: image-workshop

After extracting, image-workshop's auth code reduces to thin Hono route wiring:

**Files removed** (replaced by packages):
- `backend/utils/cognito.ts`
- `backend/utils/jwt.ts`
- `backend/utils/token.ts`
- `backend/types/auth.ts`
- `backend/db/grant-store.ts`
- `frontend/lib/auth.ts`
- `frontend/lib/api.ts`

**Files simplified** (to route glue):
- `backend/controllers/oauth.ts` → ~30 lines of Hono routes calling `oauthServer.*`
- `backend/controllers/delegates.ts` → ~20 lines of Hono routes
- `backend/middleware/auth.ts` → ~3 lines calling `oauthServer.resolveAuth`
- `backend/app.ts` → assembly of config, jwtVerifier, grantStore, oauthServer

## Design Decisions

1. **Independent from `@casfa/oauth-consumer` / `@casfa/oauth-provider`**: Cell apps are a different ecosystem from the server app. Keeping them separate avoids coupling to CASFA-native delegate chains.

2. **Declarative orchestrator over atomic functions**: `createOAuthServer` provides a complete OAuth server as a single unit. This minimizes boilerplate in cell apps (~50 lines of route wiring). If future cells need more flexibility, the orchestrator can expose lower-level hooks.

3. **Framework-agnostic**: All packages export pure functions. Cell apps write their own Hono routes (or any other framework) calling these functions.

4. **DynamoDB grant store included**: All cell apps deploy to AWS, so a DynamoDB implementation is provided alongside the `DelegateGrantStore` interface.

5. **No optional properties**: Nullable unions (`string | null`) instead of optional (`string?`). Separate types for distinct shapes (`CognitoTokenSet` vs `CognitoRefreshedTokenSet`).
