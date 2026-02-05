# Ticket 管理

Ticket 是一个工作空间概念，代表一个具体的任务。每个 Ticket 关联一个 Access Token 用于执行任务。

---

## 核心概念

### Ticket 是什么？

在 Delegate Token 授权体系下，Ticket 是一个工作空间概念：

- **title**: 人类可读的任务描述
- **status**: `pending`（等待提交）或 `submitted`（已提交）
- **root**: 任务输出节点（submit 后设置）
- **accessTokenId**: 关联的 Access Token

权限控制（scope、quota、canUpload）由关联的 Access Token 承载，不再由 Ticket 直接控制。

### 生命周期

```
        ┌───────────┐
        │  创建    │
        └────┬──────┘
             │
             │ 创建时自动签发关联的 Access Token
             ▼
        ┌───────────┐
        │  pending  │  可以读写数据
        └────┬──────┘
             │
             │ submit
             ▼
        ┌───────────┐
        │ submitted │  关联的 Access Token 自动撤销
        └───────────┘
```

| 状态 | 描述 | 关联 Token 状态 |
|------|------|----------------|
| `pending` | 等待提交，可执行任务 | 有效 |
| `submitted` | 已提交，任务完成 | **自动撤销** |

---

## 端点列表

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| POST | `/api/realm/{realmId}/tickets` | 创建 Ticket | **Delegate Token** |
| GET | `/api/realm/{realmId}/tickets` | 列出 Ticket | Access Token |
| GET | `/api/realm/{realmId}/tickets/:ticketId` | 获取 Ticket 详情 | Access Token |
| POST | `/api/realm/{realmId}/tickets/:ticketId/submit` | 提交 Ticket | Access Token |

---

## POST /api/realm/{realmId}/tickets

创建 Ticket 并签发关联的 Access Token。

> **认证要求**：需要 **Delegate Token**（再授权 Token），Access Token 不能创建 Ticket。

### 请求

```http
POST /api/realm/usr_abc123/tickets
Authorization: Bearer {delegate_token}
Content-Type: application/json

{
  "title": "Generate thumbnail",
  "expiresIn": 3600,
  "canUpload": true,
  "scope": [".:0:1"]
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `title` | `string` | 是 | Ticket 标题（1-256 字符） |
| `expiresIn` | `number` | 否 | 有效期（秒），默认 1 小时 |
| `canUpload` | `boolean` | 否 | 关联 Token 是否可上传 |
| `scope` | `string[]` | 否 | 相对 index-path 格式的 scope |

### Scope 格式

创建 Ticket 时，scope 使用相对 index-path 格式（相对于创建者 Delegate Token 的 scope）：

```json
{
  "scope": [".:0:1", ".:0:2"]
}
```

如果不指定 scope，则继承创建者 Delegate Token 的完整 scope。

### 响应

```json
{
  "ticketId": "ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC",
  "title": "Generate thumbnail",
  "status": "pending",
  "accessTokenId": "dlt1_xxxxx",
  "accessTokenBase64": "SGVsbG8gV29ybGQh...",
  "expiresAt": 1738501200000
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `ticketId` | `string` | Ticket ID |
| `title` | `string` | Ticket 标题 |
| `status` | `string` | 状态：`pending` |
| `accessTokenId` | `string` | 关联的 Access Token ID |
| `accessTokenBase64` | `string` | 关联的 Access Token（**仅返回一次**） |
| `expiresAt` | `number` | 过期时间 |

> **重要**：`accessTokenBase64` 仅在创建时返回一次。Tool 使用此 Token 执行任务。

### 错误

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `DELEGATE_TOKEN_REQUIRED` | 403 | 需要 Delegate Token |
| `INVALID_SCOPE` | 400 | Scope 不是创建者 Token 的子集 |

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

Ticket 的可见范围由 Issuer Chain 决定。Access Token 可以看到其 Issuer Chain 中任意 Token 创建的 Ticket：

- 该 Access Token 的直接 Issuer（签发它的 Delegate Token）创建的 Ticket
- Issuer 的 Issuer 创建的 Ticket，以此类推
- 直到用户创建的 Ticket

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
  "creatorTokenId": "dlt1_yyyyy",
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
  "creatorTokenId": "dlt1_yyyyy",
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
| `creatorTokenId` | `string` | 创建此 Ticket 的 Delegate Token ID |
| `createdAt` | `number` | 创建时间 |
| `expiresAt` | `number` | 过期时间 |
| `submittedAt` | `number?` | 提交时间（仅 submitted 状态） |

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

### 1. Agent 使用 Delegate Token 创建 Ticket

```http
POST /api/realm/usr_abc123/tickets
Authorization: Bearer {delegate_token_base64}
Content-Type: application/json

{
  "title": "Generate thumbnail for uploaded image",
  "expiresIn": 3600,
  "canUpload": true,
  "scope": [".:0:1"]
}
```

响应包含 `accessTokenBase64`，将其交给 Tool。

### 2. Tool 使用 Access Token 读取输入

```http
GET /api/realm/usr_abc123/nodes/node:input...
Authorization: Bearer {access_token_base64}
X-CAS-Index-Path: 0
```

### 3. Tool 使用 Access Token 上传结果

```http
PUT /api/realm/usr_abc123/nodes/node:result...
Authorization: Bearer {access_token_base64}
Content-Type: application/octet-stream

(二进制数据)
```

### 4. Tool 提交 Ticket

```http
POST /api/realm/usr_abc123/tickets/ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC/submit
Authorization: Bearer {access_token_base64}
Content-Type: application/json

{
  "root": "node:result..."
}
```

提交成功后，Access Token 自动撤销，Tool 不能再执行任何操作。

### 5. Agent 查看结果

```http
GET /api/realm/usr_abc123/tickets/ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC
Authorization: Bearer {another_access_token}
```

响应中 `status: "submitted"`, `root: "node:result..."`。
