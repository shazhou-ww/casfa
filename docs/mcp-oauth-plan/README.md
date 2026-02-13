# MCP OAuth 登录方案

为 VS Code 等第三方客户端通过 MCP 访问 CASFA 服务，提供基于 `/auth` 路由的 OAuth 2.1 授权流程。

## 现状

| 路由 | 用途 | 状态 |
|------|------|------|
| `POST /api/mcp` | MCP JSON-RPC (`cas_read`) | 已有，JWT 认证 |
| `/api/oauth/*` | Cognito OAuth 代理（用户自己登录） | 已有，**不动** |
| `POST /api/auth/refresh` | Delegate RT→AT 轮换 | 已有，需评估 |
| `/api/local/*` | 本地开发认证 | 已有，**不动** |

### 关键约束

- `/api/oauth/*` 是 Cognito 代理，预留给服务自身 OAuth 登录，不用于第三方授权
- 第三方客户端授权走 `/api/auth/*`，基于现有的 delegate 体系
- 现有 `POST /api/mcp` 仅支持 JWT 认证，需扩展为同时支持 delegate AT

## 目标

VS Code MCP 客户端通过标准 **OAuth 2.1 Authorization Code + PKCE** 流程登录，服务端为该客户端创建独立的 **delegate**，颁发 delegate AT/RT，后续 MCP 请求使用该 delegate AT 鉴权。

```
VS Code (MCP Client)
    │
    │  1. 打开浏览器 → /api/auth/authorize
    ▼
浏览器 (用户已登录 / 需先登录)
    │
    │  2. 用户确认授权，选择 realm / scope
    ▼
服务端
    │  3. 生成 authorization_code
    │  4. 302 重定向 → redirect_uri?code=...&state=...
    ▼
VS Code
    │  5. POST /api/auth/token (code + code_verifier)
    ▼
服务端
    │  6. 验证 code + PKCE
    │  7. 创建 child delegate (parent = root)
    │  8. 返回 delegate AT + RT
    ▼
VS Code
    │  9. 用 delegate AT 调用 MCP
    ▼
POST /api/mcp (Bearer {delegate_AT})
```

## 实施计划

### Phase 0: OAuth Server Metadata

**新增** `GET /.well-known/oauth-authorization-server/api/auth`

MCP 2025-03 规范要求客户端通过此端点发现 OAuth 配置。

