# OAuth 公共包提取方案

> 最后更新: 2026-02-24

将 `apps/server` 中的双向 OAuth 逻辑提取为框架无关、存储无关的可复用包，方便在其他服务中对接。

## 现状

当前 `apps/server` 同时承担两个 OAuth 角色：

| 角色 | 路由 | 功能 | 关键代码 |
|------|------|------|----------|
| **Consumer** (OIDC 依赖方) | `/api/oauth/*` | 通过 Cognito 认证用户，获取 User JWT | `controllers/oauth.ts`, `auth/jwt-verifier.ts` |
| **Provider** (授权服务器) | `/api/auth/*` | 向第三方客户端 (MCP/CLI/IDE) 发放 Delegate Token | `controllers/oauth-auth.ts`, `services/delegate-*` |

两条路径通过 `access-token-auth.ts` 中间件统一为 `AccessTokenAuthContext`，下游无需关心认证模式。

### 问题

所有 OAuth 协议逻辑（PKCE、元数据、授权码、客户端注册等）直接写在 controller 里，与 Hono 框架、DynamoDB 存储、Delegate 业务模型紧耦合，无法在其他服务复用。

## 方案：拆为两个独立包

Consumer 和 Provider 是两个**完全正交**的关注点：

- 一个服务可能只做 Consumer（只需登录用户，不对外授权）
- 一个服务可能只做 Provider（自己不经过 OIDC，但需要对外发放 token）
- `apps/server` 同时使用两者

两者共享的类型极少（仅 `Result<T>` 和 `OAuthError`），不构成合并的理由。

```
@casfa/oauth-consumer   — OIDC 依赖方：JWT 验证、IdP 授权/换码/刷新
@casfa/oauth-provider   — OAuth 授权服务器：元数据、授权码、客户端注册、Token 端点
```

### 与现有包的关系

```
已有 (不动):
  @casfa/client-auth-crypto    ← PKCE + AES 加密 (100% 通用, 客户端侧)
  @casfa/delegate-token        ← 二进制 Token 编解码 (业务专用格式)
  @casfa/delegate              ← Delegate 实体校验 (业务专用)

新增:
  @casfa/oauth-consumer        ← 本方案
  @casfa/oauth-provider        ← 本方案

改造:
  apps/server                  ← 实现存储接口, 调用两个包替代内联逻辑
```

---

## 用法示例

以下用例展示两个包在实际项目中如何被消费。所有示例使用 Hono 框架，但包本身框架无关。

### 用例 1: 只做 Consumer — 一个新的内部服务只需用 Cognito 登录用户

```typescript
// my-service/src/auth.ts
import {
  createJwtVerifier,
  exchangeAuthorizationCode,
  refreshIdpToken,
  buildAuthorizationUrl,
  type IdpConfig,
  type VerifiedIdentity,
} from "@casfa/oauth-consumer";
import { generatePkceChallenge, generateState } from "@casfa/client-auth-crypto";

// ---- 1. 配置 IdP ----

const cognito: IdpConfig = {
  issuer: `https://cognito-idp.us-east-1.amazonaws.com/${POOL_ID}`,
  authorizationEndpoint: `${HOSTED_UI}/oauth2/authorize`,
  tokenEndpoint: `${HOSTED_UI}/oauth2/token`,
  jwksUri: `https://cognito-idp.us-east-1.amazonaws.com/${POOL_ID}/.well-known/jwks.json`,
  clientId: CLIENT_ID,
};

// ---- 2. 创建 JWT 验证器 ----

const verifyJwt = createJwtVerifier({
  jwksUri: cognito.jwksUri,
  issuer: cognito.issuer,
  // Cognito sub 是 UUID, 转成内部格式
  extractSubject: (claims) => `usr_${claims.sub}`,
});

// ---- 3. 在路由中使用 ----

// GET /login — 跳转到 Cognito 登录页
app.get("/login", async (c) => {
  const { verifier, challenge } = await generatePkceChallenge();
  const state = generateState();
  // 存 session (verifier + state)
  setCookie(c, "pkce", verifier);
  setCookie(c, "state", state);

  const url = buildAuthorizationUrl(cognito, {
    redirectUri: "https://my-service.com/callback",
    scope: "openid email profile",
    state,
    codeChallenge: challenge,
    extraParams: { identity_provider: "Google" },  // Cognito 特有
  });
  return c.redirect(url);
});

// GET /callback — Cognito 回调, 换取 token
app.get("/callback", async (c) => {
  const code = c.req.query("code")!;
  const verifier = getCookie(c, "pkce")!;

  const result = await exchangeAuthorizationCode(cognito, {
    code,
    redirectUri: "https://my-service.com/callback",
    codeVerifier: verifier,
  });
  if (!result.ok) return c.json(result.error, result.error.statusCode);

  // result.value = { accessToken, idToken, refreshToken, expiresIn }
  return c.json({ token: result.value.accessToken });
});

// POST /refresh — 刷新 token
app.post("/refresh", async (c) => {
  const { refreshToken } = await c.req.json();
  const result = await refreshIdpToken(cognito, refreshToken);
  if (!result.ok) return c.json(result.error, result.error.statusCode);
  return c.json({ token: result.value.accessToken });
});

// GET /api/me — JWT 鉴权保护的接口
app.get("/api/me", async (c) => {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  if (!token) return c.json({ error: "unauthorized" }, 401);

  const result = await verifyJwt(token);
  if (!result.ok) return c.json(result.error, result.error.statusCode);

  // result.value: VerifiedIdentity = { subject, email, name, rawClaims }
  const user = result.value;
  return c.json({ userId: user.subject, email: user.email });
});
```

### 用例 2: 只做 Provider — 一个 API 服务对外发放 OAuth token

```typescript
// api-gateway/src/oauth-server.ts
import {
  generateAuthServerMetadata,
  generateProtectedResourceMetadata,
  validateAuthorizationRequest,
  createAuthorizationCode,
  handleTokenRequest,
  registerClient,
  resolveClient,
  validateScopes,
  mapScopes,
  isRedirectUriAllowed,
  createDualAuthHandler,
  type AuthCodeStore,
  type ClientStore,
  type TokenIssuer,
  type OAuthClient,
  type TokenResponse,
  type AuthServerConfig,
} from "@casfa/oauth-provider";

