# Auth API

OAuth 2.1 授权服务器 + Delegate Token 刷新。

客户端（MCP Server、IDE 插件、CLI 工具等）通过标准 OAuth 2.1 Authorization Code + PKCE 流程获取 Delegate Token，用于访问 CAS 数据。

## 端点列表

### Well-Known 元数据

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/.well-known/oauth-authorization-server` | OAuth 2.1 授权服务器元数据 (RFC 8414) | 无 |
| GET | `/.well-known/oauth-protected-resource` | 受保护资源元数据 (RFC 9728) | 无 |

### OAuth 2.1 授权

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| POST | `/api/auth/register` | 动态客户端注册 (RFC 7591) | 无 |
| GET | `/api/auth/authorize/info` | 获取授权请求信息（供前端 consent 页面使用） | 无 |
| POST | `/api/auth/authorize` | 批准授权请求，生成 authorization code | User JWT |
| POST | `/api/auth/token` | Token 端点：授权码换 Token / 刷新 Token | 无 |

### 内部 Token 刷新

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| POST | `/api/auth/refresh` | 旋转 RT → 新 RT + AT（内部二进制格式） | Refresh Token (Bearer) |

---

## OAuth 2.1 授权流程

### 概述

CASFA 实现标准 OAuth 2.1 Authorization Code + PKCE 流程，用于为外部客户端颁发 Delegate Token：

```
┌───────────┐                         ┌───────────┐                    ┌────────┐
│  Client   │                         │  Server   │                    │  User  │
└─────┬─────┘                         └─────┬─────┘                    └────┬───┘
      │                                     │                               │
      │ 1. POST /api/auth/register          │                               │
      │     (可选，动态客户端注册)            │                               │
      │────────────────────────────────────>│                               │
      │ ← { client_id }                    │                               │
      │                                     │                               │
      │ 2. 生成 code_verifier + challenge   │                               │
      │    打开浏览器 → /oauth/authorize     │                               │
      │─────────────────────────────────────────────────────────────────── >│
      │                                     │                               │
      │                                     │ 3. 前端 GET authorize/info     │
      │                                     │    展示 consent UI             │
      │                                     │<──────────────────────────────│
      │                                     │                               │
      │                                     │ 4. 用户批准                     │
      │                                     │    POST /api/auth/authorize    │
      │                                     │<──────────────────────────────│
      │                                     │ → redirect_uri?code=...       │
      │                                     │──────────────────────────────>│
      │                                     │                               │
      │ 5. 浏览器回调 redirect_uri?code=... │                               │
      │<────────────────────────────────────────────────────────────────────│
      │                                     │                               │
      │ 6. POST /api/auth/token             │                               │
      │    grant_type=authorization_code     │                               │
      │    code + code_verifier              │                               │
      │────────────────────────────────────>│                               │
      │ ← { access_token, refresh_token }   │                               │
      │                                     │                               │
      │ 7. 使用 AT 访问 CAS API             │                               │
      │────────────────────────────────────>│                               │