> **注意**：根据 [RFC 8414 §3](https://datatracker.ietf.org/doc/html/rfc8414#section-3)，对于 issuer `https://{domain}/api/auth`，well-known URI 的路径是 `/.well-known/oauth-authorization-server/api/auth`（well-known 前缀在根路径，issuer path 作为后缀），**不是** `/api/auth/.well-known/...`。MCP 客户端会按此规则构造发现 URL。

```jsonc
{
  "issuer": "https://{domain}/api/auth",
  "authorization_endpoint": "https://{domain}/api/auth/authorize",
  "token_endpoint": "https://{domain}/api/auth/token",
  "registration_endpoint": "https://{domain}/api/auth/register",
  "token_endpoint_auth_methods_supported": ["none"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "response_types_supported": ["code"],
  "code_challenge_methods_supported": ["S256"],
  "scopes_supported": ["cas:read", "cas:write", "depot:manage"]
}
```

由于路径在根级别而非 `/api/auth` 子路径下，需在 Hono app 的根路由或反向代理层配置此端点。

**工作量**：小 — 纯配置返回，无逻辑

---

### Phase 1: 授权端点

**新增** `GET /api/auth/authorize`

#### 请求参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `response_type` | 是 | 必须为 `code` |
| `client_id` | 是 | 客户端标识 |
| `redirect_uri` | 是 | 回调地址 |
| `scope` | 是 | 空格分隔的权限范围 |
| `state` | 是 | 防 CSRF 随机值 |
| `code_challenge` | 是 | S256(code_verifier) |
| `code_challenge_method` | 是 | 必须为 `S256` |

#### 流程

1. 验证参数完整性（`response_type=code`, PKCE 必填, `redirect_uri` 合法）
2. 检查用户是否已有有效 session（Cognito/Local cookie）
   - 未登录 → 重定向到登录页，登录后回来继续授权
   - 已登录 → 进入授权确认页
3. 显示授权确认页面（前端页面）：
   - 客户端名称 (`client_id`)
   - 请求的权限范围 (`scope`)
   - 用户选择 realm（如有多个）
   - 确认 / 拒绝按钮
4. 用户确认 → 生成 `authorization_code`
5. 302 重定向 → `{redirect_uri}?code={code}&state={state}`
6. 用户拒绝 → 302 重定向 → `{redirect_uri}?error=access_denied&state={state}`

#### Authorization Code 存储

```typescript
interface AuthorizationCode {
  code: string;              // 随机 128-bit, URL-safe base64
  clientId: string;
  redirectUri: string;
  userId: string;
  realm: string;
  scopes: string[];              // 用户确认后的最终 scope 列表
  codeChallenge: string;     // S256(code_verifier)
  codeChallengeMethod: "S256";
  // ── 用户在授权页面选择的权限（可能比 scope 更窄）──
  grantedPermissions: {
    canUpload: boolean;
    canManageDepot: boolean;
    delegatedDepots?: string[];    // 用户选定的 depot 白名单
    scopeNodeHash?: string;        // 用户选定的 scope 子树
    expiresIn?: number;            // 用户选定的过期时间（秒）
  };
  createdAt: number;
  expiresAt: number;         // createdAt + 10 min
  used: boolean;
}
```

存储方式：DynamoDB（复用 tokensTable，PK=`AUTHCODE#{code}`, SK=`METADATA`，TTL 自动清理）。

**工作量**：中 — 需后端端点 + 前端授权确认页面

---

### Phase 2: Token 端点

**新增** `POST /api/auth/token`

统一处理两种 `grant_type`。

#### 2a. `grant_type=authorization_code`

**请求**（`application/x-www-form-urlencoded`）：

```
grant_type=authorization_code
&code={authorization_code}
&redirect_uri={redirect_uri}
&client_id={client_id}
&code_verifier={code_verifier}
```

**流程**：

1. 从 DB 查找 `authorization_code` → 验证未过期、未使用
2. 验证 `redirect_uri` 和 `client_id` 与授权时一致
3. 验证 PKCE：`base64url(SHA256(code_verifier)) === code_challenge`
4. **原子标记** `authorization_code` 为已使用 — 必须使用 DynamoDB 条件写入（`ConditionExpression: "used = :false"`）防止并发兑换。若条件失败返回 `400 invalid_grant`
5. 为用户创建 child delegate：
   - `parentId` = 用户的 root delegate（通过 `getOrCreateRoot`）
   - `name` = `"MCP: {client_id}"`
   - 权限由 `scope` 映射：
     - `cas:read` → 只读（默认）
     - `cas:write` → `canUpload = true`
     - `depot:manage` → `canManageDepot = true`
   - `depth` = 1
6. 调用 `generateTokenPair()` 生成 delegate AT + RT
7. 返回标准 OAuth 响应

**响应**：

```json
{
  "access_token": "{base64_delegate_AT}",
  "refresh_token": "{base64_delegate_RT}",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "cas:read cas:write"
}
```

**复用**：delegate 创建逻辑复用 `controllers/delegates.ts`，token 生成复用 `@casfa/delegate-token`。

#### 2b. `grant_type=refresh_token`

**请求**：

```
grant_type=refresh_token
&refresh_token={base64_delegate_RT}
&client_id={client_id}
```

**流程**：与现有 `POST /api/auth/refresh` 底层逻辑完全相同：

1. base64 解码 RT → 24-byte binary
2. `decodeToken()` → 提取 `delegateId`
3. 查找 Delegate → 验证未撤销、RT hash 匹配
4. `generateTokenPair()` → `rotateTokens()` 原子条件更新
5. 返回标准 OAuth 响应格式（同上）

**工作量**：中（auth code 兑换）+ 小（refresh，复用现有逻辑）

---

### Phase 3: `/auth/refresh` 调整

**结论：保持现有 `/auth/refresh` 不变，同时新增 `/auth/token` 端点处理 OAuth 标准刷新。**

#### 对比

| | `POST /api/auth/refresh`（现有） | `POST /api/auth/token`（新增） |
|---|---|---|
| **面向** | 内部客户端（CLI、SDK） | MCP / OAuth 第三方客户端 |
| **RT 传递** | `Authorization: Bearer {RT}` header | `refresh_token` body 参数 |
| **请求格式** | 无 body | `grant_type=refresh_token&refresh_token=...` |
| **响应格式** | `{refreshToken, accessToken, accessTokenExpiresAt, delegateId}` | `{access_token, refresh_token, token_type, expires_in}` |
| **底层逻辑** | 相同 | 相同 |

#### 重构：抽取共享逻辑

将 refresh 的核心逻辑抽取为可复用函数：

```typescript
// shared/delegate-refresh.ts
interface RefreshResult {
  newAccessToken: string;     // base64
  newRefreshToken: string;    // base64
  accessTokenExpiresAt: number;
  delegateId: string;
}

async function refreshDelegateToken(
  rtBytes: Uint8Array,
  deps: Deps
): Promise<RefreshResult> {
  const decoded = decodeToken(rtBytes);
  if (decoded.type !== "refresh") throw new InvalidTokenError();

  const delegate = await deps.delegates.get(decoded.delegateId);
  if (!delegate) throw new NotFoundError();
  if (delegate.depth === 0) throw new BadRequestError("Root delegates use JWT");
  if (delegate.isRevoked) throw new UnauthorizedError();

  const rtHash = computeTokenHash(rtBytes);
  if (rtHash !== delegate.currentRtHash) throw new UnauthorizedError();

  const { rt, at, atExpiresAt } = generateTokenPair(decoded.delegateId);
  const newRtHash = computeTokenHash(rt);
  const newAtHash = computeTokenHash(at);

  await deps.delegates.rotateTokens({
    delegateId: decoded.delegateId,
    expectedRtHash: rtHash,
    newRtHash,
    newAtHash,
    newAtExpiresAt: atExpiresAt,
  });

  return {
    newAccessToken: encodeBase64(at),
    newRefreshToken: encodeBase64(rt),
    accessTokenExpiresAt: atExpiresAt,
    delegateId: decoded.delegateId,
  };
}
```

两个端点各自只做格式适配：

```typescript
// POST /api/auth/refresh — 现有接口，保持兼容
const rtBytes = extractFromAuthHeader(c.req);
const result = await refreshDelegateToken(rtBytes, deps);
return c.json({
  refreshToken: result.newRefreshToken,
  accessToken: result.newAccessToken,
  accessTokenExpiresAt: result.accessTokenExpiresAt,
  delegateId: result.delegateId,
});

// POST /api/auth/token (grant_type=refresh_token) — 新接口
const rtBytes = base64Decode(body.refresh_token);
const result = await refreshDelegateToken(rtBytes, deps);
return c.json({
  access_token: result.newAccessToken,
  refresh_token: result.newRefreshToken,
  token_type: "Bearer",
  expires_in: 3600,
});
```

**工作量**：小 — 纯重构，无功能变更

---

### Phase 4: MCP Transport 适配

#### 4a. 认证中间件切换

现有 `POST /api/mcp` 使用两个中间件：`jwtAuthMiddleware` → `authorizedUserMiddleware`，需替换为 `accessTokenMiddleware`。

`accessTokenMiddleware` 已支持 JWT 和 delegate AT 双模式（通过判断 token 中是否包含 `.`），无需额外改动。

切换后：
- JWT 用户 → 走原有 JWT 路径，自动关联 root delegate
- delegate AT 用户 → 走 AT 路径，使用对应 delegate 的权限

**需同步修改的代码**：

1. **移除 `authorizedUserMiddleware`**：该中间件检查 `JwtAuthContext` 的用户 role 不是 `"unauthorized"`。对 delegate AT 路径不适用（delegate 本身就是已授权的代表）。如果仍需对 JWT 路径做 role 检查，可在 `accessTokenMiddleware` 的 JWT 分支中内联处理。

2. **修改 MCP handler 的 auth 类型检查**：当前 `mcp/handler.ts` 中 `handle` 入口有硬编码：
   ```typescript
   // 当前代码 — 必须移除
   if (auth.type !== "jwt") {
     return c.json({ error: "JWT authentication required" }, 403);
   }
   ```
   必须改为同时接受 `"jwt"` 和 `"access"` 两种 auth type。相应地，`handleToolsCall` 的参数类型需从 `JwtAuthContext` 改为 `AccessTokenAuthContext`（两种路径在 `accessTokenMiddleware` 后都会产出此类型）。

#### 4b. 权限检查与 Scope 隔离

MCP tools 需根据 delegate 权限决定可用性：

```typescript
server.tool("cas_read", ..., async (params, extra) => {
  // 所有 delegate 都可以读
});

server.tool("cas_write", ..., async (params, extra) => {
  // 需要 canUpload 权限
  if (!auth.canUpload) throw new ForbiddenError();
});
```

未来可在 `tools/list` 中根据当前 delegate 权限过滤返回的工具列表。

**Ownership 检查需改为 realm 隔离**：当前 `cas_read` 使用 `hasAnyOwnership(key)` 做数据访问控制，这是一个跨 realm 的检查 — 任何用户上传的节点都会返回 `true`。切换到 delegate AT 后，必须改为按 realm 过滤：

```typescript
// 当前（不安全）— 跨 realm 可读
const hasAccess = isWellKnownNode(key) || await ownershipV2Db.hasAnyOwnership(key);

// 应改为 — 按 realm 隔离
const hasAccess = isWellKnownNode(key) || await ownershipV2Db.hasOwnership(key, auth.realm);
```

否则用户 A 的 MCP 客户端可以读到用户 B 上传的数据，违反数据隔离原则。

#### 4c. Streamable HTTP（可选升级）

MCP 2025-03 推荐 Streamable HTTP transport。现有 `POST /api/mcp` 可扩展为：
- 单次请求仍返回 JSON
- 长时间操作返回 SSE 流（`Content-Type: text/event-stream`）
- 支持 `Mcp-Session-Id` header 维持会话

**工作量**：中 — 认证切换简单，Streamable HTTP 可后做

---

### Phase 5: 客户端注册（可选）

#### 方案 A：硬编码（推荐先行）

服务端配置中预注册已知客户端：

```typescript
const KNOWN_CLIENTS: Record<string, OAuthClient> = {
  "vscode-casfa-mcp": {
    clientId: "vscode-casfa-mcp",
    clientName: "VS Code CASFA MCP",
    redirectUris: [
      "http://localhost:*/callback",  // VS Code 本地回调
      "vscode://casfa.mcp/callback",  // VS Code URI scheme
    ],
    grantTypes: ["authorization_code", "refresh_token"],
    tokenEndpointAuthMethod: "none",
  },
};
```

#### 方案 B：动态注册 (RFC 7591)

**新增** `POST /api/auth/register`

```json
// Request
{
  "client_name": "My MCP Client",
  "redirect_uris": ["http://localhost:3000/callback"],
  "grant_types": ["authorization_code", "refresh_token"],
  "token_endpoint_auth_method": "none"
}

// Response (201)
{
  "client_id": "dyn_{random}",
  "client_name": "My MCP Client",
  "redirect_uris": ["http://localhost:3000/callback"],
  "grant_types": ["authorization_code", "refresh_token"],
  "token_endpoint_auth_method": "none",
  "client_id_issued_at": 1739462400
}
```

MCP 2025-03 规范要求支持动态客户端注册，但初期可先用方案 A。

**工作量**：A 极小 / B 小

---

## 数据模型变更

### 新增：AuthorizationCode

| 字段 | 类型 | 说明 |
|------|------|------|
| `code` | string | 随机 128-bit, URL-safe base64 |
| `clientId` | string | 发起客户端 |
| `redirectUri` | string | 回调地址 |
| `userId` | string | 授权用户 |
| `realm` | string | 授权 realm |
| `scopes` | string[] | 用户确认后的最终 scope 列表 |
| `codeChallenge` | string | PKCE challenge |
| `codeChallengeMethod` | `"S256"` | 固定 |
| `grantedPermissions` | object | 用户在授权页选择的权限（见下表） |
| `createdAt` | number | 创建时间 |
| `expiresAt` | number | 过期时间 (10 min) |
| `used` | boolean | 是否已兑换 |

`grantedPermissions` 子字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `canUpload` | boolean | 用户授权的上传权限 |
| `canManageDepot` | boolean | 用户授权的 depot 管理权限 |
| `delegatedDepots` | string[]? | 用户选定的 depot 白名单 |
| `scopeNodeHash` | string? | 用户选定的 scope 子树 |
| `expiresIn` | number? | 用户选定的过期时间（秒） |

**DynamoDB**：复用 `tokensTable`，`PK=AUTHCODE#{code}`, `SK=METADATA`，设置 TTL 自动清理。

### 新增（可选）：OAuthClient

| 字段 | 类型 | 说明 |
|------|------|------|
| `clientId` | string | 客户端 ID |
| `clientName` | string | 显示名称 |
| `redirectUris` | string[] | 允许的回调地址 |
| `grantTypes` | string[] | 允许的授权类型 |
| `tokenEndpointAuthMethod` | `"none"` | public client |
| `createdAt` | number | 注册时间 |

仅在实现动态注册时需要。硬编码方式不需要此表。

---

## 路由总览（变更后）

```
/.well-known/oauth-authorization-server/api/auth  [GET]  Phase 0 — 新增 (根路径)

/api/auth/
├── authorize                                [GET]   Phase 1 — 新增
├── token                                    [POST]  Phase 2 — 新增
├── refresh                                  [POST]  现有，保持不变
└── register                                 [POST]  Phase 5 — 可选新增

/api/oauth/   ← 不动，Cognito 代理
/api/local/   ← 不动，本地开发
/api/mcp      ← Phase 4 切换认证中间件
```

---

## 授权 Delegate 的 Scope 与权限控制

OAuth 授权流程中创建的 delegate 完全复用现有的 delegate 权限体系，权限可以在 **两个层面** 精细控制。

### 现有 Delegate 权限模型

每个 Delegate 实体包含以下权限字段：

| 字段 | 类型 | 含义 |
|------|------|------|
| `canUpload` | boolean | 能否上传新 CAS 节点 |
| `canManageDepot` | boolean | 能否创建/删除/提交 depot |
| `delegatedDepots` | string[] | 可管理的 depot 白名单（⊆ 父级） |
| `scopeNodeHash` | string? | 单一 scope：授权子树的根节点 hash |
| `scopeSetNodeId` | string? | 多 scope：引用 ScopeSetNode 记录 |
| `expiresAt` | number? | 过期时间（epoch ms） |
| `depth` | number | 委托深度（0=root, 最大 15） |

**核心约束：child ≤ parent**，由 `validateCreateDelegate()` 强制执行：

| 检查项 | 规则 |
|--------|------|
| 权限 | `child.canUpload` 不能超过 `parent.canUpload`，`canManageDepot` 同理 |
| Depot | `child.delegatedDepots ⊆ parent` 可管理的 depot 集合 |
| 过期 | 若 parent 有 `expiresAt`，child 必须有且 ≤ parent |
| 深度 | `parent.depth + 1 ≤ 15` |
| Scope | child 的 scope 只能是 parent scope 的子树 |

### 第一层控制：OAuth Scope → Delegate 权限映射

客户端在 OAuth 请求中通过 `scope` 参数声明需要的权限。服务端将 OAuth scope 字符串映射为 delegate 权限：

| OAuth Scope | Delegate 字段 | 说明 |
|-------------|---------------|------|
| `cas:read` | 默认（无特殊字段） | 只读访问 CAS 数据 |
| `cas:write` | `canUpload = true` | 可上传新 CAS 节点 |
| `depot:manage` | `canManageDepot = true` | 可管理 depot |
| `depot:{depotId}` | `delegatedDepots = [depotId]` | 限定可管理的特定 depot |
| `scope:{nodeHash}` | `scopeNodeHash = nodeHash` | 限定可访问的 CAS 子树 |

客户端只会获得它 **请求的** 权限，且不会超过用户 root delegate 的权限上限。

示例 — 只读 MCP 客户端：
```
GET /api/auth/authorize?scope=cas:read&...
```
→ 创建的 delegate：`canUpload=false, canManageDepot=false, scope=全量`

示例 — 可写但限定子树的 MCP 客户端：
```
GET /api/auth/authorize?scope=cas:read+cas:write+scope:abc123&...
```
→ 创建的 delegate：`canUpload=true, canManageDepot=false, scopeNodeHash=abc123`

### 第二层控制：授权确认页面（用户干预）

在 `/auth/authorize` 的授权确认页面上，用户可以 **进一步收窄** 客户端请求的权限：

```
┌──────────────────────────────────────────┐
│  授权 "VS Code CASFA MCP" 访问你的数据    │
│                                          │
│  请求的权限：                              │
│  ☑ 读取 CAS 数据          (cas:read)      │
│  ☐ 上传 CAS 数据          (cas:write)     │  ← 用户可取消勾选
│  ☐ 管理 Depot             (depot:manage)  │
│                                          │
│  Realm: [my-realm ▾]                     │
│                                          │
│  高级选项：                                │
│  ├ 过期时间: [30 天 ▾]                     │  ← 用户可缩短
│  └ 限定 Depot: [全部 ▾]                   │  ← 用户可选特定 depot
│                                          │
│         [拒绝]          [授权]            │
└──────────────────────────────────────────┘
```

用户的选择会记录到 `AuthorizationCode` 的 `grantedPermissions` 字段中（见 Phase 1 的接口定义），在 token 兑换时用于创建 delegate。

### 权限控制流程总结

```
                        客户端请求 scope
                              │
                    ┌─────────▼──────────┐
                    │  OAuth scope 解析   │
                    │  ────────────────   │
                    │  cas:read → 只读    │
                    │  cas:write → 可写   │
                    │  depot:manage → 管理│
                    └─────────┬──────────┘
                              │
                    ┌─────────▼──────────┐
                    │  用户授权确认页面    │
                    │  ────────────────   │
                    │  用户可以取消勾选    │
                    │  缩短过期时间       │
                    │  限定特定 depot     │
                    └─────────┬──────────┘
                              │
                    ┌─────────▼──────────┐
                    │  validateCreate     │
                    │  Delegate()         │
                    │  ────────────────   │
                    │  child ≤ parent     │
                    │  (root delegate)    │
                    └─────────┬──────────┘
                              │
                    ┌─────────▼──────────┐
                    │  创建 Child         │
                    │  Delegate           │
                    │  ────────────────   │
                    │  权限 = min(         │
                    │    scope 映射,       │
                    │    用户选择,          │
                    │    root 权限         │
                    │  )                   │
                    └─────────┬──────────┘
                              │
                    ┌─────────▼──────────┐
                    │  运行时权限检查      │
                    │  ────────────────   │
                    │  canUploadMiddleware │
                    │  canManageDepot...  │
                    │  scope 验证         │
                    └────────────────────┘
```

### MCP 工具级权限控制

Delegate 权限最终在 MCP 工具调用时生效：

```typescript
// tools/list 响应 — 根据当前 delegate 权限过滤可用工具
function getAvailableTools(auth: AccessTokenAuthContext) {
  const tools = [
    { name: "cas_read", description: "Read CAS blob" },  // 所有 delegate 都可见
  ];

  if (auth.canUpload) {
    tools.push({ name: "cas_write", description: "Upload CAS blob" });
  }

  if (auth.canManageDepot) {
    tools.push({ name: "depot_create", description: "Create a depot" });
    tools.push({ name: "depot_commit", description: "Commit to a depot" });
  }

  return tools;
}

// tools/call 执行时再次验证权限（双重保障）
server.tool("cas_write", ..., async (params, extra) => {
  const auth = getAuthContext(extra);
  if (!auth.canUpload) {
    return { content: [{ type: "text", text: "Permission denied: cas:write scope required" }], isError: true };
  }
  // ... 执行写入
});
```

### 撤销与管理

用户可以在 dashboard 上管理所有通过 OAuth 授权创建的 delegate：

- **查看**：列出所有 MCP delegate（通过 `name` 前缀 `"MCP: {client_id}"` 识别）
- **撤销**：单独撤销某个客户端的 delegate，该客户端的 AT/RT 立即失效
- **级联撤销**：如果 MCP delegate 又创建了子 delegate（如有），一并撤销
- **查看权限**：显示每个 delegate 的 `canUpload`, `canManageDepot`, `scope`, `expiresAt`

这些能力由现有的 `POST /api/realm/:realmId/delegates/:delegateId/revoke` 和 `GET /api/realm/:realmId/delegates` 提供，无需新增接口。

---

## 安全考虑

| 方面 | 措施 |
|------|------|
| PKCE | 强制 S256，public client 不使用 client_secret |
| redirect_uri | 严格全匹配，防止 code 截获 |
| authorization_code | 一次性，兑换使用 DynamoDB 条件写入原子标记 `used=true`，10 分钟过期 |
| delegate 权限 | MCP delegate 是 root 的 child，权限 ≤ root，scope 决定上限 |
| 独立撤销 | 用户可在 dashboard 单独撤销某个 MCP delegate，不影响其他客户端 |
| RT 轮换 | 每次刷新轮换 RT + AT，旧 RT 立即失效（现有机制） |
| state 参数 | 防 CSRF，客户端生成随机值，回调时验证一致 |

---

## 实施优先级

| 阶段 | 内容 | 工作量 | 依赖 |
|------|------|--------|------|
| Phase 0 | Metadata 端点 | 小 | 无 |
| Phase 1 | `/auth/authorize` + 前端授权页 | 中 | Phase 0 |
| Phase 2a | `/auth/token` (authorization_code) | 中 | Phase 1 |
| Phase 2b | `/auth/token` (refresh_token) | 小 | Phase 2a |
| Phase 3 | `/auth/refresh` 重构抽取共享逻辑 | 小 | Phase 2b |
| Phase 4 | MCP 认证中间件切换 | 中 | Phase 2a |
| Phase 5 | 动态客户端注册 | 小 | Phase 0 |

建议先完成 Phase 0 → 1 → 2a → 4，形成最小可用链路，再补齐其余部分。

---

## MCP Tools 规划

### 工具总览

基于现有后端能力，MCP Server 将分阶段暴露以下工具：

| 工具 | 说明 | 所需权限 | 阶段 |
|------|------|----------|------|
| **`list_depots`** | 列出用户的所有 depot | 无（只读） | v0.1 ✅ |
| `get_depot` | 获取单个 depot 详情 | 无 | v0.2 |
| `ls` | 列出 depot 根节点下的文件/目录 | 无 | v0.2 |
| `read_file` | 读取文件内容 | 无 | v0.2 |
| `stat` | 获取文件/目录元数据 | 无 | v0.2 |
| `create_depot` | 创建新 depot | `depot:manage` | v0.3 |
| `write_file` | 写入文件 | `cas:write` | v0.3 |
| `mkdir` | 创建目录 | `cas:write` | v0.3 |
| `rm` | 删除文件/目录 | `cas:write` | v0.3 |
| `mv` | 移动/重命名 | `cas:write` | v0.3 |
| `cp` | 复制 | `cas:write` | v0.3 |
| `commit` | 提交 depot 更新 | `cas:write` | v0.3 |
| `cas_read` | 读取原始 CAS blob（按 hex key） | 无 | v0.4 |
| `cas_write` | 上传原始 CAS blob | `cas:write` | v0.4 |
| `list_delegates` | 列出 delegate 列表 | 无 | v0.4 |

### v0.1 — 最小验证 (当前实现)

仅实现 `list_depots` 工具：

```typescript
// list_depots — 列出用户所有 depot
{
  name: "list_depots",
  description: "List all depots in the user's realm",
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },
}
```

**响应示例**：
```json
{
  "content": [{
    "type": "text",
    "text": "[{\"depotId\":\"dep_xxx\",\"title\":\"My Depot\",\"root\":\"nod_xxx\",\"updatedAt\":1739462400}]"
  }]
}
```

用于验证：
1. OAuth 登录流程完整可用
2. delegate AT 鉴权正常工作
3. MCP JSON-RPC 协议正确处理
4. 从 delegate 的 realm 正确获取数据

### v0.2 — 只读文件系统

增加基于 depot 的文件浏览能力：
- `get_depot` — 获取 depot 详情（root hash、history）
- `ls` — 列出目录内容（传入 depot ID + 路径）
- `read_file` — 读取文件内容（传入 depot ID + 路径）
- `stat` — 获取元数据

### v0.3 — 写入操作

增加写入能力，需要 `canUpload` / `canManageDepot` 权限：
- `create_depot` / `write_file` / `mkdir` / `rm` / `mv` / `cp` / `commit`
- 写操作需要 proof validation

### v0.4 — 高级操作

- 原始 CAS 操作 (`cas_read`, `cas_write`)
- Delegate 管理 (`list_delegates`)