// ---- 1. 定义业务权限类型 ----

type MyPermissions = {
  canRead: boolean;
  canWrite: boolean;
  canAdmin: boolean;
};

// ---- 2. 定义 scope 到权限的映射 ----

const SCOPE_MAPPING: Record<string, Partial<MyPermissions>> = {
  "api:write": { canWrite: true },
  "api:admin": { canAdmin: true },
};
const DEFAULT_PERMS: MyPermissions = { canRead: true, canWrite: false, canAdmin: false };

// ---- 3. 配置授权服务器 ----

const authConfig: AuthServerConfig = {
  issuer: "https://api.example.com",
  authorizationEndpoint: "https://api.example.com/oauth/authorize",
  tokenEndpoint: "https://api.example.com/oauth/token",
  registrationEndpoint: "https://api.example.com/oauth/register",
  supportedScopes: [
    { name: "api:read", description: "Read API data", default: true },
    { name: "api:write", description: "Write API data" },
    { name: "api:admin", description: "Admin operations" },
  ],
  supportedGrantTypes: ["authorization_code", "refresh_token"],
  supportedResponseTypes: ["code"],
  codeChallengeMethodsSupported: ["S256"],
};

// ---- 4. 实现存储适配器 (用 Postgres/Redis/内存/...) ----

const authCodeStore: AuthCodeStore<MyPermissions> = {
  save: async (code) => { await db.query("INSERT INTO auth_codes ..."); },
  consume: async (code) => {
    // 原子操作: UPDATE auth_codes SET used=true WHERE code=$1 AND used=false RETURNING *
    const row = await db.query("UPDATE auth_codes SET used=true WHERE code=$1 AND used=false RETURNING *", [code]);
    return row ?? null;
  },
};

const clientStore: ClientStore = {
  get: async (id) => await db.query("SELECT * FROM oauth_clients WHERE client_id=$1", [id]),
  save: async (client) => { await db.query("INSERT INTO oauth_clients ..."); },
};

// ---- 5. 实现 TokenIssuer (业务决定 token 长什么样) ----

const tokenIssuer: TokenIssuer<MyPermissions> = {
  issueFromAuthCode: async ({ subject, clientId, scopes, grantedPermissions }) => {
    // 你自己决定 token 怎么生成 — JWT / 随机 opaque / 二进制, 都行
    const accessToken = generateJwt({ sub: subject, scopes, perms: grantedPermissions, exp: "1h" });
    const refreshToken = generateRandomToken();
    await db.saveToken(refreshToken, { subject, clientId, scopes, perms: grantedPermissions });
    return {
      ok: true,
      value: {
        access_token: accessToken,
        token_type: "Bearer" as const,
        expires_in: 3600,
        refresh_token: refreshToken,
        scope: scopes.join(" "),
      },
    };
  },
  issueFromRefresh: async ({ refreshToken }) => {
    const stored = await db.getStoredToken(refreshToken);
    if (!stored) return { ok: false, error: { code: "invalid_grant", message: "Unknown refresh token", statusCode: 401 } };
    const newAccessToken = generateJwt({ sub: stored.subject, scopes: stored.scopes, perms: stored.perms, exp: "1h" });
    return {
      ok: true,
      value: { access_token: newAccessToken, token_type: "Bearer" as const, expires_in: 3600, scope: stored.scopes.join(" ") },
    };
  },
};

// ---- 6. 预注册的静态客户端 ----

const HARDCODED: Map<string, OAuthClient> = new Map([
  ["my-cli", {
    clientId: "my-cli",
    clientName: "My CLI Tool",
    redirectUris: ["http://127.0.0.1:*"],
    grantTypes: ["authorization_code", "refresh_token"],
    tokenEndpointAuthMethod: "none",
    createdAt: Date.now(),
  }],
]);

// ---- 7. 挂载路由 ----

// 元数据 (自动发现)
app.get("/.well-known/oauth-authorization-server", (c) => {
  return c.json(generateAuthServerMetadata(authConfig));
});
app.get("/.well-known/oauth-protected-resource", (c) => {
  return c.json(generateProtectedResourceMetadata({
    resource: "https://api.example.com",
    authorizationServers: [authConfig.issuer],
  }));
});

// 动态客户端注册
app.post("/oauth/register", async (c) => {
  const body = await c.req.json();
  const result = await registerClient(body, clientStore);
  if (!result.ok) return c.json(result.error, result.error.statusCode);
  return c.json(result.value, 201);
});

// 授权请求校验 (前端 consent 页调用)
app.get("/oauth/authorize/info", async (c) => {
  const params = {
    responseType: c.req.query("response_type") ?? "",
    clientId: c.req.query("client_id") ?? "",
    redirectUri: c.req.query("redirect_uri") ?? "",
    state: c.req.query("state"),
    scope: c.req.query("scope"),
    codeChallenge: c.req.query("code_challenge") ?? "",
    codeChallengeMethod: c.req.query("code_challenge_method") ?? "",
  };
  const result = await validateAuthorizationRequest(params, {
    resolveClient: (id) => resolveClient(id, clientStore, HARDCODED),
    supportedScopes: authConfig.supportedScopes.map((s) => s.name),
  });
  if (!result.ok) return c.json(result.error, result.error.statusCode);
  return c.json(result.value);
});

// 用户批准授权 (需已登录)
app.post("/oauth/authorize", authMiddleware, async (c) => {
  const user = c.get("user");  // 已登录用户
  const body = await c.req.json();
  const permissions = mapScopes<MyPermissions>(body.scopes, SCOPE_MAPPING, DEFAULT_PERMS);

  const authCode = createAuthorizationCode<MyPermissions>({
    clientId: body.clientId,
    redirectUri: body.redirectUri,
    subject: user.id,
    scopes: body.scopes,
    codeChallenge: body.codeChallenge,
    grantedPermissions: permissions,
  });
  await authCodeStore.save(authCode);

  const redirectUrl = `${body.redirectUri}?code=${authCode.code}&state=${body.state}`;
  return c.json({ redirect_uri: redirectUrl });
});

