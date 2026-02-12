# Ticket 管理

Ticket 是一个工作空间概念，代表一个具体的任务。每个 Ticket 关联一个 Access Token 用于执行任务。

---

## 核心概念

### Ticket 是什么？

在 Delegate Token 授权体系下，Ticket 是一个工作空间概念：

- **title**: 人类可读的任务描述
- **status**: `pending`（等待提交）或 `submitted`（已提交）
- **root**: 任务输出节点（submit 后设置）
- **accessTokenId**: 关联的 Access Token（预签发后绑定）

权限控制（scope、quota、canUpload）由关联的 Access Token 承载，不再由 Ticket 直接控制。

### 生命周期

```
  Step 1                     Step 2                    Status
┌────────────────────┐     ┌────────────────────┐     ┌───────────┐
│ Issue Access Token │ ──> │ Create Ticket      │ ──> │  pending  │
│ (got tokenId &     │     │ (bind accessTokenId│     └─────┬─────┘
│  tokenBase64)      │     └────────────────────┘           │
└────────────────────┘                                Submit (root)
                                                            │
                                                      ┌─────┴─────┐
                                                      │ submitted │
                                                      └───────────┘
                                                      (Access Token
                                                       auto-revoked)
```

| 状态 | 描述 | 关联 Token 状态 |
|------|------|----------------|
| `pending` | 等待提交，可执行任务 | 有效 |
| `submitted` | 已提交，任务完成 | **自动撤销** |

---

## 端点列表

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| POST | `/api/realm/{realmId}/tickets` | 创建 Ticket | **Access Token** |
| GET | `/api/realm/{realmId}/tickets` | 列出 Ticket | Access Token |
| GET | `/api/realm/{realmId}/tickets/:ticketId` | 获取 Ticket 详情 | Access Token |
| POST | `/api/realm/{realmId}/tickets/:ticketId/submit` | 提交 Ticket | Access Token |

> **设计原则**：所有 Realm 数据操作统一使用 Access Token，Delegate Token 只负责签发 Token。

---

## 两步创建流程

创建 Ticket 需要两步：先签发 Access Token，再创建 Ticket 并绑定。

### 步骤 1：签发 Access Token 给 Tool

使用 Delegate Token 签发一个 Access Token，用于 Tool 执行任务：

```http
POST /api/tokens/delegate
Authorization: Bearer {delegate_token_base64}
Content-Type: application/json

{
  "type": "access",
  "expiresIn": 3600,
  "canUpload": true,
  "scope": [".:0:1"]
}
```

响应：

```json
{
  "tokenId": "dlt1_xxxxx",
  "tokenBase64": "SGVsbG8gV29ybGQh...",
  "expiresAt": 1738501200000
}
```

> 保存 `tokenId` 用于步骤 2，`tokenBase64` 交给 Tool 使用。

### 步骤 2：创建 Ticket 并绑定 Token

## POST /api/realm/{realmId}/tickets

创建 Ticket 并绑定预签发的 Access Token。

> **认证要求**：需要 **Access Token**。

### 请求

