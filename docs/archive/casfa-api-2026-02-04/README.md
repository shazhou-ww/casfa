# CASFA API 文档

CASFA (Content-Addressable Storage for Agents) 是一个为 AI Agent 设计的内容寻址存储服务 API。

## 概述

所有 API 路由均以 `/api` 为前缀。

## ID 格式规范

所有 128 位标识符使用 Crockford Base32 编码，固定 26 位字符。

| 类型 | 来源 | 格式 | 示例 |
|------|------|------|------|
| User ID | Cognito UUID | `user:{base32(uuid)}` | `user:A6JCHNMFWRT90AXMYWHJ8HKS90` |
| Ticket ID | 新创建 (ULID) | `ticket:{ulid}` | `ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC` |
| Depot ID | 新创建 (ULID) | `depot:{ulid}` | `depot:01HQXK5V8N3Y7M2P4R6T9W0ABC` |
| Client ID | P256 公钥 | `client:{blake3s(pubkey)}` | `client:A6JCHNMFWRT90AXMYWHJ8HKS90` |
| Token ID | Token 值 | `token:{blake3s(token)}` | `token:A6JCHNMFWRT90AXMYWHJ8HKS90` |
| Node Key | 内容 | `node:{blake3(content)}` | `node:abc123...` |

### Agent Token 格式

| 字段 | 格式 | 说明 |
|------|------|------|
| Token 值 | `casfa_{base32}` | 240-bit 随机数，Crockford Base32 编码（48 字符） |
| Token ID | `token:{hash}` | Token 值的 Blake3s 哈希 |

> 服务端不保存 Token 值，仅保存 Token ID（hash）。Token 值仅在创建时返回一次。

### Issuer ID 格式

Ticket 的 `issuerId` 根据创建方式使用不同格式：

| 创建方式 | 格式 | 说明 |
|---------|------|------|
| P256 Client | `client:{hash}` | 公钥的 Blake3s 哈希 |
| User Token | `user:{id}` | Cognito UUID 的 Base32 编码 |
| Agent Token | `token:{hash}` | Token 值的 Blake3s 哈希 |

> **注意**:
>
> - Node Key 使用统一的 hash 算法，不带算法前缀
> - Realm ID 等同于 User ID

## 时间格式规范

| 类型 | 格式 | 单位 | 示例 |
|------|------|------|------|
| 时间戳 | Unix epoch | 毫秒 (int64) | `1738497600000` (2025-02-02T08:00:00Z) |
| 持续时间 | 整数 | 秒 (int32) | `3600` (1 小时) |

### 字段命名约定

| 后缀 | 类型 | 示例 |
|------|------|------|
| `*At` | 时间戳（毫秒） | `createdAt`, `expiresAt`, `updatedAt` |
| `*In` | 持续时间（秒） | `expiresIn` |

## 路由表

### 服务信息

[详细文档](./00-info.md)

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/api/health` | 服务健康检查 | 无 |
| GET | `/api/info` | 获取服务配置信息 | 无 |

### OAuth 认证 API

[详细文档](./01-oauth.md)

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/api/oauth/config` | 获取 Cognito 配置 | 无 |
| POST | `/api/oauth/token` | 交换授权码获取 Token | 无 |
| POST | `/api/oauth/login` | 用户登录（邮箱密码） | 无 |
| POST | `/api/oauth/refresh` | 刷新 Token | 无 |
| GET | `/api/oauth/me` | 获取当前用户信息 | User Token |

### Auth 授权 API

[详细文档](./02-auth.md)

#### AWP 客户端管理

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| POST | `/api/auth/clients/init` | 初始化 AWP 客户端认证流程 | 无 |
| GET | `/api/auth/clients/status` | 轮询认证完成状态 | 无 |
| POST | `/api/auth/clients/complete` | 完成客户端授权 | User Token |
| GET | `/api/auth/clients` | 列出已授权的 AWP 客户端 | User Token |
| DELETE | `/api/auth/clients/:pubkey` | 撤销 AWP 客户端 | User Token |

#### Agent Token 管理

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| POST | `/api/auth/tokens` | 创建 Agent Token | User Token |
| GET | `/api/auth/tokens` | 列出 Agent Token | User Token |
| DELETE | `/api/auth/tokens/:id` | 撤销 Agent Token | User Token |

### Admin 管理 API

[详细文档](./03-admin.md)

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/api/admin/users` | 列出所有用户 | Admin |
| PATCH | `/api/admin/users/:userId` | 修改用户角色 | Admin |

### MCP 协议 API

[详细文档](./04-mcp.md)

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| POST | `/api/mcp` | MCP JSON-RPC 端点 | Agent/User Token |

### Realm CAS 操作 API

[详细文档](./05-realm/README.md)

需要 `Authorization` header（User/Agent Token）

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/api/realm/{realmId}` | 获取 Realm 端点信息 | User/Agent Token |
| GET | `/api/realm/{realmId}/usage` | 获取 Realm 使用统计 | User/Agent Token |
| POST | `/api/realm/{realmId}/prepare-nodes` | 预上传检查 | Write |
| GET | `/api/realm/{realmId}/nodes/:key/metadata` | 获取节点元信息 | Read |
| GET | `/api/realm/{realmId}/nodes/:key` | 获取节点二进制数据 | Read |
| PUT | `/api/realm/{realmId}/nodes/:key` | 上传节点 | Write |
| GET | `/api/realm/{realmId}/depots` | 列出所有 Depots | Read |
| POST | `/api/realm/{realmId}/depots` | 创建 Depot | Write |
| GET | `/api/realm/{realmId}/depots/:depotId` | 获取 Depot 详情（含 history） | Read |
| PATCH | `/api/realm/{realmId}/depots/:depotId` | 修改 Depot 元数据 | Write |
| POST | `/api/realm/{realmId}/depots/:depotId/commit` | 提交新 root | Write |
| DELETE | `/api/realm/{realmId}/depots/:depotId` | 删除 Depot | Write |