// Token 端点
app.post("/oauth/token", async (c) => {
  const body = await c.req.parseBody();
  const result = await handleTokenRequest<MyPermissions>(
    {
      grantType: body.grant_type as string,
      code: body.code as string | undefined,
      codeVerifier: body.code_verifier as string | undefined,
      redirectUri: body.redirect_uri as string | undefined,
      clientId: body.client_id as string | undefined,
      refreshToken: body.refresh_token as string | undefined,
    },
    { authCodeStore, tokenIssuer, supportedGrantTypes: ["authorization_code", "refresh_token"] },
  );
  if (!result.ok) return c.json(result.error, result.error.statusCode);
  return c.json(result.value);
});
```

### 用例 3: Consumer + Provider — 现有 `apps/server` 改造 (before / after)

#### Before (当前代码，以 JWT 验证为例)

```typescript
// apps/server/backend/src/auth/jwt-verifier.ts — 当前实现
// 126 行，Cognito 专用，JWKS URL 硬编码拼接, jose 直接调用

import * as jose from "jose";
export const createCognitoJwtVerifier = (config: CognitoConfig) => {
  const jwksUrl = `https://cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}/.well-known/jwks.json`;
  const JWKS = jose.createRemoteJWKSet(new URL(jwksUrl));
  const issuer = `https://cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}`;
  return async (token: string) => {
    try {
      const { payload } = await jose.jwtVerify(token, JWKS, { issuer });
      const sub = payload.sub;
      return { userId: uuidToUserId(sub), exp: payload.exp, email: payload.email, name: payload.name };
    } catch { return null; }
  };
};
```

#### After (改造后)

```typescript
// apps/server/backend/src/auth/jwt-verifier.ts — 改造后
// ~10 行，直接用 @casfa/oauth-consumer

import { createJwtVerifier } from "@casfa/oauth-consumer";
import { uuidToUserId } from "../util/id.ts";

export const createCognitoJwtVerifier = (config: CognitoConfig) =>
  createJwtVerifier({
    jwksUri: `https://cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}/.well-known/jwks.json`,
    issuer: `https://cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}`,
    extractSubject: (claims) => uuidToUserId(claims.sub as string),
  });
```

#### Before (当前 oauth-auth.ts Token 端点，~120 行内联逻辑)

```typescript
// apps/server/backend/src/controllers/oauth-auth.ts — 当前实现 (简化)
token: async (c) => {
  const body = await c.req.parseBody();
  const grantType = body.grant_type as string;

  if (grantType === "authorization_code") {
    // 1. 手动取 auth code
    const authCode = await authCodesDb.consume(body.code as string);
    if (!authCode) return c.json({ error: "invalid_grant" }, 400);
    // 2. 手动校验过期
    if (authCode.expiresAt < Date.now()) return c.json({ error: "invalid_grant" }, 400);
    // 3. 手动 PKCE 验证
    const hash = createHash("sha256").update(body.code_verifier as string).digest("base64url");
    if (hash !== authCode.codeChallenge) return c.json({ error: "invalid_grant" }, 400);
    // 4. 业务逻辑: 创建 delegate
    const result = await createChildDelegate(deps, rootDelegate, realm, { ... });
    // 5. 手动拼 OAuth 响应
    return c.json({ access_token: result.accessToken, token_type: "Bearer", ... });

  } else if (grantType === "refresh_token") {
    // ... 另一大段
  } else {
    return c.json({ error: "unsupported_grant_type" }, 400);
  }
},
```

#### After (改造后)

```typescript
// apps/server/backend/src/controllers/oauth-auth.ts — 改造后
import { handleTokenRequest, type TokenIssuer } from "@casfa/oauth-provider";

// TokenIssuer 只关心业务 — 创建 delegate + 生成 token pair
const tokenIssuer: TokenIssuer<GrantedPermissions> = {
  issueFromAuthCode: async ({ subject, clientId, scopes, grantedPermissions }) => {
    const root = await delegatesDb.getRootByRealm(subject);
    const result = await createChildDelegate(deps, root, subject, {
      name: `oauth:${clientId}`, ...grantedPermissions,
    });
    if (!result.ok) return { ok: false, error: { code: "server_error", message: result.message, statusCode: 500 } };
    return { ok: true, value: {
      access_token: result.accessToken,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: result.refreshToken,
      scope: scopes.join(" "),
    }};
  },
  issueFromRefresh: async ({ refreshToken }) => {
    const rtBytes = Buffer.from(refreshToken, "base64");
    const result = await refreshDelegateToken(rtBytes, { delegatesDb });
    return { ok: true, value: {
      access_token: result.newAccessToken,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: result.newRefreshToken,
    }};
  },
};

// Token 端点: 协议层由包处理, controller 只做 HTTP 适配
token: async (c) => {
  const body = await c.req.parseBody();
  const result = await handleTokenRequest<GrantedPermissions>(
    { grantType: body.grant_type, code: body.code, codeVerifier: body.code_verifier, ... },
    { authCodeStore: authCodesDb, tokenIssuer, supportedGrantTypes: ["authorization_code", "refresh_token"] },
  );
  if (!result.ok) return c.json({ error: result.error.code, error_description: result.error.message }, result.error.statusCode);
  return c.json(result.value);
},
```

#### Before (access-token-auth.ts 双模式鉴权，~200 行)

```typescript
// 当前: 所有逻辑内联在 Hono middleware 里
export const createAccessTokenMiddleware = (deps) => {
  return async (c, next) => {
    const authHeader = c.req.header("Authorization");
    // ... 解析 Bearer
    if (tokenString.includes(".")) {
      // JWT 路径: 80 行
      const result = await jwtVerifier(token);
      const role = await userRolesDb.getRole(result.userId);
      const { delegate } = await delegatesDb.getOrCreateRoot(result.userId, ...);
      c.set("auth", { type: "access", delegate, ... });
      await next();
    } else {
      // AT 路径: 60 行
      const tokenBytes = Buffer.from(tokenBase64, "base64");
      const decoded = decodeToken(tokenBytes);
      const delegate = await delegatesDb.get(delegateId);
      const atHash = computeTokenHash(tokenBytes);
      // ... hash 比对, 过期检查
      c.set("auth", { type: "access", delegate, ... });
      await next();
    }
  };
};
```

#### After (改造后)

```typescript
// 改造后: 鉴权核心逻辑用包, middleware 只做 Hono 适配
import { createDualAuthHandler } from "@casfa/oauth-provider";
import { createCognitoJwtVerifier } from "./jwt-verifier.ts"; // 已用 @casfa/oauth-consumer

