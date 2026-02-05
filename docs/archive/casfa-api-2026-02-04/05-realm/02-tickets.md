# Ticket 管理与认证

Ticket 是 Realm 的受限访问凭证，提供有限的、有时间边界的 CAS 访问权限。本文档涵盖 Ticket 的完整生命周期：创建、使用、管理。

---

## 核心概念

### Ticket 是什么？

Ticket 承载了一个具体的任务上下文：

- **purpose**: 人类可读的任务描述，说明这个 ticket 的目的（创建时指定）
- **input**: 输入节点数组，代表任务的一个或多个输入数据（同时也是可读取的 scope）
- **output**: 可选的输出节点，代表任务的结果（commit 后填充）
- **writable**: 是否可写入（上传新节点并 commit）

### 生命周期

Ticket 的状态由两个独立字段决定：

| 字段 | 类型 | 描述 |
|------|------|------|
| `output` | `string \| null` | 结果节点，存在即表示已提交 |
| `isRevoked` | `boolean` | 是否被撤销 |

**四种组合的业务语义**：

| output | isRevoked | status | 语义 | 业务场景 |
|--------|-----------|--------|------|----------|
| null | false | `issued` | **活跃** | Tool 正在处理任务 |
| null | true | `revoked` | **放弃** | 任务取消，Tool 未完成就被撤销 |
| exists | false | `committed` | **完成** | 任务成功，结果可读取 |
| exists | true | `archived` | **归档** | 任务完成后权限收回，结果仍存在 |

> **说明**: API 响应中的 `status` 是根据 `output` 和 `isRevoked` 计算出的派生字段，方便 UI 展示。

```
                      ┌───────────┐
                      │  创建   │
                      └────┬──────┘
                           │
                           ▼
                      ┌───────────┐
                      │  issued  │  output=null, isRevoked=false
                      └────┬──────┘
                 ┌─────┴─────┐
           commit│           │revoke
                 ▼           ▼
          ┌───────────┐ ┌───────────┐
          │ committed │ │  revoked  │
          └─────┬─────┘ └───────────┘
                │           output=null, isRevoked=true
          revoke│
                ▼
          ┌───────────┐
          │  archived │  output=exists, isRevoked=true
          └───────────┘
```

| 状态 | 描述 | 可执行操作 |
|------|------|-----------|
| `issued` | 已发放，正常使用中 | 读取、写入、commit |
| `committed` | 已提交 | 仅读取 |
| `revoked` | 已撤销（未提交） | 无（返回 410） |
| `archived` | 已归档（提交后撤销） | 无（返回 410） |
| `deleted` | 已删除 | 无（返回 404） |

> **过期处理**: Ticket 过期状态由 `expiresAt` 运行时推导。当 `Date.now() > expiresAt` 时，Ticket 视为过期，返回 `410 Gone`。

### Issuer ID 格式

每个 Ticket 记录其创建者（issuer），格式根据创建方式不同：

| 创建方式 | 格式 | 说明 |
|---------|------|------|
| P256 Client | `client:{hash}` | 公钥的 Blake3s 哈希 |
| User Token | `user:{id}` | Cognito UUID 的 Base32 编码 |
| Agent Token | `token:{hash}` | Token 值的 Blake3s 哈希 |

---

## Ticket 认证

Tool 使用 `Authorization: Ticket` header 访问 Realm 路由：

```http
GET /api/realm/{realmId}/nodes/:key
Authorization: Ticket ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC
```

### 可访问的端点

使用 Ticket 认证时，只能访问 Realm 路由的子集：

| 方法 | 路径 | 描述 | Ticket 可访问 |
|------|------|------|--------------|
| GET | `/api/realm/{realmId}` | Realm 端点信息 | ✅ |
| GET | `/api/realm/{realmId}/usage` | 使用统计 | ✅ |
| POST | `/api/realm/{realmId}/prepare-nodes` | 预上传检查 | ✅ (writable) |
| GET | `/api/realm/{realmId}/nodes/:key/metadata` | 节点元信息 | ✅ (scope 限制) |
| GET | `/api/realm/{realmId}/nodes/:key` | 节点数据 | ✅ (scope 限制) |
| PUT | `/api/realm/{realmId}/nodes/:key` | 上传节点 | ✅ (writable + quota) |
| POST | `/api/realm/{realmId}/tickets/:ticketId/commit` | 提交结果 | ✅ (自身 ticket) |
| GET | `/api/realm/{realmId}/tickets` | 列出 Tickets | ❌ 403 |
| POST | `/api/realm/{realmId}/tickets` | 创建 Ticket | ❌ 403 |
| ... | `/api/realm/{realmId}/depots/...` | Depot 操作 | ❌ 403 |

### 权限控制

#### 读取权限（Scope 限制）

Ticket 的读取权限由 `input` 字段控制：

