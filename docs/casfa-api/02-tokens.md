# Token 管理 API

用于创建、管理和转签发 Delegate Token 的 API 端点。

## 概述

### Token 类型

| 类型 | 说明 |
|------|------|
| **Delegate Token（再授权 Token）** | 可以转签发子 Token，可以创建 Ticket，不能直接访问数据 |
| **Access Token（访问 Token）** | 可以访问数据（读写 Node、操作 Depot），不能签发 Token |

### Token 格式

| 属性 | 说明 |
|------|------|
| 二进制大小 | 128 字节 |
| 传输格式 | Base64 编码（约 172 字符） |
| Token ID 格式 | `dlt1_{crockford_base32}` |
| Token ID 计算 | Blake3-128(token_bytes) |

> **安全设计**：服务端不保存完整 Token，仅保存 Token ID（hash）。Token 仅在创建时返回一次。

---

## 端点列表

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| POST | `/api/tokens` | 创建 Delegate Token | User JWT |
| GET | `/api/tokens` | 列出 Delegate Token | User JWT |
| GET | `/api/tokens/:tokenId` | 获取 Token 详情 | User JWT |
| POST | `/api/tokens/:tokenId/revoke` | 撤销 Token | User JWT |
| POST | `/api/tokens/delegate` | 转签发 Token | Delegate Token |

---

## POST /api/tokens

用户直接创建 Delegate Token（无需客户端申请流程）。

### 请求

需要 `Authorization` header：

```http
Authorization: Bearer {jwt}
```

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

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `realm` | `string` | 是 | 授权的 Realm ID |
| `name` | `string` | 是 | Token 名称（1-64 字符） |
| `type` | `"delegate" \| "access"` | 是 | Token 类型 |
| `expiresIn` | `number` | 否 | 有效期（秒），默认 30 天 |
| `canUpload` | `boolean` | 否 | 是否允许上传 Node，默认 false |
| `canManageDepot` | `boolean` | 否 | 是否允许管理 Depot，默认 false |
| `scope` | `string[]` | 是 | 授权范围（CAS URI 数组） |

### Scope 格式

用户签发时，Scope 必须使用 `depot:` 或 `ticket:` URI：

```json
{
  "scope": [
    "cas://depot:MAIN",
    "cas://depot:BACKUP",
    "cas://ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC"
  ]
}
```

> **注意**：用户签发时不能使用 `node:` URI，必须从 Depot 或 Ticket 开始授权。

### 响应

```json
{
  "tokenId": "dlt1_4xzrt7y2m5k9bqwp3fnhjc6d",
  "tokenBase64": "SGVsbG8gV29ybGQh...",
  "expiresAt": 1741089600000
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `tokenId` | `string` | Token ID（`dlt1_xxx` 格式） |
| `tokenBase64` | `string` | 完整 Token 的 Base64 编码（约 172 字符） |
| `expiresAt` | `number` | 过期时间（epoch 毫秒） |

> **重要**：`tokenBase64` 是完整 Token 的 Base64 编码（128 字节），**仅返回一次**，客户端需妥善保管。

### 错误

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `INVALID_REQUEST` | 400 | 请求参数无效 |
| `INVALID_REALM` | 400 | 无权访问指定的 Realm |
| `UNAUTHORIZED` | 401 | 未认证或 JWT 无效 |

---

## GET /api/tokens

列出当前用户的 Delegate Token。

### 请求

需要 `Authorization` header：

```http
GET /api/tokens?limit=20&cursor=xxx
Authorization: Bearer {jwt}
```

### 查询参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `limit` | `number` | 每页数量，默认 20，最大 100 |
| `cursor` | `string` | 分页游标 |

### 响应

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

| 字段 | 类型 | 说明 |
|------|------|------|
| `tokenId` | `string` | Token ID |
| `name` | `string` | Token 名称 |
| `realm` | `string` | 授权的 Realm |
| `tokenType` | `string` | Token 类型：`delegate` 或 `access` |
| `expiresAt` | `number` | 过期时间 |
| `createdAt` | `number` | 创建时间 |
| `isRevoked` | `boolean` | 是否已撤销 |
| `depth` | `number` | Token 深度（0 = 用户直接签发） |

> **注意**：列表不返回 Token 内容（`tokenBase64`），Token 内容仅在创建时返回一次。

---

## GET /api/tokens/:tokenId

获取单个 Token 详情。

### 请求

```http
GET /api/tokens/dlt1_4xzrt7y2m5k9bqwp3fnhjc6d
Authorization: Bearer {jwt}
```

### 响应

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
  "canUpload": true,
  "canManageDepot": true,
  "issuerChain": ["usr_abc123"]
}
```

### issuerChain 说明

`issuerChain` 记录 Token 的签发链：

- 第一个元素总是用户 ID（`usr_xxx`）
- 后续元素为父 Token ID（`dlt1_xxx`）

示例：
```json
// 用户直接签发的 Token
"issuerChain": ["usr_abc123"]

// 转签发的 Token（深度 1）
"issuerChain": ["usr_abc123", "dlt1_parent_token"]

// 转签发的 Token（深度 2）
"issuerChain": ["usr_abc123", "dlt1_grandparent", "dlt1_parent"]
```