const authHandler = createDualAuthHandler<AccessTokenAuthContext>({
  jwtVerifier: createCognitoJwtVerifier(cognitoConfig),
  buildContextFromJwt: async (identity) => {
    const role = await userRolesDb.getRole(identity.subject);
    if (role === "unauthorized") return { ok: false, error: { code: "FORBIDDEN", message: "unauthorized", statusCode: 403 } };
    const { delegate } = await delegatesDb.getOrCreateRoot(identity.subject, generateDelegateId());
    return { ok: true, value: { type: "access", delegate, delegateId: delegate.delegateId, realm: delegate.realm, ... } };
  },
  opaqueVerifier: async (tokenBytes) => {
    const decoded = decodeToken(tokenBytes);
    const delegate = await delegatesDb.get(bytesToDelegateId(decoded.delegateId));
    if (!delegate || delegate.isRevoked) return { ok: false, error: { code: "INVALID_TOKEN", message: "...", statusCode: 401 } };
    if (computeTokenHash(tokenBytes) !== delegate.currentAtHash) return { ok: false, error: { ... } };
    return { ok: true, value: { type: "access", delegate, ... } };
  },
});

// Hono middleware 薄薄一层
export const createAccessTokenMiddleware = (): MiddlewareHandler<Env> => {
  return async (c, next) => {
    const header = c.req.header("Authorization") ?? "";
    const result = await authHandler(header);
    if (!result.ok) return c.json({ error: result.error.code, message: result.error.message }, result.error.statusCode);
    c.set("auth", result.value);
    await next();
  };
};
```

### 用例 4: 测试/Mock 场景

```typescript
// 单元测试中的用法
import { createMockJwtVerifier, createMockJwt } from "@casfa/oauth-consumer";
import { createAuthorizationCode, consumeAuthorizationCode } from "@casfa/oauth-provider";

// ---- Mock JWT ----
const verifier = createMockJwtVerifier("test-secret");
const jwt = await createMockJwt("test-secret", { sub: "user_123", email: "test@example.com" });
const result = await verifier(jwt);
assert(result.ok && result.value.subject === "user_123");

// ---- 授权码内存 store ----
const codes = new Map();
const memoryStore = {
  save: async (code) => { codes.set(code.code, { ...code, used: false }); },
  consume: async (codeStr) => {
    const c = codes.get(codeStr);
    if (!c || c.used) return null;
    c.used = true;
    return c;
  },
};

// ---- 授权码生命周期 ----
const code = createAuthorizationCode({
  clientId: "test-client",
  redirectUri: "http://localhost:3000/callback",
  subject: "user_123",
  scopes: ["api:read"],
  codeChallenge: await generateCodeChallenge(verifier_str),
  grantedPermissions: { canRead: true },
});
await memoryStore.save(code);
const consumed = await consumeAuthorizationCode(code.code, verifier_str, memoryStore);
assert(consumed.ok);
```

---

## Package 1: `@casfa/oauth-consumer`

OIDC 依赖方的协议层逻辑。对接任意 OIDC 兼容 IdP（Cognito、Auth0、Keycloak、自建）。

### 目录结构

```
packages/oauth-consumer/src/
  index.ts
  types.ts              # 类型定义
  jwt-verifier.ts       # JWT 验证器 (JWKS + Mock)
  idp-client.ts         # IdP 授权 URL 构建 + code 交换 + refresh
  discovery.ts          # OIDC Discovery 自动配置
```

### 类型定义 (`types.ts`)

```typescript
// ---- 统一错误处理 ----

export type Result<T, E = OAuthError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export type OAuthError = {
  code: string;       // e.g. "invalid_token", "discovery_failed"
  message: string;
  statusCode: number;
};

// ---- IdP 配置 ----

/** 手动指定 IdP 端点 */
export type IdpConfig = {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  clientId: string;
  clientSecret?: string;
};

// ---- JWT 验证 ----

/** JWT 验证通过后的标准化用户身份 */
export type VerifiedIdentity = {
  subject: string;     // IdP sub claim
  email?: string;
  name?: string;
  expiresAt?: number;  // unix seconds
  rawClaims: Record<string, unknown>;
};

/** JWT 验证器函数签名 */
export type JwtVerifier = (token: string) => Promise<Result<VerifiedIdentity>>;

// ---- IdP Token ----

/** IdP 返回的 token 集 */
export type IdpTokenSet = {
  accessToken: string;
  idToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  tokenType: string;
};
```

### 核心函数

#### `discovery.ts` — OIDC Discovery

```typescript
/**
 * 从 OIDC Discovery URL 自动获取 IdP 配置。
 *
 * 访问 {discoveryUrl} → 解析 JSON → 提取端点 → 组合 clientId/Secret。
 */
export async function discoverIdpConfig(
  discoveryUrl: string,
  clientId: string,
  clientSecret?: string
): Promise<Result<IdpConfig>>;
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `discoveryUrl` | `string` | `https://.../.well-known/openid-configuration` |
| `clientId` | `string` | OAuth client_id |
| `clientSecret` | `string?` | OAuth client_secret (公开客户端可省略) |
| **返回** | `Result<IdpConfig>` | 包含 issuer / endpoints / jwksUri 的完整配置 |

**错误码**: `discovery_failed` (网络错误或响应格式不合法)

#### `jwt-verifier.ts` — JWT 验证

