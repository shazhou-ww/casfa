# API 改动清单

> 版本: 1.0  
> 日期: 2026-02-05

---

## 目录

1. [概述](#1-概述)
2. [废弃的 API](#2-废弃的-api)
3. [新增的 API](#3-新增的-api)
4. [修改的 API](#4-修改的-api)
5. [认证方式变更](#5-认证方式变更)
6. [迁移指南](#6-迁移指南)

---

## 1. 概述

### 1.1 变更范围

本次重构将现有的多种认证方式统一为 Delegate Token 体系：

| 现有认证方式 | 新认证方式 | 状态 |
|-------------|-----------|------|
| User Token (JWT) | User Token (JWT) | **保留** - 仅用于 OAuth 和 Token 管理 |
| Agent Token (`casfa_xxx`) | Delegate Token (再授权) | **替换** |
| AWP Client (P256 签名) | Delegate Token (再授权) | **废弃** |
| Ticket (`ticket:xxx`) | Access Token | **替换** |

### 1.2 路由前缀变更

| 旧前缀 | 新前缀 | 说明 |
|--------|--------|------|
| `/api/auth/clients/*` | - | 废弃 |
| `/api/auth/tokens/*` | `/api/tokens/*` | 移至顶层，改为 Delegate Token |
| - | `/api/tokens/delegate` | 新增转签发 API |

---

## 2. 废弃的 API

### 2.1 AWP 客户端管理（全部废弃）

P256 公钥认证方式完全废弃，统一使用 Delegate Token。

| 方法 | 路径 | 描述 | 状态 |
|------|------|------|------|
| POST | `/api/auth/clients/init` | 初始化认证流程 | ❌ 废弃 |
| GET | `/api/auth/clients/:clientId` | 获取客户端状态 | ❌ 废弃 |
| POST | `/api/auth/clients/complete` | 完成授权 | ❌ 废弃 |
| GET | `/api/auth/clients` | 列出已授权客户端 | ❌ 废弃 |
| DELETE | `/api/auth/clients/:clientId` | 撤销客户端 | ❌ 废弃 |

**迁移方案**：使用 `/api/tokens` 创建 Delegate Token 替代。

### 2.2 旧 Agent Token 管理（路径变更）

旧的 Agent Token API 路径变更为 `/api/tokens`，格式和语义都有改变。

| 方法 | 旧路径 | 状态 |
|------|--------|------|
| POST | `/api/auth/tokens` | ❌ 废弃，改用 `/api/tokens` |
| GET | `/api/auth/tokens` | ❌ 废弃，改用 `/api/tokens` |
| DELETE | `/api/auth/tokens/:id` | ❌ 废弃，改用 `/api/tokens/:id/revoke` |

### 2.3 废弃的认证 Header

| 旧格式 | 状态 |
|--------|------|
| `Authorization: Agent {token}` | ❌ 废弃 |
| `Authorization: Ticket {ticketId}` | ❌ 废弃 |
| `X-AWP-Pubkey` / `X-AWP-Signature` | ❌ 废弃 |

---

## 3. 新增的 API

### 3.1 Delegate Token 管理

#### POST /api/tokens

创建 Delegate Token（用户直接签发）。

**请求**：
```json
{
  "type": "delegate" | "access",
  "expiresIn": 2592000,
  "canUpload": true,
  "canManageDepot": true,
  "realm": "usr_abc123",
  "scope": ["cas://depot:MAIN"]
}
```

**响应**：
```json
{
  "tokenId": "dlt1_4xzrt7y2m5k9bqwp3fnhjc6d",
  "tokenBase64": "SGVsbG8gV29ybGQh...",
  "expiresAt": "2026-03-07T00:00:00Z"
}
```

> **重要**：`tokenBase64` 是完整 Token 的 Base64 编码（128 字节），仅返回一次，客户端需妥善保管。

#### GET /api/tokens

列出当前用户的 Delegate Token。

**响应**：
```json
{
  "tokens": [
    {
      "tokenId": "dlt1_4xzrt7y2m5k9bqwp3fnhjc6d",
      "tokenType": "delegate",
      "expiresAt": 1741089600000,
      "createdAt": 1738497600000,
      "isRevoked": false,
      "depth": 0
    }
  ]
}
```

#### POST /api/tokens/:tokenId/revoke

撤销指定的 Delegate Token（级联撤销所有子 Token）。

**响应**：
```json
{
  "success": true,
  "revokedCount": 5
}
```

### 3.2 Token 转签发

#### POST /api/tokens/delegate

使用再授权 Token 转签发新 Token。

**请求**：
```http
Authorization: Bearer {base64_encoded_token}
Content-Type: application/json

{
  "type": "delegate" | "access",
  "expiresIn": 3600,
  "canUpload": true,
  "canManageDepot": false,
  "scope": [".:0:1", ".:0:2"]
}
```

**响应**：
```json
{
  "tokenId": "dlt1_7ynmq3kp2jdfhw8x9bcrt6vz",
  "tokenBase64": "SGVsbG8gV29ybGQh...",
  "expiresAt": "2026-02-05T01:00:00Z"
}
```

> **注意**：`scope` 使用相对 index-path 格式（如 `.:0:1`），是相对于父 Token scope 的子集。

### 3.3 Ticket 管理（简化）

#### POST /api/realm/{realmId}/tickets

创建 Ticket（需要再授权 Token）。

**变更**：
- 不再单独返回 Ticket ID，而是返回关联的 Access Token
- 权限由 Access Token 承载，Ticket 仅保留工作空间状态

**请求**：
```json
{
  "title": "Generate thumbnail",
  "expiresIn": 3600,
  "canUpload": true,
  "scope": [".:0:1"]
}
```

**响应**：
```json
{
  "ticketId": "ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC",
  "title": "Generate thumbnail",
  "status": "pending",
  "accessTokenId": "dlt1_xxxxx",
  "accessTokenBase64": "SGVsbG8gV29ybGQh...",
  "expiresAt": "2026-02-05T01:00:00Z"
}
```

#### POST /api/realm/{realmId}/tickets/:ticketId/submit

提交 Ticket（设置 root 并自动撤销 Access Token）。

**请求**：
```json
{
  "root": "node:result..."
}
```

**响应**：
```json
{
  "success": true,
  "status": "submitted",
  "root": "node:result..."
}
```

> **变更**：原 `/commit` 端点改为 `/submit`，submit 后 Access Token 自动撤销。

---

## 4. 修改的 API

### 4.1 Node 读取

#### GET /api/realm/{realmId}/nodes/:key

**变更**：
- 认证方式从 `Ticket` 改为 `Bearer` + Access Token
- 新增 `X-CAS-Index-Path` Header 用于 scope 验证

**请求**：
```http
GET /api/realm/{realmId}/nodes/:key
Authorization: Bearer {base64_encoded_token}
X-CAS-Index-Path: 0:1:2
```

| Header | 必选 | 说明 |
|--------|------|------|
| `Authorization` | 是 | 完整 Token 的 Base64 编码 |
| `X-CAS-Index-Path` | 是 | 证明节点在 scope 内的索引路径 |

### 4.2 Node 写入

#### PUT /api/realm/{realmId}/nodes/:key

**变更**：
- 认证方式从 `Ticket` 改为 `Bearer` + Access Token
- Quota 验证改为用户级别（Token 级别暂保留）

**请求**：
```http
PUT /api/realm/{realmId}/nodes/:key
Authorization: Bearer {base64_encoded_token}
Content-Type: application/octet-stream

(二进制数据)
```

### 4.3 Depot 操作

#### POST /api/realm/{realmId}/depots

**变更**：
- 认证方式从 `Bearer/Agent` 改为 `Bearer` + Access Token
- 新增 `creatorIssuerId` 记录创建者

**响应新增字段**：
```json
{
  "depotId": "depot:...",
  "creatorIssuerId": "dlt1_xxxxx",
  ...
}
```

#### PATCH/DELETE /api/realm/{realmId}/depots/:depotId

**变更**：
- 需要验证 Issuer Chain（只能操作自己创建的 Depot）

### 4.4 Ticket 状态查询

#### GET /api/realm/{realmId}/tickets/:ticketId

**响应格式变更**：

```json
{
  "ticketId": "ticket:...",
  "title": "Generate thumbnail",
  "status": "pending" | "submitted",
  "root": "node:...",
  "accessTokenId": "dlt1_xxxxx",
  "creatorTokenId": "dlt1_yyyyy",
  "createdAt": 1738497600000
}
```

**移除的字段**：
- `input` → 由 Access Token 的 scope 替代
- `output` → 改为 `root`
- `writable` → 由 Access Token 的 flags 替代
- `isRevoked` → 由 Access Token 状态判断
- `config` → 移至 Access Token

---

## 5. 认证方式变更

### 5.1 新认证格式

所有需要 Delegate Token 的 API 统一使用：

```http
Authorization: Bearer {base64_encoded_128_bytes}
```

**示例**：
```http
Authorization: Bearer SGVsbG8gV29ybGQhIFRoaXMgaXMgYSBiYXNlNjQgZW5jb2RlZCB0b2tlbi4uLg==
```

### 5.2 认证流程变更

| 阶段 | 旧流程 | 新流程 |
|------|--------|--------|
| 服务端存储 | 存储完整 Token | 只存储 Token ID (hash) |
| 客户端发送 | 发送 Token ID | 发送完整 Token (Base64) |
| 服务端验证 | 查询 Token 记录 | 计算 hash → 查询记录 |

### 5.3 Token 类型对照

| 旧认证 | 新认证 | 用途 |
|--------|--------|------|
| `Bearer {jwt}` | `Bearer {jwt}` | OAuth 用户认证（不变） |
| `Agent {casfa_xxx}` | `Bearer {base64}` | 再授权 Token |
| `Ticket {ticket:xxx}` | `Bearer {base64}` | 访问 Token |

---

## 6. 迁移指南

### 6.1 Agent Token 迁移

**旧代码**：
```typescript
const response = await fetch("/api/auth/tokens", {
  method: "POST",
  headers: { "Authorization": `Bearer ${jwtToken}` },
  body: JSON.stringify({ name: "My Agent", expiresIn: 2592000 })
});
const { token } = await response.json();
// token = "casfa_xxxxx"

// 使用
await fetch("/api/realm/xxx/nodes/yyy", {
  headers: { "Authorization": `Agent ${token}` }
});
```

**新代码**：
```typescript
const response = await fetch("/api/tokens", {
  method: "POST",
  headers: { "Authorization": `Bearer ${jwtToken}` },
  body: JSON.stringify({
    type: "delegate",
    expiresIn: 2592000,
    canUpload: true,
    canManageDepot: true,
    realm: "usr_abc123",
    scope: ["cas://depot:MAIN"]
  })
});
const { tokenBase64 } = await response.json();
// 保存 tokenBase64

// 使用（先转签发为访问 Token）
const accessResponse = await fetch("/api/tokens/delegate", {
  method: "POST",
  headers: { "Authorization": `Bearer ${tokenBase64}` },
  body: JSON.stringify({
    type: "access",
    expiresIn: 3600,
    scope: [".:0"]
  })
});
const { tokenBase64: accessToken } = await accessResponse.json();

await fetch("/api/realm/xxx/nodes/yyy", {
  headers: {
    "Authorization": `Bearer ${accessToken}`,
    "X-CAS-Index-Path": "0:1:2"
  }
});
```

### 6.2 Ticket 迁移

**旧代码**：
```typescript
// 创建 Ticket
const response = await fetch("/api/realm/xxx/tickets", {
  method: "POST",
  headers: { "Authorization": `Agent ${agentToken}` },
  body: JSON.stringify({
    input: ["node:abc..."],
    purpose: "Task",
    writable: { quota: 10485760 }
  })
});
const { ticketId } = await response.json();

// 使用 Ticket
await fetch("/api/realm/xxx/nodes/yyy", {
  headers: { "Authorization": `Ticket ${ticketId}` }
});
```

**新代码**：
```typescript
// 创建 Ticket（需要再授权 Token）
const response = await fetch("/api/realm/xxx/tickets", {
  method: "POST",
  headers: { "Authorization": `Bearer ${delegateTokenBase64}` },
  body: JSON.stringify({
    title: "Task",
    expiresIn: 3600,
    canUpload: true,
    scope: [".:0"]
  })
});
const { accessTokenBase64 } = await response.json();

// 使用 Access Token
await fetch("/api/realm/xxx/nodes/yyy", {
  headers: {
    "Authorization": `Bearer ${accessTokenBase64}`,
    "X-CAS-Index-Path": "0"
  }
});
```

### 6.3 AWP 客户端迁移

AWP 客户端需要完全重新设计：

1. 不再使用 P256 密钥对
2. 改为用户在 Web 端创建 Delegate Token
3. 将 Token 安全传递给客户端应用

---

## 附录 A: API 路由总览

### 保留的 API

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/info` | 服务信息 |
| GET | `/api/oauth/config` | OAuth 配置 |
| POST | `/api/oauth/token` | 交换授权码 |
| POST | `/api/oauth/login` | 用户登录 |
| POST | `/api/oauth/refresh` | 刷新 Token |
| GET | `/api/oauth/me` | 当前用户信息 |

### 新增的 API

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/api/tokens` | 创建 Delegate Token |
| GET | `/api/tokens` | 列出 Delegate Token |
| POST | `/api/tokens/:id/revoke` | 撤销 Token |
| POST | `/api/tokens/delegate` | 转签发 Token |

### 修改的 API

| 方法 | 路径 | 变更 |
|------|------|------|
| GET/PUT | `/api/realm/.../nodes/*` | 认证方式变更 |
| ALL | `/api/realm/.../depots/*` | 认证方式 + Issuer Chain |
| ALL | `/api/realm/.../tickets/*` | 认证方式 + 响应格式 |

### 废弃的 API

| 方法 | 路径 | 替代方案 |
|------|------|---------|
| ALL | `/api/auth/clients/*` | 使用 `/api/tokens` |
| ALL | `/api/auth/tokens/*` | 使用 `/api/tokens` |

---

## 附录 B: 错误码变更

### 新增错误码

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `INVALID_TOKEN_FORMAT` | 401 | Token Base64 格式无效 |
| `TOKEN_NOT_FOUND` | 401 | Token ID 不存在 |
| `TOKEN_REVOKED` | 401 | Token 已被撤销 |
| `TOKEN_EXPIRED` | 401 | Token 已过期 |
| `ACCESS_TOKEN_REQUIRED` | 403 | 需要访问 Token |
| `DELEGATE_TOKEN_REQUIRED` | 403 | 需要再授权 Token |
| `INDEX_PATH_REQUIRED` | 400 | 缺少 X-CAS-Index-Path |
| `NODE_NOT_IN_SCOPE` | 403 | 节点不在授权范围 |
| `DEPOT_ACCESS_DENIED` | 403 | 无权访问该 Depot |
| `MAX_DEPTH_EXCEEDED` | 400 | 超出最大转签发深度 |

### 废弃错误码

| 错误码 | 替代 |
|--------|------|
| `invalid_ticket` | `INVALID_TOKEN_FORMAT` |
| `ticket_expired` | `TOKEN_EXPIRED` |
| `ticket_revoked` | `TOKEN_REVOKED` |