- `input` 数组中的所有节点及其子节点都可读取
- 如果 `output` 已设置，`output` 及其子节点也可读取
- 访问超出 scope 的节点返回 `403 Forbidden`

#### 写入权限

Ticket 的写入权限由 `writable` 字段控制：

- `writable: false`：只读，无法上传或 commit
- `writable: true`：可以写入，受以下限制：
  - `quota`：总上传字节数限制
  - `accept`：允许的 MIME 类型（如 `["image/*"]`）
  - 只能 commit 一次，之后变为 `committed` 状态

---

## 端点列表

| 方法 | 路径 | 描述 | 认证要求 |
|------|------|------|---------|
| POST | `/api/realm/{realmId}/tickets` | 创建 Ticket | Bearer / Agent |
| GET | `/api/realm/{realmId}/tickets` | 列出 Tickets | Bearer / Agent |
| GET | `/api/realm/{realmId}/tickets/:ticketId` | 获取 Ticket 详情 | Bearer / Agent / Ticket |
| POST | `/api/realm/{realmId}/tickets/:ticketId/commit` | 提交结果 | Ticket (自身) |
| POST | `/api/realm/{realmId}/tickets/:ticketId/revoke` | 撤销 Ticket | Bearer / Agent (Issuer) |
| DELETE | `/api/realm/{realmId}/tickets/:ticketId` | 删除 Ticket | Bearer (User) |

---

## POST /api/realm/{realmId}/tickets

创建新的 Ticket。

> **权限要求**: 需要 Agent Token 或 User Token。

### 请求

```json
{
  "input": ["node:abc123..."],
  "purpose": "Generate thumbnail for uploaded image",
  "writable": {
    "quota": 10485760,
    "accept": ["image/*"]
  },
  "expiresIn": 86400
}
```

| 字段 | 类型 | 描述 |
|------|------|------|
| `input` | `string[]?` | 输入节点 key 数组，定义可读取的范围。省略表示完全读取权限 |
| `purpose` | `string?` | 人类可读的任务描述 |
| `writable` | `object?` | 写入权限配置。省略表示只读 |
| `writable.quota` | `number?` | 上传字节数限制 |
| `writable.accept` | `string[]?` | 允许的 MIME 类型 |
| `expiresIn` | `number?` | 过期时间（秒），默认 24 小时 |

### 响应

```json
{
  "ticketId": "ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC",
  "realm": "user:A6JCHNMFWRT90AXMYWHJ8HKS90",
  "input": ["node:abc123..."],
  "writable": true,
  "config": {
    "nodeLimit": 4194304,
    "maxNameBytes": 255,
    "quota": 10485760,
    "accept": ["image/*"]
  },
  "expiresAt": 1738584000000
}
```

### 错误

| 状态码 | 描述 |
|--------|------|
| 400 | 请求参数无效 |
| 403 | 无权创建 Ticket |

---

## GET /api/realm/{realmId}/tickets

列出 Realm 下的所有 Tickets。

> **权限要求**: 需要 Bearer 或 Agent Token。

### 查询参数

| 参数 | 类型 | 描述 |
|------|------|------|
| `limit` | `number?` | 返回数量限制，默认 100，最大 1000 |
| `cursor` | `string?` | 分页游标 |
| `status` | `string?` | 按状态过滤：`issued`, `committed`, `revoked` |

### 响应

```json
{
  "tickets": [
    {
      "ticketId": "ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC",
      "status": "issued",
      "purpose": "Generate thumbnail for uploaded image",
      "input": ["node:abc123..."],
      "output": null,
      "isRevoked": false,
      "issuerId": "client:01HQXK5V8N3Y7M2P4R6T9W0DEF",
      "createdAt": 1738497600000,
      "expiresAt": 1738584000000
    }
  ],
  "nextCursor": "下一页游标",
  "hasMore": true
}
```

---

## GET /api/realm/{realmId}/tickets/:ticketId

获取指定 Ticket 的详细信息。

> **权限要求**: Bearer / Agent Token，或 Ticket Token（只能查看自身）。

### 响应

```json
{
  "ticketId": "ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC",
  "realm": "user:A6JCHNMFWRT90AXMYWHJ8HKS90",
  "status": "issued",
  "purpose": "Generate thumbnail for uploaded image",
  "input": ["node:abc123..."],
  "output": null,
  "isRevoked": false,
  "writable": true,
  "issuerId": "client:01HQXK5V8N3Y7M2P4R6T9W0DEF",
  "config": {
    "nodeLimit": 4194304,
    "maxNameBytes": 255,
    "quota": 10485760,
    "accept": ["image/*"]
  },
  "createdAt": 1738497600000,
  "expiresAt": 1738501200000
}
```

---

## POST /api/realm/{realmId}/tickets/:ticketId/commit