```typescript
/**
 * 创建 JWKS 验证器。
 *
 * 内部用 jose 库的 createRemoteJWKSet 缓存公钥。
 * 校验 issuer、audience (可选)、过期时间。
 */
export function createJwtVerifier(config: {
  jwksUri: string;
  issuer: string;
  audience?: string;
  /** 自定义从 JWT claims 提取 subject (默认取 claims.sub) */
  extractSubject?: (claims: Record<string, unknown>) => string;
}): JwtVerifier;
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `config.jwksUri` | `string` | JWKS 端点 URL |
| `config.issuer` | `string` | 期望的 issuer claim |
| `config.audience` | `string?` | 期望的 audience claim |
| `config.extractSubject` | `function?` | 自定义 subject 提取逻辑 (如 Cognito UUID → `usr_xxx`) |
| **返回** | `JwtVerifier` | `(token: string) => Promise<Result<VerifiedIdentity>>` |

**错误码**: `invalid_token` (签名/过期/issuer 不匹配)

```typescript
/**
 * 创建 HMAC Mock 验证器 (开发/测试用)。
 *
 * 用 HS256 验证签名，不走 JWKS。
 */
export function createMockJwtVerifier(secret: string): JwtVerifier;

/**
 * 生成 Mock JWT (开发/测试用)。
 */
export function createMockJwt(
  secret: string,
  payload: { sub: string; email?: string; name?: string; exp?: number }
): Promise<string>;
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `secret` | `string` | HMAC 签名密钥 |
| `payload` | `object` | JWT claims |
| **返回** | `Promise<string>` | 签名后的 JWT 字符串 |

#### `idp-client.ts` — IdP 交互

```typescript
/**
 * 构建 IdP 授权 URL (Authorization Code + PKCE)。
 *
 * 组装 query params，不发起网络请求。
 */
export function buildAuthorizationUrl(config: IdpConfig, params: {
  redirectUri: string;
  scope: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod?: string;   // 默认 "S256"
  /** 额外 query params (如 Cognito 的 identity_provider=Google) */
  extraParams?: Record<string, string>;
}): string;
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `config` | `IdpConfig` | IdP 端点配置 |
| `params.redirectUri` | `string` | 回调 URL |
| `params.scope` | `string` | 请求的 scope (空格分隔) |
| `params.state` | `string` | CSRF 防护 state |
| `params.codeChallenge` | `string` | PKCE code_challenge |
| `params.extraParams` | `Record?` | 额外查询参数 |
| **返回** | `string` | 完整的授权 URL |

```typescript
/**
 * 用授权码交换 IdP Token。
 *
 * POST {tokenEndpoint} with grant_type=authorization_code。
 */
export async function exchangeAuthorizationCode(config: IdpConfig, params: {
  code: string;
  redirectUri: string;
  codeVerifier?: string;
}): Promise<Result<IdpTokenSet>>;
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `config` | `IdpConfig` | IdP 端点配置 |
| `params.code` | `string` | 授权码 |
| `params.redirectUri` | `string` | 必须与授权请求一致 |
| `params.codeVerifier` | `string?` | PKCE code_verifier |
| **返回** | `Result<IdpTokenSet>` | `{ accessToken, idToken?, refreshToken?, expiresIn }` |

**错误码**: `token_exchange_failed` (IdP 返回错误), `network_error`

```typescript
/**
 * 用 refresh_token 刷新 IdP Token。
 *
 * POST {tokenEndpoint} with grant_type=refresh_token。
 */
export async function refreshIdpToken(
  config: IdpConfig,
  refreshToken: string
): Promise<Result<IdpTokenSet>>;
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `config` | `IdpConfig` | IdP 端点配置 |
| `refreshToken` | `string` | 上次获取的 refresh_token |
| **返回** | `Result<IdpTokenSet>` | 新的 token 集 |

**错误码**: `refresh_failed`, `network_error`

---

## Package 2: `@casfa/oauth-provider`

OAuth 2.1 授权服务器的协议层逻辑。处理授权码生命周期、客户端注册、Token 端点分发，不涉及具体 token 格式和存储实现。

### 目录结构

```
packages/oauth-provider/src/
  index.ts
  types.ts              # 类型定义 (含存储接口)
  metadata.ts           # RFC 8414 / RFC 9728 元数据生成
  redirect-uri.ts       # Redirect URI 校验
  scope.ts              # Scope 校验与映射
  client-registry.ts    # 动态客户端注册 (RFC 7591)
  authorization.ts      # 授权请求校验 + 授权码生命周期
  token-grant.ts        # Token 端点处理
  dual-auth.ts          # JWT + Opaque Token 双模式鉴权
```

### 类型定义 (`types.ts`)

```typescript
// ---- 统一错误处理 (与 consumer 相同) ----

export type Result<T, E = OAuthError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export type OAuthError = {
  code: string;       // RFC 6749 error code: invalid_grant, invalid_client, ...
  message: string;
  statusCode: number;
};

// ---- 授权服务器配置 ----

export type AuthServerConfig = {
  issuer: string;                    // 服务 base URL
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  supportedScopes: ScopeDefinition[];
  supportedGrantTypes: string[];     // ["authorization_code", "refresh_token"]
  supportedResponseTypes: string[];  // ["code"]
  codeChallengeMethodsSupported: string[]; // ["S256"]
};

export type ScopeDefinition = {
  name: string;        // e.g. "cas:read"
  description: string; // 人类可读描述 (用于 consent UI)
  default?: boolean;   // 是否默认授予
};

// ---- OAuth 客户端 ----

export type OAuthClient = {
  clientId: string;
  clientName: string;
  redirectUris: string[];  // 支持 "http://127.0.0.1:*" 通配符
  grantTypes: string[];
  tokenEndpointAuthMethod: "none" | "client_secret_basic" | "client_secret_post";
  createdAt: number;
};

// ---- 授权码 (泛型 TGrant 承载业务权限) ----

export type AuthorizationCode<TGrant = Record<string, unknown>> = {
  code: string;
  clientId: string;
  redirectUri: string;
  subject: string;              // 授权用户 ID
  scopes: string[];
  codeChallenge: string;
  codeChallengeMethod: "S256";
  grantedPermissions: TGrant;   // 业务自定义 (如 casfa 的 GrantedPermissions)
  createdAt: number;
  expiresAt: number;
};

// ---- 授权请求 ----

export type AuthorizationRequestParams = {
  responseType: string;
  clientId: string;
  redirectUri: string;
  state?: string;
  scope?: string;
  codeChallenge: string;
  codeChallengeMethod: string;
};

export type ValidatedAuthRequest = {
  client: OAuthClient;
  redirectUri: string;
  scopes: string[];
  codeChallenge: string;
  state?: string;
};

// ---- Token 端点 ----