> **Ticket 访问**: Ticket 不再有独立路由，而是通过 `Authorization: Ticket` header 访问 Realm 路由的子集。详见 [Ticket 管理与认证](./05-realm/02-tickets.md)。

## 认证方式

CASFA 支持多种认证方式：

### 1. User Token

用户登录后获取的 JWT Token。

```http
Authorization: Bearer {userToken}
```

### 2. Agent Token

为 AI Agent 创建的长期访问令牌。

```http
Authorization: Agent {agentToken}
```

### 3. Ticket

临时访问凭证，通过 `Authorization` header 访问 Realm 路由的子集。

```http
Authorization: Ticket {ticketId}
```

> Ticket 认证受 scope 和 quota 限制，详见 [Ticket 管理与认证](./05-realm/02-tickets.md)。

### 4. AWP 签名

Agent Web Portal 客户端使用 P256 公钥签名认证。

```http
X-AWP-Pubkey: {publicKey}
X-AWP-Timestamp: {timestamp}
X-AWP-Signature: {signature}
```

## 用户角色

| 角色 | 描述 |
|------|------|
| `unauthorized` | 未授权用户，无法访问 CAS 资源 |
| `authorized` | 已授权用户，可以访问自己的 Realm |
| `admin` | 管理员，可以管理所有用户 |

## 错误响应

所有 API 在发生错误时返回统一格式：

```json
{
  "error": "错误代码",
  "message": "人类可读的错误描述",
  "details": { ... }
}
```

### 错误响应字段

| 字段 | 类型 | 描述 |
|------|------|------|
| `error` | `string` | 错误代码（机器可读，如 `invalid_request`, `missing_nodes`） |
| `message` | `string` | 错误描述（人类可读） |
| `details` | `object?` | 可选的附加信息 |

### 错误代码列表

| 错误代码 | HTTP 状态码 | 描述 |
|---------|------------|------|
| `invalid_request` | 400 | 请求参数错误 |
| `unauthorized` | 401 | 未认证或 Token 无效 |
| `forbidden` | 403 | 权限不足 |
| `not_found` | 404 | 资源不存在 |
| `conflict` | 409 | 资源状态冲突 |
| `gone` | 410 | 资源已过期或已撤销 |
| `quota_exceeded` | 413 | 超出配额限制 |
| `missing_nodes` | 400 | 引用的节点不存在 |
| `internal_error` | 500 | 服务器内部错误 |

### 示例

节点缺失错误：

```json
{
  "error": "missing_nodes",
  "message": "Referenced nodes are not present in storage",
  "details": {
    "missing": ["node:abc123...", "node:def456..."]
  }
}
```

### HTTP 状态码

| 状态码 | 描述 |
|--------|------|
| 400 | 请求参数错误 |
| 401 | 未认证 |
| 403 | 权限不足 |
| 404 | 资源不存在 |
| 409 | 资源冲突 |
| 410 | 资源已过期（如 Ticket） |
| 413 | 超出配额限制 |
| 500 | 服务器内部错误 |

## 限流策略

为保护服务稳定性，API 实施以下限流策略：

| 端点类别 | 限制 | 窗口 | 维度 |
|---------|------|------|------|
| OAuth 端点 | 10 req | 1 min | Per IP |
| Auth 轮询 (`/status`) | 1 req | 5 sec | Per pubkey |
| Realm 操作 | 100 req | 1 min | Per user |
| Node 上传 | 60 req | 1 min | Per realm |
| MCP 调用 | 300 req | 1 min | Per token |
| Admin 操作 | 30 req | 1 min | Per admin |

### 限流响应

超出限制时返回 `429 Too Many Requests`：

```json
{
  "error": "rate_limit_exceeded",
  "message": "Too many requests",
  "details": {
    "retryAfter": 30
  }
}
```

响应头包含限流信息：

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1738497660
Retry-After: 30
```

## 幂等性保证

### 幂等操作

以下操作是幂等的，可以安全重试：

| 操作 | 幂等性 | 说明 |
|------|--------|------|
| `GET` 所有端点 | ✅ 幂等 | 读取操作 |
| `PUT /nodes/:key` | ✅ 幂等 | 相同内容产生相同 key |
| `POST /prepare-nodes` | ✅ 幂等 | 检查 + touch 操作 |
| `DELETE` 资源 | ✅ 幂等 | 重复删除返回成功 |

### 非幂等操作

以下操作不是幂等的，重复调用可能产生不同结果：

| 操作 | 幂等性 | 说明 |
|------|--------|------|
| `POST /tickets` | ❌ 非幂等 | 每次创建新 Ticket |
| `POST /tokens` | ❌ 非幂等 | 每次创建新 Token |
| `POST /depots/:id/commit` | ❌ 非幂等 | 改变 history 栈 |
| `POST /tickets/:id/commit` | ⚠️ 仅一次 | 成功后不可重复 |

### 重试建议

1. **网络错误**: 幂等操作可直接重试，非幂等操作需检查资源状态
2. **5xx 错误**: 使用指数退避重试（1s, 2s, 4s...）
3. **429 错误**: 等待 `Retry-After` 指定的秒数后重试

## 相关文档

- [OAuth 认证 API](./01-oauth.md)
- [Auth 授权 API](./02-auth.md)
- [Admin 管理 API](./03-admin.md)
- [MCP 协议 API](./04-mcp.md)
- [Realm CAS 操作 API](./05-realm/README.md)
  - [Ticket 管理与认证](./05-realm/02-tickets.md)
