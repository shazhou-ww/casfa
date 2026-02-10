# API 改动清单

> 版本: 1.0  
> 日期: 2026-02-05

---

## 目录

1. [概述](#1-概述)
2. [新增的 API](#2-新增的-api)
3. [修改的 API](#3-修改的-api)
4. [认证方式变更](#4-认证方式变更)

---

## 1. 概述

### 1.1 变更范围

本次重构将现有的多种认证方式统一为 Delegate Token 体系：

| 认证方式 | 说明 |
|----------|------|
| User Token (JWT) | **保留** - 用于 OAuth 和 Token 管理 |
| Delegate Token | **新增** - 再授权 Token，可转签发 |
| Access Token | **新增** - 访问 Token，用于 CAS 操作 |

### 1.2 路由前缀

| 路由前缀 | 说明 |
|----------|------|
| `/api/tokens/*` | Token 管理（创建、列表、撤销） |
| `/api/tokens/requests/*` | 客户端授权申请流程 |
| `/api/tokens/delegate` | Token 转签发 |

### 1.3 认证 Header 格式

| Header 格式 | 用途 |
|-------------|------|
| `Authorization: Bearer {jwt}` | 用户认证（OAuth JWT） |
| `Authorization: Bearer {base64_token}` | Delegate/Access Token 认证 |

---

## 2. 新增的 API

### 2.1 客户端授权申请

> 详见 [06-client-auth-flow.md](./06-client-auth-flow.md)

客户端主动发起授权申请，用户在 Web 端审批并指定 Token 权限。

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| POST | `/api/tokens/requests` | 无 | 发起授权申请 |
| GET | `/api/tokens/requests/:requestId/poll` | 无 | 轮询申请状态（客户端侧） |
| GET | `/api/tokens/requests/:requestId` | User JWT | 查看申请详情（用户侧） |
| POST | `/api/tokens/requests/:requestId/approve` | User JWT | 批准申请 |
| POST | `/api/tokens/requests/:requestId/reject` | User JWT | 拒绝申请 |

> **注意**：授权申请不可枚举，只能通过精确 requestId 访问。

---

### 2.2 Delegate Token 管理

#### POST /api/tokens

用户直接创建 Delegate Token（无需客户端申请流程）。

**认证**：`Bearer {jwt}` (User Token)

**请求**：

```typescript
type CreateTokenRequest = {
  realm: string;           // 授权的 Realm ID
  name: string;            // Token 名称
  type: "delegate" | "access";
  expiresIn?: number;      // 有效期（秒），默认 30 天
  canUpload?: boolean;
  canManageDepot?: boolean;
  scope?: string[];        // 授权范围
};
```

**示例**：
```json
{
  "realm": "usr_abc123",
  "name": "My Token",
  "type": "delegate",
  "expiresIn": 2592000,
  "canUpload": true,
  "canManageDepot": true,
  "scope": ["cas://depot:MAIN"]
}
```

**响应**：
```json
{
  "tokenId": "dlt1_4xzrt7y2m5k9bqwp3fnhjc6d",
  "tokenBase64": "SGVsbG8gV29ybGQh...",
  "expiresAt": 1741089600000
}
```

> **重要**：`tokenBase64` 是完整 Token 的 Base64 编码（128 字节），仅返回一次，客户端需妥善保管。

---

#### GET /api/tokens

列出当前用户的 Delegate Token。

**认证**：`Bearer {jwt}` (User Token)

**查询参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `limit` | `number` | 每页数量，默认 20，最大 100 |
| `cursor` | `string` | 分页游标 |

**响应**：
```json
{
  "tokens": [
    {
      "tokenId": "dlt1_4xzrt7y2m5k9bqwp3fnhjc6d",
      "name": "My Token",
      "realm": "usr_abc123",
      "tokenType": "delegate",
      "expiresAt": 1741089600000,
      "createdAt": 1738497600000,
      "isRevoked": false,
      "depth": 0
    }
  ],
  "nextCursor": "xxx"
}
```

---

#### GET /api/tokens/:tokenId

获取单个 Token 详情。

**认证**：`Bearer {jwt}` (User Token)

**响应**：
```json
{
  "tokenId": "dlt1_4xzrt7y2m5k9bqwp3fnhjc6d",
  "name": "My Token",
  "realm": "usr_abc123",
  "tokenType": "delegate",
  "expiresAt": 1741089600000,
  "createdAt": 1738497600000,
  "isRevoked": false,
  "depth": 0,
  "issuerChain": ["usr_abc123"]
}
```

> **issuerChain 说明**：`issuerChain` 总是以用户 ID（`usr_xxx`）开头，因为第一个 issuer 一定是用户。后续元素为父 Token ID（`dlt1_xxx`）。

---

#### POST /api/tokens/:tokenId/revoke

撤销指定的 Delegate Token（级联撤销所有子 Token）。

**认证**：`Bearer {jwt}` (User Token)

**响应**：
```json
{
  "success": true,
  "revokedCount": 5
}
```

---

### 2.3 Token 转签发

#### POST /api/tokens/delegate

使用再授权 Token 转签发新 Token。

**认证**：`Bearer {base64_encoded_token}` (Delegate Token)

**请求**：

```typescript
type DelegateTokenRequest = {
  type: "delegate" | "access";
  expiresIn?: number;
  canUpload?: boolean;
  canManageDepot?: boolean;
  scope?: string[];  // 相对 index-path 格式
};
```

**示例**：
```json
{
  "type": "access",
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
  "expiresAt": 1738501200000
}
```

> **注意**：`scope` 使用相对 index-path 格式（如 `.:0:1`），是相对于父 Token scope 的子集。

**Access Token 说明**：

Access Token 可以通过两种方式获得：
1. **通过 Ticket**：创建 Ticket 时自动签发，绑定到该 Ticket
2. **直接转签发**：使用 Delegate Token 转签发，不绑定 Ticket

两种 Access Token 都可以用于节点读写和 Depot 操作（需要相应权限）。

---

### 2.4 Ticket 管理

Ticket 创建采用**两步流程**：先签发 Access Token，再创建 Ticket 并绑定。

#### 步骤 1：签发 Access Token 给 Tool

使用 `POST /api/tokens/delegate` 签发 Access Token（参见 2.3 节）。

#### 步骤 2：创建 Ticket 并绑定 Token

#### POST /api/realm/{realmId}/tickets

创建 Ticket 并绑定预签发的 Access Token。

**认证**：`Bearer {base64_encoded_token}` (Access Token)

**请求**：

```typescript
type CreateTicketRequest = {
  title: string;
  accessTokenId: string;  // 预签发的 Access Token ID
};
```

**示例**：
```json
{
  "title": "Generate thumbnail",
  "accessTokenId": "dlt1_xxxxx"
}
```

**响应**：
```json
{
  "ticketId": "ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC",
  "title": "Generate thumbnail",
  "status": "pending",
  "accessTokenId": "dlt1_xxxxx"
}
```

**验证规则**：
- `accessTokenId` 必须是有效的 Access Token
- 该 Token 未被绑定到其他 Ticket
- 该 Token 的 issuer chain 包含调用者（权限验证）

> Ticket 创建时绑定预签发的 Access Token。Tool 使用在步骤 1 获得的 `tokenBase64` 执行任务。

---

#### GET /api/realm/{realmId}/tickets

列出 Ticket。

**认证**：`Bearer {base64_encoded_token}` (Access Token)

**查询参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `limit` | `number` | 每页数量，默认 20，最大 100 |
| `cursor` | `string` | 分页游标 |
| `status` | `string` | 过滤状态：`pending` / `submitted` |

**响应**：
```json
{
  "tickets": [
    {
      "ticketId": "ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC",
      "title": "Generate thumbnail",
      "status": "pending",
      "createdAt": 1738497600000
    }
  ],
  "nextCursor": "xxx"
}
```

**可见范围**：查看该 Token 及其子 Token 创建的 Ticket

---

#### POST /api/realm/{realmId}/tickets/:ticketId/submit

提交 Ticket（设置 root 并自动撤销关联的 Access Token）。

**认证**：`Bearer {base64_encoded_token}` (Access Token)

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

---

## 3. 修改的 API

### 3.1 Node 读取

#### GET /api/realm/{realmId}/nodes/:key

**变更**：
- 认证方式从 `Ticket` 改为 `Bearer` + Access Token
- 新增 `X-CAS-Index-Path` Header 用于 scope 验证

> **注意**：Delegate Token 用于管理和转签发，不能直接访问节点数据。需先转签发为 Access Token 再进行读写操作。

**请求**：
```http
GET /api/realm/{realmId}/nodes/:key
Authorization: Bearer {base64_encoded_token}
X-CAS-Index-Path: 0:1:2
```

| Header | 必选 | 说明 |
|--------|------|------|
| `Authorization` | 是 | Access Token 的 Base64 编码 |
| `X-CAS-Index-Path` | 是 | 证明节点在 scope 内的索引路径 |

**Realm 验证**：URL 中的 `realmId` 必须与 Token 关联的 realm 一致，否则返回 `403 REALM_MISMATCH`。

### 3.2 Node 写入

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

### 3.3 Depot 操作

#### GET /api/realm/{realmId}/depots

列出 Depot。

**认证**：`Bearer {base64_encoded_token}` (Access Token)

**查询参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `limit` | `number` | 每页数量，默认 20，最大 100 |
| `cursor` | `string` | 分页游标 |

**响应**：
```json
{
  "depots": [
    {
      "depotId": "depot:MAIN",
      "name": "Main Depot",
      "creatorIssuerId": "dlt1_xxxxx",
      "createdAt": 1738497600000
    }
  ],
  "nextCursor": "xxx"
}
```

**可见范围**：查看该 Token 及其子 Token 创建的 Depot

#### POST /api/realm/{realmId}/depots

创建 Depot。

**认证**：`Bearer {base64_encoded_token}` (Access Token，需要 `canManageDepot` 权限)

**变更**：
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

**认证**：`Bearer {base64_encoded_token}` (Access Token，需要 `canManageDepot` 权限)

**变更**：
- 需要验证 Issuer Chain（只能操作自己或子 Token 创建的 Depot）

### 3.4 Ticket 状态查询

#### GET /api/realm/{realmId}/tickets/:ticketId

**认证**：`Bearer {base64_encoded_token}` (Access Token)

**可见范围**：查看该 Token 及其子 Token 创建的 Ticket

**响应格式（pending 状态）**：

```json
{
  "ticketId": "ticket:...",
  "title": "Generate thumbnail",
  "status": "pending",
  "root": null,
  "accessTokenId": "dlt1_xxxxx",
  "creatorTokenId": "dlt1_yyyyy",
  "createdAt": 1738497600000
}
```

**字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `status` | `string` | `"pending"`（等待提交）或 `"submitted"`（已提交）|
| `root` | `string \| null` | Ticket submit 时设置的输出节点（pending 时为 `null`，submitted 时为节点 hash）|
| `accessTokenId` | `string` | 关联的 Access Token ID（submit 后该 Token 自动撤销）|
| `creatorTokenId` | `string` | 创建此 Ticket 的 Delegate Token ID |
| `submittedAt` | `number?` | 提交时间戳（仅 submitted 状态时存在）|

**响应格式（submitted 状态）**：

```json
{
  "ticketId": "ticket:...",
  "title": "Generate thumbnail",
  "status": "submitted",
  "root": "node:abc123...",
  "accessTokenId": "dlt1_xxxxx",
  "creatorTokenId": "dlt1_yyyyy",
  "createdAt": 1738497600000,
  "submittedAt": 1738501200000
}
```

---

## 4. 认证方式变更

### 4.1 认证格式

所有需要 Delegate Token 的 API 统一使用：

```http
Authorization: Bearer {base64_encoded_128_bytes}
```

### 4.2 认证流程

| 阶段 | 说明 |
|------|------|
| 服务端存储 | 只存储 Token ID (Blake3-128 hash) |
| 客户端发送 | 发送完整 Token (Base64 编码) |
| 服务端验证 | 计算 hash → 查询记录 |

### 4.3 Token 类型

| 类型 | Header | 用途 |
|------|--------|------|
| User Token | `Bearer {jwt}` | OAuth 用户认证 |
| Delegate Token | `Bearer {base64}` | 再授权 Token |
| Access Token | `Bearer {base64}` | 访问 Token |

---

## 附录 A: API 路由总览

### 基础 API

| 方法 | 路径 | 认证 | 描述 |
|------|------|------|------|
| GET | `/api/health` | 无 | 健康检查 |
| GET | `/api/info` | 无 | 服务信息 |

### OAuth API

| 方法 | 路径 | 认证 | 描述 |
|------|------|------|------|
| GET | `/api/oauth/config` | 无 | OAuth 配置 |
| POST | `/api/oauth/token` | 无 | 交换授权码 |
| POST | `/api/oauth/login` | 无 | 用户登录 |
| POST | `/api/oauth/refresh` | JWT | 刷新 Token |
| GET | `/api/oauth/me` | JWT | 当前用户信息 |

### Token 管理 API

| 方法 | 路径 | 认证 | 描述 |
|------|------|------|------|
| POST | `/api/tokens` | JWT | 创建 Delegate Token |
| GET | `/api/tokens` | JWT | 列出 Delegate Token |
| GET | `/api/tokens/:id` | JWT | 获取 Token 详情 |
| POST | `/api/tokens/:id/revoke` | JWT | 撤销 Token |
| POST | `/api/tokens/delegate` | Delegate Token | 转签发 Token |

### 客户端授权申请 API

| 方法 | 路径 | 认证 | 描述 |
|------|------|------|------|
| POST | `/api/tokens/requests` | 无 | 发起授权申请 |
| GET | `/api/tokens/requests/:id/poll` | 无 | 轮询状态（客户端侧） |
| GET | `/api/tokens/requests/:id` | JWT | 查看详情（用户侧） |
| POST | `/api/tokens/requests/:id/approve` | JWT | 批准申请 |
| POST | `/api/tokens/requests/:id/reject` | JWT | 拒绝申请 |

> **注意**：授权申请不可枚举，无列表 API。

### Realm API

| 方法 | 路径 | 认证 | 描述 |
|------|------|------|------|
| GET | `/api/realm/{realmId}/nodes/:key` | Access Token | 读取节点 |
| GET | `/api/realm/{realmId}/nodes/:key/metadata` | Access Token | 获取节点元信息 |
| PUT | `/api/realm/{realmId}/nodes/:key` | Access Token (canUpload) | 写入节点 |
| POST | `/api/realm/{realmId}/nodes/check` | Access Token | 批量检查节点状态 |
| GET | `/api/realm/{realmId}/depots` | Access Token | 列出 Depot |
| POST | `/api/realm/{realmId}/depots` | Access Token (canManageDepot) | 创建 Depot |
| GET | `/api/realm/{realmId}/depots/:id` | Access Token | 获取 Depot 详情 |
| PATCH | `/api/realm/{realmId}/depots/:id` | Access Token (canManageDepot) | 修改 Depot |
| DELETE | `/api/realm/{realmId}/depots/:id` | Access Token (canManageDepot) | 删除 Depot |
| GET | `/api/realm/{realmId}/tickets` | Access Token | 列出 Ticket |
| POST | `/api/realm/{realmId}/tickets` | Access Token | 创建 Ticket（绑定预签发 Token） |
| GET | `/api/realm/{realmId}/tickets/:id` | Access Token | 查询 Ticket |
| POST | `/api/realm/{realmId}/tickets/:id/submit` | Access Token | 提交 Ticket |

> **设计原则**：所有 Realm 数据操作统一使用 Access Token，Delegate Token 只负责签发 Token。

---

## 附录 B: 错误码

### Token 相关

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `INVALID_TOKEN_FORMAT` | 401 | Token Base64 格式无效 |
| `TOKEN_NOT_FOUND` | 401 | Token ID 不存在 |
| `TOKEN_REVOKED` | 401 | Token 已被撤销 |
| `TOKEN_EXPIRED` | 401 | Token 已过期 |
| `ACCESS_TOKEN_REQUIRED` | 403 | 需要 Access Token |
| `DELEGATE_TOKEN_REQUIRED` | 403 | 需要 Delegate Token |
| `MAX_DEPTH_EXCEEDED` | 400 | 超出最大转签发深度 |

### 授权申请相关

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `INVALID_CLIENT_NAME` | 400 | clientName 为空或过长 |
| `INVALID_CLIENT_SECRET` | 400 | clientSecret 格式无效 |
| `REQUEST_NOT_FOUND` | 404 | 授权申请不存在 |
| `REQUEST_EXPIRED` | 400 | 授权申请已过期 |
| `REQUEST_ALREADY_PROCESSED` | 400 | 授权申请已被处理 |
| `INVALID_REALM` | 400 | 无权访问指定的 Realm |

### 访问控制相关

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `REALM_MISMATCH` | 403 | Token realm 与 URL realmId 不匹配 |
| `INDEX_PATH_REQUIRED` | 400 | 缺少 X-CAS-Index-Path |
| `NODE_NOT_IN_SCOPE` | 403 | 节点不在授权范围 |
| `DEPOT_ACCESS_DENIED` | 403 | 无权访问该 Depot |
| `RATE_LIMITED` | 429 | 请求过于频繁 |

### Ticket 相关

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `TOKEN_ALREADY_BOUND` | 400 | Access Token 已绑定到其他 Ticket |
| `INVALID_BOUND_TOKEN` | 400 | 绑定的 Token ID 无效或不是 Access Token |
| `TICKET_BIND_PERMISSION_DENIED` | 403 | 无权绑定该 Access Token |
| `TICKET_NOT_FOUND` | 404 | Ticket 不存在 |
| `TICKET_ALREADY_SUBMITTED` | 409 | Ticket 已提交 |