export type TokenRequestParams = {
  grantType: string;
  code?: string;
  codeVerifier?: string;
  redirectUri?: string;
  clientId?: string;
  refreshToken?: string;
};

export type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token?: string;
  scope?: string;
};

// ---- 双模式鉴权 ----

/** JWT 验证器 (复用 consumer 的类型, 或独立定义) */
export type JwtVerifier = (token: string) => Promise<Result<{
  subject: string;
  email?: string;
  name?: string;
  expiresAt?: number;
  rawClaims: Record<string, unknown>;
}>>;

/** Opaque token 验证器 */
export type OpaqueTokenVerifier<TContext> = (
  tokenBytes: Uint8Array
) => Promise<Result<TContext>>;

// ---- 存储适配器接口 (由业务实现) ----

/** 授权码存储 — consume 必须是原子操作 */
export type AuthCodeStore<TGrant = Record<string, unknown>> = {
  save: (code: AuthorizationCode<TGrant>) => Promise<void>;
  consume: (code: string) => Promise<AuthorizationCode<TGrant> | null>;
};

/** 客户端存储 */
export type ClientStore = {
  get: (clientId: string) => Promise<OAuthClient | null>;
  save: (client: OAuthClient) => Promise<void>;
};

/** Token 发行回调 — 由业务实现 token 生成逻辑 */
export type TokenIssuer<TGrant> = {
  issueFromAuthCode: (params: {
    subject: string;
    clientId: string;
    scopes: string[];
    grantedPermissions: TGrant;
  }) => Promise<Result<TokenResponse>>;

  issueFromRefresh: (params: {
    refreshToken: string;
  }) => Promise<Result<TokenResponse>>;
};
```

### 核心函数

#### `metadata.ts` — 服务发现元数据

```typescript
/**
 * 生成 OAuth 2.1 Authorization Server Metadata (RFC 8414)。
 *
 * 输出可直接作为 GET /.well-known/oauth-authorization-server 的响应 body。
 */
export function generateAuthServerMetadata(
  config: AuthServerConfig
): Record<string, unknown>;
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `config` | `AuthServerConfig` | issuer、各端点 URL、支持的 scope/grant 等 |
| **返回** | `Record<string, unknown>` | RFC 8414 标准 JSON 对象 |

```typescript
/**
 * 生成 Protected Resource Metadata (RFC 9728)。
 *
 * 输出可直接作为 GET /.well-known/oauth-protected-resource 的响应 body。
 */
export function generateProtectedResourceMetadata(config: {
  resource: string;
  authorizationServers: string[];
  scopesSupported?: string[];
  bearerMethodsSupported?: string[];
}): Record<string, unknown>;
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `config.resource` | `string` | 受保护资源 URL |
| `config.authorizationServers` | `string[]` | 关联的授权服务器 issuer 列表 |
| **返回** | `Record<string, unknown>` | RFC 9728 标准 JSON 对象 |

#### `redirect-uri.ts` — Redirect URI 校验

```typescript
/**
 * 校验 redirect_uri 是否匹配已注册的模式。
 *
 * 支持端口通配符: "http://127.0.0.1:*" 匹配任意端口的 loopback。
 * 精确匹配其他 URI (含 path, 不含 fragment)。
 */
export function isRedirectUriAllowed(
  uri: string,
  allowedPatterns: string[]
): boolean;
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `uri` | `string` | 客户端提交的 redirect_uri |
| `allowedPatterns` | `string[]` | 注册时声明的 URI 模式列表 |
| **返回** | `boolean` | 是否匹配 |

#### `scope.ts` — Scope 校验与映射

```typescript
/**
 * 校验请求的 scopes 是否全部在支持列表内。
 *
 * 返回去重后的合法 scope 列表。
 */
export function validateScopes(
  requestedScopes: string[],
  supportedScopes: string[]
): Result<string[]>;
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `requestedScopes` | `string[]` | 客户端请求的 scope |
| `supportedScopes` | `string[]` | 服务端支持的 scope |
| **返回** | `Result<string[]>` | 去重后的合法列表，或 `invalid_scope` 错误 |

```typescript
/**
 * 将 OAuth scopes 映射为业务权限对象。
 *
 * 遍历 scopes，从 mapping 中查找对应的权限片段，合并到 defaults 上。
 */
export function mapScopes<TPermissions>(
  scopes: string[],
  mapping: Record<string, Partial<TPermissions>>,
  defaults: TPermissions
): TPermissions;
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `scopes` | `string[]` | 已校验的 scope 列表 |
| `mapping` | `Record<string, Partial<TPermissions>>` | scope → 权限片段的映射表 |
| `defaults` | `TPermissions` | 默认权限 (所有 scope 之前的基础值) |
| **返回** | `TPermissions` | 合并后的权限对象 |

**示例**:
```typescript
mapScopes(
  ["cas:read", "cas:write"],
  { "cas:write": { canUpload: true }, "depot:manage": { canManageDepot: true } },
  { canUpload: false, canManageDepot: false }
)
// → { canUpload: true, canManageDepot: false }
```

#### `client-registry.ts` — 动态客户端注册

```typescript
export type ClientRegistrationRequest = {
  clientName: string;
  redirectUris: string[];
  grantTypes?: string[];
  tokenEndpointAuthMethod?: string;
};

/**
 * 处理 RFC 7591 动态客户端注册。
 *
 * 校验参数 → 生成 clientId → 持久化 → 返回。
 */
export async function registerClient(
  request: ClientRegistrationRequest,
  store: ClientStore,
  options?: {
    generateClientId?: () => string;    // 默认 "dyn_" + randomUUID
    allowedGrantTypes?: string[];       // 默认 ["authorization_code", "refresh_token"]
  }
): Promise<Result<OAuthClient>>;
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `request` | `ClientRegistrationRequest` | 注册请求体 |
| `store` | `ClientStore` | 客户端存储 |
| `options.generateClientId` | `function?` | 自定义 ID 生成 |
| **返回** | `Result<OAuthClient>` | 创建的客户端，或 `invalid_client_metadata` 错误 |

```typescript
/**
 * 解析客户端：先查 hardcoded → 再查 store。
 *
 * hardcodedClients 用于预注册的已知客户端 (如 VS Code 插件)。
 */
