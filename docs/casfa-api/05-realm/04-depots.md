# Depot 管理

Depot 是 CAS 中的存储空间，支持简单的版本历史。每个用户默认有一个 main depot。

> **注意**: Ticket 不支持 Depot 操作，Depot 仅通过 Realm 路由访问。

---

## 核心概念

### History 栈

Depot 维护一个 `history` 栈，记录最近的 root 版本：

- `commit` 操作会将当前 root 压入 history 栈，然后设置新的 root
- history 栈会去重：如果新 root 已在 history 中，相当于将其提到栈顶
- history 栈大小由 `maxHistory` 控制，超出时截断旧版本

### 默认 Depot

- 每个用户（Realm）自动创建一个 main depot，title 为 "main"
- main depot 不能被删除

---

## GET /api/realm/{realmId}/depots

列出 Realm 中的所有 Depots。

### 查询参数

| 参数 | 类型 | 描述 |
|------|------|------|
| `limit` | `number?` | 返回数量限制，默认 100 |
| `cursor` | `string?` | 分页游标 |

### 响应

```json
{
  "depots": [
    {
      "depotId": "depot:01HQXK5V8N3Y7M2P4R6T9W0ABC",
      "title": "main",
      "root": "node:abc123...",
      "maxHistory": 20,
      "history": ["node:prev1...", "node:prev2..."],
      "createdAt": 1704067200000,
      "updatedAt": 1738497600000
    }
  ],
  "nextCursor": "下一页游标",
  "hasMore": true
}
```

| 字段 | 类型 | 描述 |
|------|------|------|
| `depots` | `Depot[]` | Depot 列表 |
| `nextCursor` | `string?` | 下一页游标（无更多数据时省略） |
| `hasMore` | `boolean` | 是否还有更多数据 |

---

## POST /api/realm/{realmId}/depots

创建一个新的 Depot。

### 请求

```json
{
  "title": "我的仓库",
  "maxHistory": 10
}
```

| 字段 | 类型 | 描述 |
|------|------|------|
| `title` | `string?` | Depot 标题（最多 128 字符） |
| `maxHistory` | `number?` | 历史栈最大长度，默认 20，系统最大值 100 |

### 响应

```json
{
  "depotId": "depot:01HQXK5V8N3Y7M2P4R6T9W0ABC",
  "title": "我的仓库",
  "root": "node:empty...",
  "maxHistory": 10,
  "history": [],
  "createdAt": 1738497600000,
  "updatedAt": 1738497600000
}
```

> 新创建的 Depot 以空 dict node (d-node) 作为初始 root，history 为空

### 错误

| 状态码 | 描述 |
|--------|------|
| 400 | maxHistory 超出系统限制 |

---

## GET /api/realm/{realmId}/depots/:depotId

获取指定 Depot 的详情，包含完整的 history。

### 响应

```json
{
  "depotId": "depot:01HQXK5V8N3Y7M2P4R6T9W0ABC",
  "title": "我的仓库",
  "root": "node:abc123...",
  "maxHistory": 20,
  "history": [
    "node:prev1...",
    "node:prev2...",
    "node:prev3..."
  ],
  "createdAt": 1704067200000,
  "updatedAt": 1738497600000
}
```

| 字段 | 描述 |
|------|------|
| `depotId` | Depot 唯一标识 |
| `title` | Depot 标题 |
| `root` | 当前根节点 key |
| `maxHistory` | 历史栈最大长度 |
| `history` | 历史 root 节点数组（最新的在前） |
| `createdAt` | 创建时间（epoch 毫秒） |
| `updatedAt` | 最后更新时间（epoch 毫秒） |

---

## PATCH /api/realm/{realmId}/depots/:depotId

修改 Depot 的元数据。

### 请求

```json
{
  "title": "新标题",
  "maxHistory": 30
}
```

| 字段 | 类型 | 描述 |
|------|------|------|
| `title` | `string?` | 新标题（最多 128 字符） |
| `maxHistory` | `number?` | 新的历史栈最大长度 |

> 如果减小 `maxHistory`，当前 history 会被截断

### 响应

```json
{
  "depotId": "depot:01HQXK5V8N3Y7M2P4R6T9W0ABC",
  "title": "新标题",
  "root": "node:abc123...",
  "maxHistory": 30,
  "history": ["node:prev1...", "node:prev2..."],
  "createdAt": 1704067200000,
  "updatedAt": 1738501200000
}
```

### 错误

| 状态码 | 描述 |
|--------|------|
| 400 | maxHistory 超出系统限制 |
| 404 | Depot 不存在 |

---

## POST /api/realm/{realmId}/depots/:depotId/commit

提交新的 root 节点。当前 root 会被压入 history 栈。

### 请求

```json
{
  "root": "node:newroot..."
}
```

| 字段 | 类型 | 描述 |
|------|------|------|
| `root` | `string` | 新的根节点 key（必须已存在） |

### 响应

```json
{
  "depotId": "depot:01HQXK5V8N3Y7M2P4R6T9W0ABC",
  "title": "我的仓库",
  "root": "node:newroot...",
  "maxHistory": 20,
  "history": [
    "node:abc123...",
    "node:prev1...",
    "node:prev2..."
  ],
  "createdAt": 1704067200000,
  "updatedAt": 1738501200000
}
```

### History 去重逻辑

如果新 root 已存在于 history 中：

```json
// commit 前：root = "node:A", history = ["node:B", "node:C", "node:D"]
// commit { root: "node:C" }
// commit 后：root = "node:C", history = ["node:A", "node:B", "node:D"]
```

相当于将 `node:C` 从 history 中移除并设为当前 root，原 root 压入栈顶。

### 错误

| 状态码 | 描述 |
|--------|------|
| 400 | root 节点不存在 |
| 404 | Depot 不存在 |

---

## DELETE /api/realm/{realmId}/depots/:depotId

删除指定的 Depot。

> **注意**: 无法删除 main depot。

### 响应

```json
{
  "success": true
}
```

### 错误

| 状态码 | 描述 |
|--------|------|
| 403 | 无法删除 main depot |
| 404 | Depot 不存在 |

---

## 使用示例

### 创建并更新 Depot

```bash
# 1. 创建 Depot
curl -X POST /api/realm/user:01HQXK5V8N3Y7M2P4R6T9W0XYZ/depots \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"title": "文档仓库", "maxHistory": 10}'

# 2. 上传数据（省略节点上传步骤）

# 3. Commit 新 root
curl -X POST /api/realm/user:01HQXK5V8N3Y7M2P4R6T9W0XYZ/depots/depot:01HQXK5V8N3Y7M2P4R6T9W0ABC/commit \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"root": "node:newroot..."}'

# 4. 获取 Depot（包含 history）
curl /api/realm/user:01HQXK5V8N3Y7M2P4R6T9W0XYZ/depots/depot:01HQXK5V8N3Y7M2P4R6T9W0ABC \
  -H "Authorization: Bearer $TOKEN"

# 5. 修改 maxHistory
curl -X PATCH /api/realm/user:01HQXK5V8N3Y7M2P4R6T9W0XYZ/depots/depot:01HQXK5V8N3Y7M2P4R6T9W0ABC \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"maxHistory": 30}'

# 6. 恢复到历史版本（通过 commit history 中的 root）
curl -X POST /api/realm/user:01HQXK5V8N3Y7M2P4R6T9W0XYZ/depots/depot:01HQXK5V8N3Y7M2P4R6T9W0ABC/commit \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"root": "node:prev1..."}'
```