提交任务结果，设置 output 节点。状态从 `issued` 变为 `committed`。

> **权限要求**: 使用 `Authorization: Ticket` 认证，且只能 commit 自身的 ticket。

### 请求

```http
POST /api/realm/{realmId}/tickets/ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC/commit
Authorization: Ticket ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC
Content-Type: application/json

{
  "output": "node:result..."
}
```

| 字段 | 类型 | 描述 |
|------|------|------|
| `output` | `string` | 输出节点 key（必须已上传） |

### 响应

```json
{
  "success": true,
  "status": "committed",
  "output": "node:result...",
  "isRevoked": false
}
```

### 错误

| 状态码 | 描述 |
|--------|------|
| 400 | output 节点不存在 |
| 403 | Ticket 不可写或 ticketId 不匹配 |
| 409 | Ticket 已经 committed |
| 410 | Ticket 已撤销或过期 |

---

## POST /api/realm/{realmId}/tickets/:ticketId/revoke

撤销指定的 Ticket。

- 如果 Ticket 未提交（`issued`），撤销后状态变为 `revoked`
- 如果 Ticket 已提交（`committed`），撤销后状态变为 `archived`（结果节点保留）

> **权限要求**: 需要 Bearer 或 Agent Token，且必须是 Ticket 的 issuer。

### 响应

```json
{
  "success": true,
  "status": "revoked",
  "isRevoked": true
}
```

或者（归档场景）：

```json
{
  "success": true,
  "status": "archived",
  "output": "node:result...",
  "isRevoked": true
}
```

### 错误

| 状态码 | 描述 |
|--------|------|
| 403 | 不是 Ticket 的 issuer |
| 404 | Ticket 不存在 |
| 409 | Ticket 已经被撤销 |

---

## DELETE /api/realm/{realmId}/tickets/:ticketId

删除指定的 Ticket（物理删除）。

> **权限要求**: 只有 User Token 可以删除 Ticket。Agent Token 只能 revoke。

### 响应

```json
{
  "success": true
}
```

### 错误

| 状态码 | 描述 |
|--------|------|
| 403 | Agent Token 无权删除，只能 revoke |
| 404 | Ticket 不存在 |

---

## 完整示例：Tool 通过 Ticket 完成任务

### 1. Agent 创建 Ticket

```http
POST /api/realm/user:A6JCHNMFWRT90AXMYWHJ8HKS90/tickets
Authorization: Agent {agentToken}
Content-Type: application/json

{
  "input": ["node:abc123..."],
  "purpose": "Generate thumbnail for uploaded image",
  "writable": {
    "quota": 10485760,
    "accept": ["image/*"]
  },
  "expiresIn": 3600
}
```

### 2. Tool 获取 Ticket 信息

```http
GET /api/realm/user:A6JCHNMFWRT90AXMYWHJ8HKS90/tickets/ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC
Authorization: Ticket ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC
```

### 3. Tool 读取输入数据

```http
GET /api/realm/user:A6JCHNMFWRT90AXMYWHJ8HKS90/nodes/node:abc123.../metadata
Authorization: Ticket ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC

GET /api/realm/user:A6JCHNMFWRT90AXMYWHJ8HKS90/nodes/node:abc123...
Authorization: Ticket ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC
```

### 4. Tool 上传结果节点

```http
PUT /api/realm/user:A6JCHNMFWRT90AXMYWHJ8HKS90/nodes/node:result...
Authorization: Ticket ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC
Content-Type: application/octet-stream

(二进制数据)
```

### 5. Tool 提交结果

```http
POST /api/realm/user:A6JCHNMFWRT90AXMYWHJ8HKS90/tickets/ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC/commit
Authorization: Ticket ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC
Content-Type: application/json

{
  "output": "node:result..."
}
```

### 6. Agent 查看结果（可选）

```http
GET /api/realm/user:A6JCHNMFWRT90AXMYWHJ8HKS90/tickets/ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC
Authorization: Agent {agentToken}
```

响应中 `status: "committed"`, `output: "node:result..."`。

---

## 错误处理

| 状态码 | 描述 |
|--------|------|
| 401 | Ticket 无效或格式错误 |
| 403 | 超出 input scope、writable 权限或无权访问该端点 |
| 404 | Ticket 不存在或已删除 |
| 409 | 状态冲突（如已 committed） |
| 410 | Ticket 已撤销或过期 |
| 413 | 超出 quota 限制 |

---

## 安全说明

1. **Ticket ID 是敏感凭证**: 应当保密，仅分享给需要执行任务的 Tool
2. **使用 Header 传递**: 不要将 Ticket ID 放入 URL，避免日志泄露
3. **最小权限原则**: 创建 Ticket 时应尽量限制 `input` scope 和 `quota`
4. **设置合理过期时间**: 使用 `expiresIn` 控制 Ticket 有效期