export async function resolveClient(
  clientId: string,
  store: ClientStore,
  hardcodedClients?: Map<string, OAuthClient>
): Promise<OAuthClient | null>;
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `clientId` | `string` | 要查找的 clientId |
| `store` | `ClientStore` | 客户端存储 |
| `hardcodedClients` | `Map?` | 静态客户端表 (如 `"vscode-casfa-mcp"`) |
| **返回** | `OAuthClient \| null` | 找到的客户端或 null |

#### `authorization.ts` — 授权码生命周期

```typescript
/**
 * 校验授权请求参数 (GET /authorize 的 query)。
 *
 * 校验项:
 *   - response_type === "code"
 *   - client 存在
 *   - redirect_uri 在注册列表内
 *   - scopes 合法
 *   - code_challenge 存在且 method === "S256"
 */
export async function validateAuthorizationRequest(
  params: AuthorizationRequestParams,
  deps: {
    resolveClient: (id: string) => Promise<OAuthClient | null>;
    supportedScopes: string[];
  }
): Promise<Result<ValidatedAuthRequest>>;
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `params` | `AuthorizationRequestParams` | 原始请求参数 |
| `deps.resolveClient` | `function` | 客户端解析函数 |
| `deps.supportedScopes` | `string[]` | 服务支持的 scopes |
| **返回** | `Result<ValidatedAuthRequest>` | 校验后的结构化请求，或 OAuth 标准错误 |

**错误码**: `unsupported_response_type`, `invalid_client`, `invalid_redirect_uri`, `invalid_scope`, `invalid_request` (缺少 PKCE)

```typescript
/**
 * 生成授权码 (用户同意授权后调用)。
 *
 * 生成 128-bit 随机 code，打包为 AuthorizationCode 记录。
 * 返回的是内存对象，需调用方自行调用 store.save() 持久化。
 */
export function createAuthorizationCode<TGrant>(params: {
  clientId: string;
  redirectUri: string;
  subject: string;
  scopes: string[];
  codeChallenge: string;
  grantedPermissions: TGrant;
  ttlMs?: number;           // 默认 600_000 (10 min)
}): AuthorizationCode<TGrant>;
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `params.subject` | `string` | 授权用户 ID |
| `params.grantedPermissions` | `TGrant` | 用户在 consent UI 中选择的业务权限 |
| `params.ttlMs` | `number?` | 授权码有效期 (毫秒) |
| **返回** | `AuthorizationCode<TGrant>` | 包含随机 code 的记录 (纯内存) |

```typescript
/**
 * 消费授权码并验证 PKCE。
 *
 * 从 store 原子取出 code → 检查过期 → SHA-256(code_verifier) === code_challenge。
 * 成功后 code 不可再用 (防 double-spend)。
 */
export async function consumeAuthorizationCode<TGrant>(
  code: string,
  codeVerifier: string,
  store: AuthCodeStore<TGrant>
): Promise<Result<AuthorizationCode<TGrant>>>;
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `code` | `string` | 客户端提交的授权码 |
| `codeVerifier` | `string` | PKCE code_verifier |
| `store` | `AuthCodeStore<TGrant>` | 授权码存储 (consume 必须原子) |
| **返回** | `Result<AuthorizationCode<TGrant>>` | 授权码记录 (含 grantedPermissions)，或错误 |

**错误码**: `invalid_grant` (不存在 / 已消费 / 已过期 / PKCE 不匹配)

#### `token-grant.ts` — Token 端点

```typescript
/**
 * 处理 POST /token 请求 (统一入口)。
 *
 * 根据 grant_type 分发:
 *   authorization_code → consumeAuthorizationCode + tokenIssuer.issueFromAuthCode
 *   refresh_token      → tokenIssuer.issueFromRefresh
 *
 * 协议层只负责校验和分发，实际 token 生成由 TokenIssuer 回调完成。
 */
export async function handleTokenRequest<TGrant>(
  params: TokenRequestParams,
  deps: {
    authCodeStore: AuthCodeStore<TGrant>;
    tokenIssuer: TokenIssuer<TGrant>;
    supportedGrantTypes: string[];
  }
): Promise<Result<TokenResponse>>;
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `params` | `TokenRequestParams` | 原始请求参数 (`grant_type`, `code`, `code_verifier`, ...) |
| `deps.authCodeStore` | `AuthCodeStore<TGrant>` | 授权码存储 |
| `deps.tokenIssuer` | `TokenIssuer<TGrant>` | 业务 token 发行回调 |
| `deps.supportedGrantTypes` | `string[]` | 允许的 grant_type |
| **返回** | `Result<TokenResponse>` | 标准 OAuth token 响应，或错误 |

**错误码**: `unsupported_grant_type`, `invalid_grant`, `invalid_request` (缺少必填参数)

**数据流**:
```
handleTokenRequest
  ├─ grant_type=authorization_code
  │    ├─ consumeAuthorizationCode(code, codeVerifier, store)
  │    │    ├─ store.consume(code)         ← 原子消费
  │    │    ├─ 检查 expiresAt
  │    │    └─ verifyPkceChallenge()       ← from @casfa/client-auth-crypto
  │    └─ tokenIssuer.issueFromAuthCode({subject, clientId, scopes, grantedPermissions})
  │         └─ (业务实现: 创建 delegate, 生成 token pair, 返回 TokenResponse)
  │
  └─ grant_type=refresh_token
       └─ tokenIssuer.issueFromRefresh({refreshToken})
            └─ (业务实现: decode RT, verify hash, rotate, 返回 TokenResponse)
```

#### `dual-auth.ts` — 双模式鉴权