### 错误

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `TOKEN_NOT_FOUND` | 404 | Token 不存在或无权查看 |

---

## POST /api/tokens/:tokenId/revoke

撤销指定的 Delegate Token。**级联撤销所有子 Token**。

### 请求

```http
POST /api/tokens/dlt1_4xzrt7y2m5k9bqwp3fnhjc6d/revoke
Authorization: Bearer {jwt}
```

### 响应

```json
{
  "success": true,
  "revokedCount": 5
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `success` | `boolean` | 操作是否成功 |
| `revokedCount` | `number` | 被撤销的 Token 总数（包括子 Token） |

### 级联撤销

撤销 Token 会自动撤销其所有子 Token：

```
Token A (revoked)
├── Token B (cascade revoked)
│   ├── Token D (cascade revoked)
│   └── Token E (cascade revoked)
└── Token C (cascade revoked)
```

### 错误

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `TOKEN_NOT_FOUND` | 404 | Token 不存在或无权撤销 |
| `TOKEN_REVOKED` | 409 | Token 已被撤销 |

---

## POST /api/tokens/delegate

使用再授权 Token 转签发新 Token。

### 请求

```http
POST /api/tokens/delegate
Authorization: Bearer {base64_encoded_token}
Content-Type: application/json

{
  "type": "access",
  "expiresIn": 3600,
  "canUpload": true,
  "canManageDepot": false,
  "scope": [".:0:1", ".:0:2"]
}
```

> **注意**：`Authorization` Header 中是完整 Token（128 字节）的 Base64 编码，不是 Token ID。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | `"delegate" \| "access"` | 是 | Token 类型 |
| `expiresIn` | `number` | 否 | 有效期（秒），不能超过父 Token 剩余有效期 |
| `canUpload` | `boolean` | 否 | 是否允许上传，不能超过父 Token 权限 |
| `canManageDepot` | `boolean` | 否 | 是否允许管理 Depot，不能超过父 Token 权限 |
| `scope` | `string[]` | 是 | 相对 index-path 格式的 scope |

### Scope 格式（相对 index-path）

转签发时，scope 使用相对 index-path 格式，表示父 Token scope 的子集：

```json
{
  "scope": [
    ".:0:1",   // 父 scope 中第 0 个根的第 1 个子节点
    ".:0:2",   // 父 scope 中第 0 个根的第 2 个子节点
    ".:1"      // 父 scope 中第 1 个根
  ]
}
```

### 响应

```json
{
  "tokenId": "dlt1_7ynmq3kp2jdfhw8x9bcrt6vz",
  "tokenBase64": "SGVsbG8gV29ybGQh...",
  "expiresAt": 1738501200000
}
```

### 约束

转签发时必须遵守以下约束：

| 约束 | 说明 |
|------|------|
| Token 类型 | 只有 Delegate Token 可以转签发 |
| 深度限制 | 最大深度 15 层 |
| TTL | 不能超过父 Token 剩余有效期 |
| 权限 | 不能超过父 Token 权限 |
| Scope | 必须是父 Token scope 的子集 |

### 错误

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `INVALID_TOKEN_FORMAT` | 401 | Token Base64 格式无效 |
| `TOKEN_NOT_FOUND` | 401 | Token 不存在 |
| `TOKEN_REVOKED` | 401 | Token 已被撤销 |
| `TOKEN_EXPIRED` | 401 | Token 已过期 |
| `DELEGATE_TOKEN_REQUIRED` | 403 | 需要 Delegate Token（Access Token 不能转签发） |
| `MAX_DEPTH_EXCEEDED` | 400 | 超出最大转签发深度（15 层） |
| `INVALID_SCOPE` | 400 | Scope 不是父 Token 的子集 |
| `INVALID_TTL` | 400 | TTL 超过父 Token 剩余有效期 |
| `PERMISSION_ESCALATION` | 400 | 权限不能超过父 Token |

---

## Access Token 说明

Access Token 可以通过以下方式获得：

| 方式 | 说明 | 使用场景 |
|------|------|----------|
| **用户直接签发** | `POST /api/tokens` with `type: "access"` | 给自己使用的短期 Token |
| **Delegate Token 转签发** | `POST /api/tokens/delegate` with `type: "access"` | 给 Tool 使用的任务 Token |
| **创建 Ticket 时自动签发** | `POST /api/realm/{realmId}/tickets` | 绑定 Ticket 的 Token |

无论通过哪种方式获得，Access Token 都可以用于：

- 读取 scope 内的 Node（需要 `X-CAS-Index-Path` 证明）
- 写入 Node（需要 `canUpload` 权限）
- 操作 Depot（需要 `canManageDepot` 权限）

---

## 安全说明

1. **Token 是敏感凭证**：应当像密码一样保护，不要记录到日志
2. **最小权限原则**：创建 Token 时应尽量限制 scope 和权限
3. **合理设置有效期**：Delegate Token 可以较长（如 30 天），Access Token 应较短（如 1 小时）
4. **及时撤销**：不再需要的 Token 应及时撤销
5. **监控转签发链**：通过 `issuerChain` 追踪 Token 来源
