# Depot 管理

Depot 是命名存储空间，每个 Depot 持有一个可变的 root 指针（指向 CAS 节点），以及 root 的变更历史。

## ID 格式

Depot ID 使用 `dpt_` 前缀 + 26 位 Crockford Base32 编码的 ULID（128 位），例如 `dpt_01H5K6Z9X3ABCDEF01234567`。创建时自动生成。

---

## GET /api/realm/{realmId}/depots

列出 Realm 下的所有 Depot。

### 请求

```http
GET /api/realm/usr_abc123/depots?limit=20
Authorization: Bearer {access_token 或 jwt}
```

### 查询参数

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `limit` | `number` | 100 | 每页数量 |
| `cursor` | `string` | — | 分页游标 |

### 响应

```json
{
  "depots": [
    {
      "depotId": "dpt_01H5K6Z9X3ABCDEF01234567",
      "title": "main",
      "root": "nod_abc123...",
      "maxHistory": 100,
      "history": ["nod_prev1...", "nod_prev2..."],
      "createdAt": 1707600000000,
      "updatedAt": 1707600100000
    }
  ],
  "nextCursor": null,
  "hasMore": false
}
```

---

## POST /api/realm/{realmId}/depots

创建 Depot。需要 `canManageDepot` 权限。

### 请求

```http
POST /api/realm/usr_abc123/depots
Authorization: Bearer {access_token 或 jwt}
Content-Type: application/json

{
  "title": "my-project",
  "maxHistory": 50
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `title` | `string` | 否 | Depot 标题（同一 Realm 内唯一） |
| `maxHistory` | `number` | 否 | Root 历史保留数量（默认由系统配置决定） |

> **唯一性**：同一 Realm 下不能创建同 `title` 的 Depot。

### 响应（201）

```json
{
  "depotId": "dpt_01H5K6Z9X3ABCDEF01234567",
  "title": "my-project",
  "root": "nod_empty...",
  "maxHistory": 50,
  "history": [],
  "createdAt": 1707600000000,
  "updatedAt": 1707600000000
}
```

> 初始 root 指向空字典节点（well-known node）。

### 错误

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| 409 | 409 | `title` 重复 |
| `maxHistory cannot exceed N` | 400 | maxHistory 超过系统上限 |

---

## GET /api/realm/{realmId}/depots/:depotId

获取 Depot 详情。

### 请求

```http
GET /api/realm/usr_abc123/depots/dpt_01H5K6Z9X3ABCDEF01234567
Authorization: Bearer {access_token 或 jwt}
```

### 响应

```json
{
  "depotId": "dpt_01H5K6Z9X3ABCDEF01234567",
  "title": "my-project",
  "root": "nod_abc123...",
  "maxHistory": 50,
  "history": ["nod_prev1...", "nod_prev2..."],
  "createdAt": 1707600000000,
  "updatedAt": 1707600100000
}
```

### 响应字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `depotId` | `string` | Depot ID（`dpt_` 前缀） |
| `title` | `string` | Depot 标题 |
| `root` | `string` | 当前 root 节点 key（`nod_` 前缀） |
| `maxHistory` | `number` | Root 历史保留数量 |
| `history` | `string[]` | 历史 root 列表（最近的在前） |
| `createdAt` | `number` | 创建时间（Unix 毫秒） |
| `updatedAt` | `number` | 最后修改时间（Unix 毫秒） |

### 错误

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `Depot not found` | 404 | Depot 不存在 |

---

## PATCH /api/realm/{realmId}/depots/:depotId

修改 Depot 元信息。需要 `canManageDepot` 权限。

> **注意**：此端点仅修改元信息（title、maxHistory），不修改 root。更新 root 请使用 `POST .../commit`。

### 请求

```http
PATCH /api/realm/usr_abc123/depots/dpt_01H5K6Z9X3ABCDEF01234567
Authorization: Bearer {access_token 或 jwt}
Content-Type: application/json

{
  "title": "renamed-project",
  "maxHistory": 200
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `title` | `string` | 否 | 新标题 |
| `maxHistory` | `number` | 否 | 新的历史保留数量 |

### 响应

返回更新后的完整 Depot 对象（同 GET 响应格式）。

### 错误

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `Depot not found` | 404 | Depot 不存在 |
| `maxHistory cannot exceed N` | 400 | maxHistory 超过系统上限 |

---

## DELETE /api/realm/{realmId}/depots/:depotId

删除 Depot。需要 `canManageDepot` 权限。

### 请求

```http
DELETE /api/realm/usr_abc123/depots/dpt_01H5K6Z9X3ABCDEF01234567
Authorization: Bearer {access_token 或 jwt}
```

### 响应

```json
{
  "success": true
}
```

### 错误

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `Depot not found` | 404 | Depot 不存在 |

---

## POST /api/realm/{realmId}/depots/:depotId/commit

提交新的 Root 到 Depot。需要 `canUpload` 权限。

这是文件系统写操作后的关键步骤：`fs/write`、`fs/mkdir` 等操作只产生新 Root（返回 `newRoot`），不会自动更新 Depot。调用方需显式调用此端点将新 Root 提交到 Depot。

### 请求

```http
POST /api/realm/usr_abc123/depots/dpt_01H5K6Z9X3ABCDEF01234567/commit
Authorization: Bearer {access_token 或 jwt}
Content-Type: application/json

{
  "root": "nod_abc123..."
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `root` | `string` | 是 | 新的 root 节点 key（`nod_` 前缀） |

### 验证流程

1. **Depot 存在性**：确认 depotId 有效
2. **Root 存在性**：确认 root 节点在存储中存在
3. **所有权验证**：root 节点必须被当前 Delegate 链中任一成员拥有（well-known 节点如空字典免检）

### 响应

返回更新后的完整 Depot 对象（同 GET 响应格式），`root` 已更新为新值，旧 root 自动移入 `history`。

### 错误

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `Depot not found` | 404 | Depot 不存在 |
| `Root node does not exist` | 400 | root 节点在存储中不存在 |
| `ROOT_NOT_AUTHORIZED` | 403 | root 节点未被当前 Delegate 链拥有 |

---

## 典型工作流

### 修改文件并提交

```
1. 读取文件
   GET /api/realm/{realmId}/nodes/dpt_xxx/fs/read?path=src/main.ts

2. 写入修改后的文件
   POST /api/realm/{realmId}/nodes/dpt_xxx/fs/write?path=src/main.ts
   → newRoot: "nod_modified..."

3. 提交到 Depot
   POST /api/realm/{realmId}/depots/dpt_xxx/commit
   { "root": "nod_modified..." }
```

### 多次修改后一次提交

```
1. 第一次修改
   POST /api/realm/{realmId}/nodes/dpt_xxx/fs/write?path=file1.ts
   → newRoot: "nod_step1..."

2. 基于上一步的 newRoot 继续修改
   POST /api/realm/{realmId}/nodes/nod_step1.../fs/write?path=file2.ts
   → newRoot: "nod_step2..."

3. 一次性提交最终 Root
   POST /api/realm/{realmId}/depots/dpt_xxx/commit
   { "root": "nod_step2..." }
```