```typescript
export type DualAuthConfig<TContext> = {
  /** JWT 验证器 — token 含 "." 时走此路径 */
  jwtVerifier: JwtVerifier;
  /** JWT 验证通过后，构建业务上下文 (如查询用户角色、获取 root delegate) */
  buildContextFromJwt: (identity: {
    subject: string;
    email?: string;
    name?: string;
    expiresAt?: number;
    rawClaims: Record<string, unknown>;
  }) => Promise<Result<TContext>>;
  /** Opaque token 验证器 — token 不含 "." 时走此路径 */
  opaqueVerifier: OpaqueTokenVerifier<TContext>;
};

/**
 * 创建双模式 Bearer token 鉴权函数。
 *
 * 自动区分 JWT (含 ".") vs Opaque token (纯 base64)。
 * 两条路径产出相同类型的 TContext，下游代码无需关心认证模式。
 */
export function createDualAuthHandler<TContext>(
  config: DualAuthConfig<TContext>
): (authorizationHeader: string) => Promise<Result<TContext>>;
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `config.jwtVerifier` | `JwtVerifier` | JWT 验证函数 (可由 `@casfa/oauth-consumer` 创建) |
| `config.buildContextFromJwt` | `function` | JWT → 业务上下文 (如查 DB 获取 root delegate) |
| `config.opaqueVerifier` | `function` | `(bytes: Uint8Array) => Promise<Result<TContext>>` |
| **返回** | `function` | `(header: string) => Promise<Result<TContext>>` |

**错误码**: `missing_token` (无 Bearer), `invalid_token` (验证失败)

**鉴权流程**:
```
Authorization: Bearer {token}
        │
        ├─ token 含 "." → JWT 路径
        │    ├─ jwtVerifier(token)
        │    └─ buildContextFromJwt(identity)
        │         └─ → Result<TContext>
        │
        └─ token 不含 "." → Opaque 路径
             ├─ base64 decode → bytes
             └─ opaqueVerifier(bytes)
                  └─ → Result<TContext>
```

---

## `apps/server` 对接示例

改造后，`apps/server` 变成两个包的"装配层"：

```typescript
import { createJwtVerifier, exchangeAuthorizationCode, refreshIdpToken } from "@casfa/oauth-consumer";
import {
  generateAuthServerMetadata,
  validateAuthorizationRequest, createAuthorizationCode, consumeAuthorizationCode,
  handleTokenRequest, registerClient, resolveClient,
  createDualAuthHandler, mapScopes, isRedirectUriAllowed,
} from "@casfa/oauth-provider";

// ---- Consumer 侧: Cognito 登录 ----

const cognitoVerifier = createJwtVerifier({
  jwksUri: `https://cognito-idp.${region}.amazonaws.com/${poolId}/.well-known/jwks.json`,
  issuer: `https://cognito-idp.${region}.amazonaws.com/${poolId}`,
  extractSubject: (claims) => uuidToUserId(claims.sub as string),
});

// ---- Provider 侧: 对外授权 ----

const tokenIssuer: TokenIssuer<GrantedPermissions> = {
  async issueFromAuthCode({ subject, clientId, scopes, grantedPermissions }) {
    const result = await createChildDelegate(deps, rootDelegate, realm, {
      name: `oauth:${clientId}`, ...grantedPermissions,
    });
    if (!result.ok) return { ok: false, error: ... };
    return { ok: true, value: {
      access_token: result.accessToken,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: result.refreshToken,
      scope: scopes.join(" "),
    }};
  },
  async issueFromRefresh({ refreshToken }) {
    const result = await refreshDelegateToken(decode(refreshToken), deps);
    return { ok: true, value: { ... } };
  },
};

// ---- 双模式鉴权 ----

const authHandler = createDualAuthHandler<AccessTokenAuthContext>({
  jwtVerifier: cognitoVerifier,
  buildContextFromJwt: async (identity) => {
    const role = await userRolesDb.get(identity.subject);
    const root = await delegatesDb.getOrCreateRoot(identity.subject, realm);
    return { ok: true, value: { type: "access", delegate: root, ... } };
  },
  opaqueVerifier: async (bytes) => {
    const decoded = decodeToken(bytes);
    const delegate = await delegatesDb.get(decoded.delegateId);
    // ... hash verify, expiry check
    return { ok: true, value: { type: "access", delegate, ... } };
  },
});
```

---

## 实施计划

### Phase 1: `@casfa/oauth-consumer` (预计 1 天)

1. 创建 `packages/oauth-consumer/` 骨架 (package.json, tsconfig.json)
2. 实现 `types.ts`, `discovery.ts`, `jwt-verifier.ts`, `idp-client.ts`
3. 从 `apps/server/backend/src/auth/jwt-verifier.ts` 迁移 JWKS 逻辑
4. 从 `apps/server/backend/src/controllers/oauth.ts` 迁移 token 交换逻辑
5. 单元测试 (mock JWKS endpoint, mock IdP token endpoint)
6. `apps/server` 改为依赖此包

### Phase 2: `@casfa/oauth-provider` (预计 2 天)

1. 创建 `packages/oauth-provider/` 骨架
2. 实现 `metadata.ts`, `redirect-uri.ts`, `scope.ts` (纯函数，最简单)
3. 实现 `client-registry.ts`, `authorization.ts` (依赖存储接口)
4. 实现 `token-grant.ts` (依赖 `AuthCodeStore` + `TokenIssuer`)
5. 实现 `dual-auth.ts`
6. 从 `apps/server/backend/src/controllers/oauth-auth.ts` 迁移逻辑
7. 单元测试
8. `apps/server` 改为依赖此包，controller 瘦身为 HTTP 适配层

### Phase 3: 验证 (预计 0.5 天)

1. E2E 测试通过 (现有 OAuth 流程不受影响)
2. 确认 MCP 客户端 (VS Code) 正常授权

---

## 设计决策总结

| 决策 | 选择 | 理由 |
|------|------|------|
| 一个包 vs 两个包 | **两个包** | Consumer 和 Provider 完全正交，一个服务可能只需其中一个 |
| 错误处理 | `Result<T, E>` | 函数式，类型安全，调用方被迫处理错误 |
| 业务权限 | 泛型 `TGrant` | 不同服务权限模型不同，协议层不应该知道具体结构 |
| Token 生成 | `TokenIssuer` 回调 | Token 格式是业务决定 (二进制 / JWT / opaque string) |
| 存储 | `AuthCodeStore` / `ClientStore` 接口注入 | DynamoDB / Redis / Postgres 由业务选择 |
| 框架 | 无依赖 | 入参出参都是普通对象，Hono / Express / Koa 自行适配 |
| PKCE | 复用 `@casfa/client-auth-crypto` | 已有且 100% 通用 |