```

### Scopes

| Scope | 说明 | 映射权限 |
|-------|------|----------|
| `cas:read` | 读取 CAS 存储内容 | 始终授予 |
| `cas:write` | 上传和写入内容 | `canUpload: true` |
| `depot:manage` | 创建和管理 Depot | `canManageDepot: true` |

---

## GET /.well-known/oauth-authorization-server

OAuth 2.1 授权服务器元数据（RFC 8414）。

### 响应

```json
{
  "issuer": "https://example.com/api/auth",
  "authorization_endpoint": "https://example.com/oauth/authorize",
  "token_endpoint": "https://example.com/api/auth/token",
  "registration_endpoint": "https://example.com/api/auth/register",
  "token_endpoint_auth_methods_supported": ["none"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "response_types_supported": ["code"],
  "code_challenge_methods_supported": ["S256"],
  "scopes_supported": ["cas:read", "cas:write", "depot:manage"]
}
```

---

## GET /.well-known/oauth-protected-resource

受保护资源元数据（RFC 9728）。

### 响应

```json
{
  "resource": "https://example.com/api/mcp",
  "authorization_servers": ["https://example.com"],
  "scopes_supported": ["cas:read", "cas:write", "depot:manage"],
  "bearer_methods_supported": ["header"]
}
```

---

## POST /api/auth/register

动态客户端注册（RFC 7591）。客户端在发起 OAuth 流程前先注册获取 `client_id`。

> **预注册客户端**：部分客户端（如 `vscode-casfa-mcp`）已硬编码注册，无需调用此端点。

### 请求

```http
POST /api/auth/register
Content-Type: application/json

{
  "client_name": "My MCP Client",
  "redirect_uris": ["http://127.0.0.1:3000/callback"],
  "grant_types": ["authorization_code", "refresh_token"]
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `client_name` | `string` | 否 | 客户端显示名称 |
| `redirect_uris` | `string[]` | 是 | 回调 URI 列表（必须是 localhost 或 HTTPS） |
| `grant_types` | `string[]` | 否 | 授权类型（默认 `["authorization_code", "refresh_token"]`） |

### 响应（201）

```json
{
  "client_id": "dyn_01HQXK5V8N...",
  "client_name": "My MCP Client",
  "redirect_uris": ["http://127.0.0.1:3000/callback"],
  "grant_types": ["authorization_code", "refresh_token"],
  "token_endpoint_auth_method": "none",
  "client_id_issued_at": 1738497600
}
```

---

## GET /api/auth/authorize/info

获取授权请求的详细信息，供前端 consent 页面渲染。

### 请求

```http
GET /api/auth/authorize/info?response_type=code&client_id=dyn_xxx&redirect_uri=http://127.0.0.1:3000/callback&scope=cas:read%20cas:write&state=abc123&code_challenge=xxx&code_challenge_method=S256
```

### 查询参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `response_type` | `string` | 是 | 固定为 `code` |
| `client_id` | `string` | 是 | 客户端 ID |
| `redirect_uri` | `string` | 是 | 回调 URI（必须与注册一致） |
| `scope` | `string` | 是 | 空格分隔的 scope 列表 |
| `state` | `string` | 是 | 客户端状态字符串 |
| `code_challenge` | `string` | 是 | PKCE code challenge |
| `code_challenge_method` | `string` | 是 | 固定为 `S256` |

### 响应

```json
{
  "client": {
    "clientId": "dyn_01HQXK5V8N...",
    "clientName": "My MCP Client"
  },
  "scopes": [
    { "name": "cas:read", "description": "Read content from your CAS storage" },
    { "name": "cas:write", "description": "Upload and write content to your CAS storage" }
  ],
  "state": "abc123",
  "redirectUri": "http://127.0.0.1:3000/callback",
  "codeChallenge": "xxx",
  "codeChallengeMethod": "S256"
}
```

### 错误

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `invalid_client` | 400 | client_id 无效 |
| `invalid_redirect_uri` | 400 | redirect_uri 与注册不匹配 |
| `invalid_scope` | 400 | 请求了不支持的 scope |

---

## POST /api/auth/authorize

批准授权请求，生成 authorization code。需要 **User JWT** 认证（用户在浏览器中已登录）。

前端 consent 页面在用户点击「批准」后调用此端点。

### 请求

```http
POST /api/auth/authorize
Authorization: Bearer {jwt}
Content-Type: application/json

{
  "clientId": "dyn_01HQXK5V8N...",
  "redirectUri": "http://127.0.0.1:3000/callback",
  "scopes": ["cas:read", "cas:write"],
  "state": "abc123",
  "codeChallenge": "xxx",
  "codeChallengeMethod": "S256",
  "realm": "usr_abc123",
  "grantedPermissions": {
    "canUpload": true,
    "canManageDepot": false,
    "delegatedDepots": ["dpt_xxx"],
    "scopeNodeHash": "nod_SCOPE_ROOT...",
    "expiresIn": 86400
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `clientId` | `string` | 是 | 客户端 ID |
| `redirectUri` | `string` | 是 | 回调 URI |
| `scopes` | `string[]` | 是 | 授予的 scope 列表 |
| `state` | `string` | 是 | 客户端状态字符串 |
| `codeChallenge` | `string` | 是 | PKCE code challenge |
| `codeChallengeMethod` | `string` | 是 | 固定为 `S256` |
| `realm` | `string` | 是 | 目标 Realm ID |
| `grantedPermissions` | `object` | 否 | 授予的权限细节（见下） |

#### grantedPermissions

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `canUpload` | `boolean` | 否 | 允许上传（默认由 scope 映射决定） |
| `canManageDepot` | `boolean` | 否 | 允许管理 Depot |
| `delegatedDepots` | `string[]` | 否 | 可操作的 Depot 列表（白名单） |
| `scopeNodeHash` | `string` | 否 | Scope root 节点（限制数据访问范围） |
| `expiresIn` | `number` | 否 | Delegate 有效期（秒） |

### 响应

```json
{
  "redirect_uri": "http://127.0.0.1:3000/callback?code=AUTH_CODE_xxx&state=abc123"
}
```

> Authorization code 有效期 10 分钟，一次性使用。

---

## POST /api/auth/token

OAuth 2.1 Token 端点。支持两种 grant type。

接受 `application/x-www-form-urlencoded` 或 `application/json` 格式。

### grant_type=authorization_code

用 authorization code + PKCE code_verifier 换取 Token。

#### 请求

```http
POST /api/auth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&code=AUTH_CODE_xxx&redirect_uri=http://127.0.0.1:3000/callback&client_id=dyn_xxx&code_verifier=xxx
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `grant_type` | `string` | 是 | `authorization_code` |
| `code` | `string` | 是 | 授权码 |
| `redirect_uri` | `string` | 是 | 回调 URI（必须与授权请求一致） |
| `client_id` | `string` | 是 | 客户端 ID |
| `code_verifier` | `string` | 是 | PKCE code verifier |

#### 响应

```json
{
  "access_token": "base64...",
  "refresh_token": "base64...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "cas:read cas:write"
}
```

> Token 交换时自动在用户的 root delegate 下创建子 delegate，其权限由 `grantedPermissions` 和 scope 映射决定。

### grant_type=refresh_token

用 refresh token 换取新的 Token 对。

#### 请求

```http
POST /api/auth/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&refresh_token=base64...
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `grant_type` | `string` | 是 | `refresh_token` |
| `refresh_token` | `string` | 是 | Refresh Token（Base64 编码） |

#### 响应

```json
{
  "access_token": "base64...",
  "refresh_token": "base64...",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

### Token 端点错误

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `invalid_grant` | 400 | 授权码无效、已过期或已使用 |
| `invalid_client` | 400 | client_id 无效 |
| `invalid_request` | 400 | 缺少必要参数 |
| `unsupported_grant_type` | 400 | 不支持的 grant_type |

---

## POST /api/auth/refresh

使用 Refresh Token 旋转获取新的 RT + AT 对（内部二进制格式）。

> **与 OAuth Token 端点的区别**：此端点返回 CASFA 内部格式（含 `delegateId`、`accessTokenExpiresAt` 等字段），适用于通过 `POST /realm/{realmId}/delegates` 直接创建的 delegate。OAuth 客户端应使用 `POST /api/auth/token` 的 `grant_type=refresh_token`。两种 refresh 方式底层共享同一旋转逻辑。

### 机制

1. 从 Authorization header 解析 24 字节 RT（Base64 编码）
2. 从 RT 中提取 delegateId
3. 验证 RT hash 与 delegate 存储的 `currentRtHash` 匹配
4. 生成新 RT + AT 对
5. 原子条件更新：`SET newHashes WHERE currentRtHash = oldHash`
6. 返回新 Token

> **一次性使用**：每个 RT 只能使用一次。使用后旧 RT 失效，必须使用新返回的 RT。如果 RT 被重放（旧 RT 再次使用），请求会被拒绝但 delegate 不会被自动撤销。

### 请求

```http
POST /api/auth/refresh
Authorization: Bearer {base64_encoded_rt}
```

> 注意：RT 通过 Authorization header 传递，请求体为空。

### 响应

```json
{
  "refreshToken": "base64_new_rt...",
  "accessToken": "base64_new_at...",
  "accessTokenExpiresAt": 1738501200000,
  "delegateId": "dlt_01HQXK5V8N3Y7M2P4R6T9W0ABC"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `refreshToken` | `string` | 新 Refresh Token（Base64 编码的 24 字节） |
| `accessToken` | `string` | 新 Access Token（Base64 编码的 32 字节） |
| `accessTokenExpiresAt` | `number` | AT 过期时间（epoch 毫秒），默认 1 小时 |
| `delegateId` | `string` | 关联的 Delegate ID |

### 错误

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `UNAUTHORIZED` | 401 | 缺少 Authorization header |
| `INVALID_TOKEN_FORMAT` | 401 | RT 不是有效的 24 字节 Base64 |
| `NOT_REFRESH_TOKEN` | 400 | 传入的是 AT（32 字节）而非 RT |
| `ROOT_REFRESH_NOT_ALLOWED` | 400 | Root delegate (depth=0) 使用 JWT，不需要 refresh |
| `DELEGATE_NOT_FOUND` | 401 | Delegate 不存在 |
| `DELEGATE_REVOKED` | 401 | Delegate 已被撤销 |
| `DELEGATE_EXPIRED` | 401 | Delegate 已过期 |
| `TOKEN_INVALID` | 401 | RT hash 不匹配（可能被重放） |
| `TOKEN_INVALID` | 409 | 并发 refresh 冲突 |

---

## 安全说明

1. **强制 PKCE**：所有 OAuth 授权流程必须使用 PKCE（code_challenge_method=S256），防止授权码拦截攻击
2. **Authorization code 一次性**：10 分钟有效期，原子消费防止重放
3. **Redirect URI 验证**：必须是 localhost 或 HTTPS，且与注册时一致
4. **Token 是敏感凭证**：RT 和 AT 应当像密码一样保护，不要记录到日志
5. **RT 一次性使用**：每次 refresh 都会旋转 RT，旧 RT 立即失效
6. **并发安全**：使用条件更新保证同一时间只有一个 refresh 请求成功
7. **Root Delegate 无 Token**：Root 直接使用 JWT，不存在 Token 泄漏风险
8. **合理设置有效期**：AT 默认 1 小时，Delegate 可自定义过期时间