```http
POST /api/realm/usr_abc123/tickets
Authorization: Bearer {access_token_base64}
Content-Type: application/json

{
  "title": "Generate thumbnail",
  "accessTokenId": "dlt1_xxxxx"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `title` | `string` | 是 | Ticket 标题（1-256 字符） |
| `accessTokenId` | `string` | 是 | 预签发的 Access Token ID |

### 绑定验证

服务端会验证：

1. `accessTokenId` 是有效的 Access Token
2. 该 Token 未被绑定到其他 Ticket
3. 该 Token 的 issuer chain 包含调用者（权限验证）

### 响应

```json
{
  "ticketId": "ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC",
  "title": "Generate thumbnail",
  "status": "pending",
  "accessTokenId": "dlt1_xxxxx"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `ticketId` | `string` | Ticket ID |
| `title` | `string` | Ticket 标题 |
| `status` | `string` | 状态：`pending` |
| `accessTokenId` | `string` | 绑定的 Access Token ID |

> **注意**：`tokenBase64` 在步骤 1 签发时返回，创建 Ticket 时不再返回。

### 错误

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `ACCESS_TOKEN_REQUIRED` | 403 | 需要 Access Token |
| `INVALID_BOUND_TOKEN` | 400 | 绑定的 Token ID 无效或不是 Access Token |
| `TOKEN_ALREADY_BOUND` | 400 | Access Token 已绑定到其他 Ticket |
| `TICKET_BIND_PERMISSION_DENIED` | 403 | 无权绑定该 Access Token |

---

## GET /api/realm/{realmId}/tickets

列出 Ticket。

### 请求

```http
GET /api/realm/usr_abc123/tickets?limit=20&status=pending
Authorization: Bearer {access_token}
```

### 查询参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `limit` | `number` | 每页数量，默认 20，最大 100 |
| `cursor` | `string` | 分页游标 |
| `status` | `string` | 过滤状态：`pending` / `submitted` |

### 响应

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

### 可见范围

Ticket 的可见范围由 Issuer Chain 决定，与 Depot 的可见性规则一致。

Token 可以看到其 Issuer Chain 中任意**签发者**创建的 Ticket：

- 该 Token 的直接 Issuer（签发它的 Delegate Token 的 issuerId）创建的 Ticket
- Issuer 的 Issuer 创建的 Ticket，以此类推
- 直到用户创建的 Ticket

可见性基于 `creatorIssuerId`（创建 Ticket 的 Delegate Token 的签发者 ID），而非 `accessTokenId`。

---

## GET /api/realm/{realmId}/tickets/:ticketId

获取 Ticket 详情。

### 请求

```http
GET /api/realm/usr_abc123/tickets/ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC
Authorization: Bearer {access_token}
```

### 响应（pending 状态）

```json
{
  "ticketId": "ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC",
  "title": "Generate thumbnail",
  "status": "pending",
  "root": null,
  "accessTokenId": "dlt1_xxxxx",
  "creatorIssuerId": "dlt1_yyyyy",
  "createdAt": 1738497600000,
  "expiresAt": 1738501200000
}
```

### 响应（submitted 状态）

```json
{
  "ticketId": "ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC",
  "title": "Generate thumbnail",
  "status": "submitted",
  "root": "node:abc123...",
  "accessTokenId": "dlt1_xxxxx",
  "creatorIssuerId": "dlt1_yyyyy",
  "createdAt": 1738497600000,
  "expiresAt": 1738501200000,
  "submittedAt": 1738498200000
}
```

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `ticketId` | `string` | Ticket ID |
| `title` | `string` | Ticket 标题 |
| `status` | `string` | `pending` 或 `submitted` |
| `root` | `string \| null` | 输出节点（pending 时为 null） |
| `accessTokenId` | `string` | 关联的 Access Token ID |
| `creatorIssuerId` | `string` | 创建此 Ticket 的 Delegate Token 的签发者 ID |
| `createdAt` | `number` | 创建时间 |
| `expiresAt` | `number` | 过期时间 |
| `submittedAt` | `number?` | 提交时间（仅 submitted 状态） |

> **注意**：`creatorIssuerId` 与 Depot 的 `creatorIssuerId` 语义一致，用于 Issuer Chain 可见性判断。

### 错误

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `NOT_FOUND` | 404 | Ticket 不存在或无权查看 |

---

## POST /api/realm/{realmId}/tickets/:ticketId/submit

提交 Ticket，设置输出节点。提交后关联的 Access Token 自动撤销。

### 请求

```http
POST /api/realm/usr_abc123/tickets/ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC/submit
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "root": "node:result..."
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `root` | `string` | 是 | 输出节点 key（必须已上传） |

### 响应

```json
{
  "success": true,
  "status": "submitted",
  "root": "node:result..."
}
```

### 错误

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `NOT_FOUND` | 404 | Ticket 不存在 |
| `FORBIDDEN` | 403 | 无权提交此 Ticket |
| `CONFLICT` | 409 | Ticket 已经提交 |
| `GONE` | 410 | Ticket 已过期 |
| `INVALID_ROOT` | 400 | 输出节点不存在 |

---

## 完整示例：Tool 通过 Ticket 完成任务

### 1. Agent 签发 Access Token 给 Tool

```http
POST /api/tokens/delegate
Authorization: Bearer {delegate_token_base64}
Content-Type: application/json

{
  "type": "access",
  "expiresIn": 3600,
  "canUpload": true,
  "scope": [".:0:1"]
}
```

响应：

```json
{
  "tokenId": "dlt1_tool_token",
  "tokenBase64": "SGVsbG8gV29ybGQh...",
  "expiresAt": 1738501200000
}
```

保存 `tokenId`，将 `tokenBase64` 交给 Tool。

### 2. Agent 创建 Ticket 并绑定 Token

```http
POST /api/realm/usr_abc123/tickets
Authorization: Bearer {agent_access_token_base64}
Content-Type: application/json

{
  "title": "Generate thumbnail for uploaded image",
  "accessTokenId": "dlt1_tool_token"
}
```

响应：

```json
{
  "ticketId": "ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC",
  "title": "Generate thumbnail for uploaded image",
  "status": "pending",
  "accessTokenId": "dlt1_tool_token"
}
```

### 3. Tool 使用 Access Token 读取输入

```http
GET /api/realm/usr_abc123/nodes/node:input...
Authorization: Bearer {tool_access_token_base64}
X-CAS-Index-Path: 0
```

### 4. Tool 使用 Access Token 上传结果

```http
PUT /api/realm/usr_abc123/nodes/node:result...
Authorization: Bearer {tool_access_token_base64}
Content-Type: application/octet-stream

(二进制数据)
```

### 5. Tool 提交 Ticket

```http
POST /api/realm/usr_abc123/tickets/ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC/submit
Authorization: Bearer {tool_access_token_base64}
Content-Type: application/json

{
  "root": "node:result..."
}
```

提交成功后，Access Token 自动撤销，Tool 不能再执行任何操作。

### 6. Agent 查看结果

```http
GET /api/realm/usr_abc123/tickets/ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC
Authorization: Bearer {agent_access_token_base64}
```

响应中 `status: "submitted"`, `root: "node:result..."`。
