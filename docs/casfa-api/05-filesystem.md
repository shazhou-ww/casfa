# 文件系统操作 API

以某个 CAS Node 为虚拟根目录，提供类似传统文件系统的 CRUD 操作。

> **核心原则**：CAS 是不可变存储，所有写操作（创建、更新、删除文件/目录）都会产生 **新的 Root Node**，而非就地修改。

---

## 概述

### 为什么需要文件系统 API

现有底层 API（`PUT /nodes/:key`、`PATCH /depots/:depotId`）提供了 CAS 原语操作，但客户端需要自行：

1. 解析 d-node 的 children 列表找到目标文件
2. 构建新的 d-node 二进制数据
3. 逐层重建 Merkle 路径至新 Root
4. 上传所有变更的节点
5. 更新 Depot 或 Ticket 的 root

文件系统 API 将这些步骤封装为直观的路径操作，降低客户端复杂度。

### 设计原则

| 原则 | 说明 |
|------|------|
| **不可变** | 所有写操作返回新的 Root Node，原数据不受影响 |
| **单 Block 文件** | read/write 仅支持单 block 文件（≤ `maxNodeSize`，线上 4MB），多 block 大文件应使用底层 Node API 分块读写 |
| **路径寻址** | 支持 CAS URI 的 path 和 index-path 两种定位方式 |
| **权限复用** | 复用现有 Access Token + Scope 权限体系 |
| **声明式重写** | 提供 `rewrite` 端点，声明新树的路径映射关系，一次性产出新 Root，避免中间结果 |

### 限制

| 限制 | 值 | 说明 |
|------|------|------|
| read/write 文件大小上限 | `maxNodeSize`（4MB） | 仅支持单 block 文件，超过此限制应使用底层 Node API 分块读写 |
| 文件名长度上限 | `maxNameBytes`（255 字节） | UTF-8 编码后的字节数 |
| 目录子节点上限 | `maxCollectionChildren`（10000） | 单个 d-node 的最大 children 数 |
| rewrite 条目上限 | 100 | 单次 rewrite 请求的最大映射 + 删除条目总数 |
| tree 展开节点上限 | 1000 | 单次 tree 请求返回的最大节点数 |

---

## 路由设计

文件系统操作挂载在 Node 路由下：

```
/api/realm/{realmId}/nodes/{nodeKey}/fs/...
```

**设计理由**：所有 fs 操作都以某个 Node 为根。将其放在 `/nodes/{nodeKey}` 下：
- 语义清晰：fs 操作是某个 Node 上的视图/变换
- 与现有 `GET /nodes/:key`（获取原始二进制）和 `GET /nodes/:key/metadata` 形成自然层级
- `nodeKey` 直接在 URL 中，无需额外的 `root` 查询参数

> **CAS URI 解析**：`nodeKey` 支持 `node:xxx`（直接 hash）、`depot:xxx`（解析 Depot 当前 root）、`ticket:xxx`（解析 Ticket 当前 root）三种格式，与 CAS URI 的 root 部分一致。

---

## 认证

所有文件系统操作需要 **Access Token**：

```http
Authorization: Bearer {base64_encoded_token}
```

### 权限要求

| 操作 | 权限要求 |
|------|----------|
| 读取文件/目录 | Access Token（需 scope 证明） |
| 创建/更新/删除文件或目录 | Access Token + `canUpload` |

### Scope 证明

与现有 Node 读取一致，需通过 `X-CAS-Index-Path` Header 证明 `{nodeKey}` 在 Token 的 scope 内：

```http
X-CAS-Index-Path: 0:1
```

> **说明**：此 Header 证明的是 URL 中的 `{nodeKey}` 在 Token scope 内的路径，而非文件在树内的路径。文件在树内的定位由查询参数 `path` / `indexPath` 完成。

---

## 端点列表

| 方法 | 路径 | 描述 | 权限 |
|------|------|------|------|
| GET | `/api/realm/{realmId}/nodes/{nodeKey}/fs/stat` | 获取文件/目录元信息 | Access Token |
| GET | `/api/realm/{realmId}/nodes/{nodeKey}/fs/read` | 读取文件内容 | Access Token |
| GET | `/api/realm/{realmId}/nodes/{nodeKey}/fs/ls` | 列出目录内容 | Access Token |
| GET | `/api/realm/{realmId}/nodes/{nodeKey}/fs/tree` | BFS 展开目录树 | Access Token |
| POST | `/api/realm/{realmId}/nodes/{nodeKey}/fs/write` | 创建或覆盖文件 | Access Token (canUpload) |
| POST | `/api/realm/{realmId}/nodes/{nodeKey}/fs/mkdir` | 创建目录 | Access Token (canUpload) |
| POST | `/api/realm/{realmId}/nodes/{nodeKey}/fs/rm` | 删除文件或目录 | Access Token (canUpload) |
| POST | `/api/realm/{realmId}/nodes/{nodeKey}/fs/mv` | 移动/重命名 | Access Token (canUpload) |
| POST | `/api/realm/{realmId}/nodes/{nodeKey}/fs/cp` | 复制文件或目录 | Access Token (canUpload) |
| POST | `/api/realm/{realmId}/nodes/{nodeKey}/fs/rewrite` | 声明式批量重写目录树 | Access Token (canUpload) |

---

## 通用参数

### URL 路径参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `realmId` | `string` | Realm ID |
| `nodeKey` | `string` | 根节点标识，支持 `node:xxx`、`depot:xxx`、`ticket:xxx` |

### 查询参数：路径定位

文件/目录在树内的位置通过以下查询参数之一指定：

| 参数 | 类型 | 说明 |
|------|------|------|
| `path` | `string` | 基于名称的相对路径，如 `src/main.ts` |
| `indexPath` | `string` | 基于索引的路径，如 `1:0`（对应 children 数组的索引） |

- `path` 和 `indexPath` **互斥**，不能同时提供
- 省略时表示根节点自身
- `path` 使用 `/` 分隔，不以 `/` 开头（相对于 root）
- `indexPath` 使用 `:` 分隔

### 写操作的通用响应字段

所有写操作（`write`、`mkdir`、`rm`、`mv`、`cp`、`rewrite`）的响应都包含：

| 字段 | 类型 | 说明 |
|------|------|------|
| `newRoot` | `string` | 新的根节点 key（`node:xxx`） |

> **重要**：写操作只产生新 Root，**不会自动更新** Depot 或 Ticket 的 root。调用方需要自行调用 `PATCH /api/realm/{realmId}/depots/:depotId` 或 `POST /api/realm/{realmId}/tickets/:ticketId/submit` 来提交新 Root。

---

## GET /api/realm/{realmId}/nodes/{nodeKey}/fs/stat

获取文件或目录的元信息。

### 请求

```http
GET /api/realm/usr_abc123/nodes/depot:MAIN/fs/stat?path=src/main.ts
Authorization: Bearer {access_token}
X-CAS-Index-Path: 0
```

### 查询参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | `string` | 否 | 名称路径 |
| `indexPath` | `string` | 否 | 索引路径 |

### 响应（文件）

```json
{
  "type": "file",
  "name": "main.ts",
  "key": "node:abc123...",
  "size": 2048,
  "contentType": "text/typescript"
}
```

### 响应（目录）

```json
{
  "type": "dir",
  "name": "src",
  "key": "node:def456...",
  "childCount": 5
}
```

### 响应（根节点）

当未指定 `path` 和 `indexPath` 时，返回根节点自身：

```json
{
  "type": "dir",
  "name": "",
  "key": "node:root...",
  "childCount": 3
}
```

### 响应字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | `"file" \| "dir"` | 节点类型（f-node → `file`，d-node → `dir`） |
| `name` | `string` | 文件/目录名称（根节点为空字符串） |
| `key` | `string` | 节点的 CAS key |
| `size` | `number` | 文件大小（字节），仅 `file` 类型 |
| `contentType` | `string` | MIME 类型，仅 `file` 类型 |
| `childCount` | `number` | 子节点数量，仅 `dir` 类型 |

### 错误

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `INVALID_ROOT` | 400 | nodeKey 无效或引用的节点不存在 |
| `PATH_NOT_FOUND` | 404 | 路径不存在 |
| `NOT_A_DIRECTORY` | 400 | 路径中间节点不是目录（如 `file.txt/foo`） |
| `INDEX_OUT_OF_BOUNDS` | 400 | indexPath 中的索引超出范围 |
| `NODE_NOT_IN_SCOPE` | 403 | 根节点不在 Token scope 内 |

---

## GET /api/realm/{realmId}/nodes/{nodeKey}/fs/read

读取文件内容。仅支持单 block 的 `file` 类型节点。

> **大文件**：如果文件有 successor 节点（多 block），此端点返回 `FILE_TOO_LARGE` 错误。客户端应使用底层 `GET /api/realm/{realmId}/nodes/:key` API 逐块读取。

### 请求

```http
GET /api/realm/usr_abc123/nodes/depot:MAIN/fs/read?path=src/main.ts
Authorization: Bearer {access_token}
X-CAS-Index-Path: 0
```

### 查询参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | `string` | 否 | 名称路径 |
| `indexPath` | `string` | 否 | 索引路径 |

### 响应

- **Content-Type**: 文件的 MIME 类型（从 f-node 中读取）
- **Content-Length**: 文件大小
- **X-CAS-Key**: 文件节点的 CAS key
- **Body**: 文件内容（原始 payload 字节）

```http
HTTP/1.1 200 OK
Content-Type: text/typescript
Content-Length: 2048
X-CAS-Key: node:abc123...

(文件内容)
```

> **说明**：返回的是 f-node 的 payload 部分（文件实际内容），不是 CAS 二进制格式。

### 错误

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `INVALID_ROOT` | 400 | nodeKey 无效 |
| `PATH_NOT_FOUND` | 404 | 路径不存在 |
| `NOT_A_FILE` | 400 | 目标不是文件（是目录） |
| `FILE_TOO_LARGE` | 400 | 文件有 successor 节点（多 block），请使用底层 Node API 读取 |
| `NODE_NOT_IN_SCOPE` | 403 | 根节点不在 Token scope 内 |

---

## GET /api/realm/{realmId}/nodes/{nodeKey}/fs/ls

列出目录的直接子节点。

### 请求

```http
GET /api/realm/usr_abc123/nodes/depot:MAIN/fs/ls?path=src
Authorization: Bearer {access_token}
X-CAS-Index-Path: 0
```

### 查询参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | `string` | 否 | 名称路径 |
| `indexPath` | `string` | 否 | 索引路径 |
| `limit` | `number` | 否 | 每页数量，默认 100，最大 1000 |
| `offset` | `number` | 否 | 起始偏移量，默认 0 |

### 响应

```json
{
  "path": "src",
  "key": "node:def456...",
  "children": [
    {
      "name": "cli.ts",
      "index": 0,
      "type": "file",
      "key": "node:aaa...",
      "size": 1024,
      "contentType": "text/typescript"
    },
    {
      "name": "commands",
      "index": 1,
      "type": "dir",
      "key": "node:bbb...",
      "childCount": 3
    },
    {
      "name": "lib",
      "index": 2,
      "type": "dir",
      "key": "node:ccc...",
      "childCount": 7
    }
  ],
  "total": 3,
  "offset": 0,
  "limit": 100
}
```

### 响应字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `path` | `string` | 当前目录路径（根目录为空字符串） |
| `key` | `string` | 当前目录的 CAS key |
| `children` | `array` | 子节点列表（按名称 UTF-8 字节序排列） |
| `children[].name` | `string` | 子节点名称 |
| `children[].index` | `number` | 子节点在 children 数组中的索引 |
| `children[].type` | `"file" \| "dir"` | 子节点类型 |
| `children[].key` | `string` | 子节点的 CAS key |
| `children[].size` | `number` | 文件大小（仅 `file`） |
| `children[].contentType` | `string` | MIME 类型（仅 `file`） |
| `total` | `number` | 子节点总数 |
| `offset` | `number` | 当前偏移量 |
| `limit` | `number` | 每页数量 |

### 错误

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `INVALID_ROOT` | 400 | nodeKey 无效 |
| `PATH_NOT_FOUND` | 404 | 路径不存在 |
| `NOT_A_DIRECTORY` | 400 | 目标不是目录 |
| `NODE_NOT_IN_SCOPE` | 403 | 根节点不在 Token scope 内 |

---

## GET /api/realm/{realmId}/nodes/{nodeKey}/fs/tree

以 BFS（广度优先）展开目录树结构。使用 `limit` 控制返回的总节点数，而非粗粒度的层数限制，更精确地控制响应体大小。

### BFS 展开策略

遍历从指定路径（或根节点）开始，按广度优先顺序展开子目录：
1. 先返回当前目录的所有直接子节点
2. 再依次展开各子目录的子节点
3. 直到达到 `limit` 上限或所有节点均已展开

这保证了「先看到全貌，再看到细节」，比深度限制更实用。

### 请求

```http
GET /api/realm/usr_abc123/nodes/depot:MAIN/fs/tree?path=src&limit=100
Authorization: Bearer {access_token}
X-CAS-Index-Path: 0
```

### 查询参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | `string` | 否 | 名称路径 |
| `indexPath` | `string` | 否 | 索引路径 |
| `limit` | `number` | 否 | 展开的最大节点数，默认 200，最大 1000 |

### 响应

```json
{
  "path": "src",
  "key": "node:def456...",
  "type": "dir",
  "children": [
    {
      "name": "cli.ts",
      "type": "file",
      "key": "node:aaa...",
      "size": 1024,
      "contentType": "text/typescript"
    },
    {
      "name": "commands",
      "type": "dir",
      "key": "node:bbb...",
      "childCount": 3,
      "children": [
        {
          "name": "auth.ts",
          "type": "file",
          "key": "node:ddd...",
          "size": 512,
          "contentType": "text/typescript"
        },
        {
          "name": "config.ts",
          "type": "file",
          "key": "node:eee...",
          "size": 256,
          "contentType": "text/typescript"
        },
        {
          "name": "node.ts",
          "type": "file",
          "key": "node:fff...",
          "size": 768,
          "contentType": "text/typescript"
        }
      ]
    },
    {
      "name": "lib",
      "type": "dir",
      "key": "node:ccc...",
      "childCount": 7,
      "children": null
    }
  ],
  "nodeCount": 8,
  "truncated": true
}
```

### 响应字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `path` | `string` | 起始目录路径 |
| `key` | `string` | 起始目录 CAS key |
| `type` | `"dir"` | 固定为 `dir` |
| `children` | `array` | 嵌套的子节点树 |
| `children[].children` | `array \| null` | 子目录的子节点（`null` = 未展开，`[]` = 空目录） |
| `children[].childCount` | `number` | 子节点总数（仅 `dir`，在展开和未展开时均返回） |
| `nodeCount` | `number` | 本次实际返回的节点总数 |
| `truncated` | `boolean` | 是否因 limit 截断（`true` = 还有未展开的子目录） |

> **`children` 为 `null` vs `[]`**：`null` 表示目录因 limit 未被展开（可通过后续请求展开），`[]` 表示目录确实为空。

### 错误

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `INVALID_ROOT` | 400 | nodeKey 无效 |
| `PATH_NOT_FOUND` | 404 | 路径不存在 |
| `NOT_A_DIRECTORY` | 400 | 目标不是目录 |
| `NODE_NOT_IN_SCOPE` | 403 | 根节点不在 Token scope 内 |

---

## POST /api/realm/{realmId}/nodes/{nodeKey}/fs/write

创建或覆盖文件。如果文件已存在则替换内容；如果不存在则创建（自动创建中间目录）。

> **大小限制**：`content` 解码后不得超过 `maxNodeSize`（4MB）。更大的文件应使用底层 `PUT /api/realm/{realmId}/nodes/:key` API 分块上传，然后通过 `rewrite` 的 `link` 操作将节点引用挂载到目录树中。

### 请求

```http
POST /api/realm/usr_abc123/nodes/depot:MAIN/fs/write
Authorization: Bearer {access_token}
X-CAS-Index-Path: 0
Content-Type: application/json

{
  "path": "src/utils/helper.ts",
  "contentType": "text/typescript",
  "content": "base64_encoded_content..."
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | `string` | *二选一 | 名称路径 |
| `indexPath` | `string` | *二选一 | 索引路径（仅用于覆盖已有文件） |
| `contentType` | `string` | 否 | MIME 类型，默认 `application/octet-stream` |
| `content` | `string` | 是 | Base64 编码的文件内容 |

> **注意**：`indexPath` 只能用于覆盖已存在的文件，不能用于创建新文件（因为新文件没有预先存在的索引位置）。创建新文件必须使用 `path`。

### 响应

```json
{
  "newRoot": "node:newroot...",
  "file": {
    "path": "src/utils/helper.ts",
    "key": "node:filekey...",
    "size": 2048,
    "contentType": "text/typescript"
  },
  "created": true
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `newRoot` | `string` | 新的根节点 key |
| `file.path` | `string` | 文件路径 |
| `file.key` | `string` | 新文件节点的 CAS key |
| `file.size` | `number` | 文件大小（字节） |
| `file.contentType` | `string` | MIME 类型 |
| `created` | `boolean` | `true` = 新建文件，`false` = 覆盖已有文件 |

### 错误

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `INVALID_ROOT` | 400 | nodeKey 无效 |
| `UPLOAD_NOT_ALLOWED` | 403 | Token 没有 `canUpload` 权限 |
| `NOT_A_DIRECTORY` | 400 | 路径中间节点不是目录 |
| `FILE_TOO_LARGE` | 413 | 文件内容超过 `maxNodeSize`，请使用底层 Node API 分块上传 |
| `INVALID_PATH` | 400 | 路径无效（空段、非法字符等） |
| `NAME_TOO_LONG` | 400 | 文件名超过 `maxNameBytes` |
| `COLLECTION_FULL` | 400 | 目录子节点数达到上限 |
| `NODE_NOT_IN_SCOPE` | 403 | 根节点不在 Token scope 内 |
| `INDEX_OUT_OF_BOUNDS` | 400 | indexPath 中的索引超出范围 |

---

## POST /api/realm/{realmId}/nodes/{nodeKey}/fs/mkdir

创建目录。自动创建中间目录（类似 `mkdir -p`）。

### 请求

```http
POST /api/realm/usr_abc123/nodes/depot:MAIN/fs/mkdir
Authorization: Bearer {access_token}
X-CAS-Index-Path: 0
Content-Type: application/json

{
  "path": "src/utils/parsers"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | `string` | 是 | 目录路径（仅支持名称路径） |

> **注意**：如果目录已存在，操作幂等，返回当前 root（不产生新 root）。

### 响应

```json
{
  "newRoot": "node:newroot...",
  "dir": {
    "path": "src/utils/parsers",
    "key": "node:dirkey..."
  },
  "created": true
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `newRoot` | `string` | 新的根节点 key |
| `dir.path` | `string` | 目录路径 |
| `dir.key` | `string` | 新目录节点的 CAS key |
| `created` | `boolean` | `true` = 新建目录，`false` = 目录已存在 |

### 错误

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `INVALID_ROOT` | 400 | nodeKey 无效 |
| `UPLOAD_NOT_ALLOWED` | 403 | Token 没有 `canUpload` 权限 |
| `NOT_A_DIRECTORY` | 400 | 路径中间节点不是目录 |
| `EXISTS_AS_FILE` | 409 | 目标路径已存在且是文件 |
| `INVALID_PATH` | 400 | 路径无效 |
| `NAME_TOO_LONG` | 400 | 目录名超过 `maxNameBytes` |
| `COLLECTION_FULL` | 400 | 父目录子节点数达到上限 |
| `NODE_NOT_IN_SCOPE` | 403 | 根节点不在 Token scope 内 |

---

## POST /api/realm/{realmId}/nodes/{nodeKey}/fs/rm

删除文件或目录。删除目录时递归移除所有子节点引用（CAS 节点本身不会被物理删除，因为可能被其他树引用）。

### 请求

```http
POST /api/realm/usr_abc123/nodes/depot:MAIN/fs/rm
Authorization: Bearer {access_token}
X-CAS-Index-Path: 0
Content-Type: application/json

{
  "path": "src/utils/helper.ts"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | `string` | *二选一 | 名称路径 |
| `indexPath` | `string` | *二选一 | 索引路径 |

### 响应

```json
{
  "newRoot": "node:newroot...",
  "removed": {
    "path": "src/utils/helper.ts",
    "type": "file",
    "key": "node:oldkey..."
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `newRoot` | `string` | 新的根节点 key |
| `removed.path` | `string` | 被删除的路径 |
| `removed.type` | `"file" \| "dir"` | 被删除的节点类型 |
| `removed.key` | `string` | 被删除的节点 CAS key |

### 错误

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `INVALID_ROOT` | 400 | nodeKey 无效 |
| `UPLOAD_NOT_ALLOWED` | 403 | Token 没有 `canUpload` 权限 |
| `PATH_NOT_FOUND` | 404 | 路径不存在 |
| `CANNOT_REMOVE_ROOT` | 400 | 不能删除根节点（必须指定子路径） |
| `NODE_NOT_IN_SCOPE` | 403 | 根节点不在 Token scope 内 |

---

## POST /api/realm/{realmId}/nodes/{nodeKey}/fs/mv

移动或重命名文件/目录。

### 请求

```http
POST /api/realm/usr_abc123/nodes/depot:MAIN/fs/mv
Authorization: Bearer {access_token}
X-CAS-Index-Path: 0
Content-Type: application/json

{
  "from": "src/old-name.ts",
  "to": "src/utils/new-name.ts"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `from` | `string` | 是 | 源路径（名称路径） |
| `to` | `string` | 是 | 目标路径（名称路径） |

> **说明**：
> - 如果目标路径的父目录不存在，自动创建
> - 如果目标路径已存在文件，返回错误；如果目标路径是已存在的目录，将源移入该目录
> - 在 CAS 中 `mv` 实际上是「在新位置引用原节点，并从旧位置移除」，然后逐层重建 Root

### 响应

```json
{
  "newRoot": "node:newroot...",
  "from": "src/old-name.ts",
  "to": "src/utils/new-name.ts"
}
```

### 错误

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `INVALID_ROOT` | 400 | nodeKey 无效 |
| `UPLOAD_NOT_ALLOWED` | 403 | Token 没有 `canUpload` 权限 |
| `PATH_NOT_FOUND` | 404 | 源路径不存在 |
| `TARGET_EXISTS` | 409 | 目标路径已存在文件 |
| `INVALID_PATH` | 400 | 路径无效 |
| `CANNOT_MOVE_ROOT` | 400 | 不能移动根节点 |
| `MOVE_INTO_SELF` | 400 | 不能将目录移入自身或其子目录 |
| `NODE_NOT_IN_SCOPE` | 403 | 根节点不在 Token scope 内 |

---

## POST /api/realm/{realmId}/nodes/{nodeKey}/fs/cp

复制文件或目录。

### 请求

```http
POST /api/realm/usr_abc123/nodes/depot:MAIN/fs/cp
Authorization: Bearer {access_token}
X-CAS-Index-Path: 0
Content-Type: application/json

{
  "from": "src/template.ts",
  "to": "src/utils/template-copy.ts"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `from` | `string` | 是 | 源路径（名称路径） |
| `to` | `string` | 是 | 目标路径（名称路径） |

> **CAS 优势**：由于 CAS 的去重特性，复制目录在底层只是增加了一个新的引用，不会实际复制数据。只有 Root 到新路径的 Merkle 路径上的 d-node 需要重建。

### 响应

```json
{
  "newRoot": "node:newroot...",
  "from": "src/template.ts",
  "to": "src/utils/template-copy.ts"
}
```

### 错误

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `INVALID_ROOT` | 400 | nodeKey 无效 |
| `UPLOAD_NOT_ALLOWED` | 403 | Token 没有 `canUpload` 权限 |
| `PATH_NOT_FOUND` | 404 | 源路径不存在 |
| `TARGET_EXISTS` | 409 | 目标路径已存在 |
| `INVALID_PATH` | 400 | 路径无效 |
| `NODE_NOT_IN_SCOPE` | 403 | 根节点不在 Token scope 内 |

---

## POST /api/realm/{realmId}/nodes/{nodeKey}/fs/rewrite

声明式地描述新树的路径映射关系，一次性产出新 Root。

### 设计思想

与命令式的「先 mkdir、再 mv、再 rm」不同，`rewrite` 采用**声明式**设计：你描述的是「新树长什么样」，而非「怎么一步步改」。

请求包含两部分：
1. **`entries`**：新树中每个变更路径的**来源映射**（从旧路径来 / 新内容 / 空目录 / 已有节点）
2. **`deletes`**：旧树中需要移除的路径列表

服务端根据映射关系，以原树为基础一次性计算出新树，只产生一个 Root。

**优势**：
- **声明式**：描述目标状态，而非变更步骤，不存在操作顺序依赖问题
- **无中间结果**：无论涉及多少路径变更，只产生一个最终 Root
- **可优化**：服务端可分析所有变更的影响范围，只重建必要的 Merkle 路径
- **幂等友好**：同样的映射关系总是产生同样的结果

### 请求

```http
POST /api/realm/usr_abc123/nodes/depot:MAIN/fs/rewrite
Authorization: Bearer {access_token}
X-CAS-Index-Path: 0
Content-Type: application/json

{
  "entries": {
    "src/new-module/utils.ts": { "from": "src/old-utils.ts" },
    "src/new-module/template.ts": { "from": "src/template.ts" },
    "src/new-module": { "dir": true },
    "src/new-module/index.ts": {
      "content": "base64...",
      "contentType": "text/typescript"
    },
    "data/large-file.bin": { "link": "node:abc123..." }
  },
  "deletes": [
    "src/old-utils.ts",
    "src/deprecated.ts"
  ]
}
```

### 请求字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `entries` | `Record<string, Entry>` | 否 | 新树中的路径映射，key 为目标路径 |
| `deletes` | `string[]` | 否 | 需要删除的旧路径列表 |

> **注意**：`entries` 和 `deletes` 至少提供一个且不能同时为空。`entries` + `deletes` 的条目总数不得超过 **100**。

### Entry 类型

每个 entry 的 value 是以下四种之一：

| 类型 | 字段 | 说明 |
|------|------|------|
| **from（移动/复制）** | `{ "from": "旧路径" }` | 从旧树的指定路径引用节点（文件或目录均可） |
| **dir（空目录）** | `{ "dir": true }` | 创建空目录 |
| **content（写文件）** | `{ "content": "base64...", "contentType?": "..." }` | 创建新文件（单 block，≤ `maxNodeSize`） |
| **link（挂载节点）** | `{ "link": "node:xxx" }` | 挂载一个已存在的 CAS 节点（用于大文件等场景） |

#### 详细说明

**`from` — 从旧树引用**

```json
"src/new-module/utils.ts": { "from": "src/old-utils.ts" }
```

- 将旧树中 `src/old-utils.ts` 的节点引用放到新树的 `src/new-module/utils.ts`
- 可以引用文件或目录（引用目录时整个子树都会出现在新位置）
- **配合 `deletes`**：如果同时在 `deletes` 中列出 `src/old-utils.ts`，效果等同于 `mv`；不删则等同于 `cp`
- `from` 路径不存在时报错

**`dir` — 创建空目录**

```json
"src/new-module": { "dir": true }
```

- 创建空的 d-node
- 中间路径的父目录会自动创建
- 如果路径已存在且是目录，忽略（幂等）
- 如果路径已存在且是文件，报错

**`content` — 写入新文件**

```json
"src/new-module/index.ts": {
  "content": "base64...",
  "contentType": "text/typescript"
}
```

- `content`：Base64 编码的文件内容，解码后不得超过 `maxNodeSize`（4MB）
- `contentType`：可选，MIME 类型，默认 `application/octet-stream`
- 如果路径已存在文件，则覆盖
- 中间路径的父目录会自动创建

**`link` — 挂载已有节点**

```json
"data/large-file.bin": { "link": "node:abc123..." }
```

- 将一个已存在于存储中的 CAS 节点挂载到指定路径
- 典型场景：大文件先通过底层 `PUT /nodes/:key` 分块上传，再通过 `link` 挂载到目录树
- 服务端验证节点存在性
- 可以挂载 f-node（文件）或 d-node（目录）

### 执行语义

1. 以 `{nodeKey}` 解析出的原树为基础
2. 先应用 `deletes`：从树中移除指定路径
3. 再应用 `entries`：在树中创建/覆盖指定路径
4. 隐式创建所有 entry 目标路径所需的中间目录
5. 一次性重建 Merkle 树，返回新 Root

> **冲突处理**：如果同一路径同时出现在 `deletes` 和 `entries` 中，先删后写（即最终结果是 entry 指定的新内容）。

> **`from` 引用时机**：所有 `from` 引用都基于**原树**（而非中间状态）。即使 `from` 的源路径也出现在 `deletes` 中，引用仍然有效——`from` 拷贝的是原树中的节点引用，`deletes` 只影响最终树中该路径是否保留。

### 响应

```json
{
  "newRoot": "node:newroot...",
  "entriesApplied": 5,
  "deleted": 2
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `newRoot` | `string` | 新的根节点 key |
| `entriesApplied` | `number` | 实际应用的 entry 数量 |
| `deleted` | `number` | 实际删除的路径数量 |

### 错误

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `INVALID_ROOT` | 400 | nodeKey 无效 |
| `UPLOAD_NOT_ALLOWED` | 403 | Token 没有 `canUpload` 权限 |
| `TOO_MANY_ENTRIES` | 400 | entries + deletes 条目总数超过 100 |
| `EMPTY_REWRITE` | 400 | entries 和 deletes 都为空 |
| `INVALID_PATH` | 400 | 某个路径无效（空段、`..`、绝对路径等） |
| `PATH_NOT_FOUND` | 404 | `from` 引用的源路径在原树中不存在 |
| `NODE_NOT_FOUND` | 404 | `link` 指定的节点在存储中不存在 |
| `EXISTS_AS_FILE` | 409 | 目标路径的中间段是文件，无法作为目录 |
| `FILE_TOO_LARGE` | 413 | `content` 解码后超过 `maxNodeSize` |
| `NAME_TOO_LONG` | 400 | 路径中某段名称超过 `maxNameBytes` |
| `COLLECTION_FULL` | 400 | 某目录子节点数达到上限 |
| `NODE_NOT_IN_SCOPE` | 403 | 根节点不在 Token scope 内 |

**错误详情示例**：

```json
{
  "error": "PATH_NOT_FOUND",
  "message": "Entry 'src/new-module/utils.ts' references non-existent source path",
  "details": {
    "entry": "src/new-module/utils.ts",
    "from": "src/old-utils.ts"
  }
}
```

### 示例

#### 重命名（mv）

将 `src/old.ts` 重命名为 `src/new.ts`：

```json
{
  "entries": {
    "src/new.ts": { "from": "src/old.ts" }
  },
  "deletes": ["src/old.ts"]
}
```

#### 复制（cp）

将 `src/template.ts` 复制到 `src/copy.ts`（不删除原路径）：

```json
{
  "entries": {
    "src/copy.ts": { "from": "src/template.ts" }
  }
}
```

#### 大规模重构

```json
{
  "entries": {
    "lib/core/index.ts":   { "from": "src/core.ts" },
    "lib/core/utils.ts":   { "from": "src/utils/core-utils.ts" },
    "lib/core/types.ts":   { "content": "base64...", "contentType": "text/typescript" },
    "lib/plugins":         { "from": "src/plugins" },
    "assets/logo.png":     { "link": "node:abc123..." }
  },
  "deletes": [
    "src/core.ts",
    "src/utils/core-utils.ts",
    "src/old-plugins"
  ]
}

---

## 典型使用流程

### 场景 1：Agent 修改文件并提交 Ticket

```
1. 获取 Depot 当前 root
   GET /api/realm/{realmId}/depots/depot:MAIN
   → root: "node:original..."

2. 读取目标文件
   GET /api/realm/{realmId}/nodes/depot:MAIN/fs/read?path=src/config.ts
   → 文件内容

3. 修改文件
   POST /api/realm/{realmId}/nodes/depot:MAIN/fs/write
   { path: "src/config.ts", content: "base64..." }
   → newRoot: "node:modified..."

4. 可选：继续修改其他文件（使用上一步的 newRoot）
   POST /api/realm/{realmId}/nodes/node:modified.../fs/write
   { path: "src/app.ts", content: "base64..." }
   → newRoot: "node:modified2..."

5. 提交 Ticket
   POST /api/realm/{realmId}/tickets/{ticketId}/submit
   { root: "node:modified2..." }
```

### 场景 2：Agent 浏览项目结构

```
1. BFS 展开项目树
   GET /api/realm/{realmId}/nodes/depot:MAIN/fs/tree?limit=200
   → 前 200 个节点的目录树

2. 深入查看某个子目录
   GET /api/realm/{realmId}/nodes/depot:MAIN/fs/ls?path=src/commands

3. 读取具体文件
   GET /api/realm/{realmId}/nodes/depot:MAIN/fs/read?path=src/commands/auth.ts
```

### 场景 3：声明式重构操作

使用 `rewrite` 一次完成目录重构，声明最终状态而非中间步骤：

```typescript
const result = await fetch(
  `/api/realm/${realmId}/nodes/depot:MAIN/fs/rewrite`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-CAS-Index-Path": "0",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      entries: {
        "src/new-module/index.ts": {
          content: btoa("export const hello = 'world';"),
          contentType: "text/typescript",
        },
        "src/new-module/helper.ts": { from: "src/utils/helper.ts" },
      },
      deletes: [
        "src/utils/helper.ts",
        "src/old-module.ts",
      ],
    }),
  }
);

const { newRoot } = await result.json();

// 一次性提交最终结果
await fetch(`/api/realm/${realmId}/depots/depot:MAIN`, {
  method: "PATCH",
  body: JSON.stringify({ root: newRoot }),
});
```

---

## 与底层 API 的关系

| 文件系统 API | 底层操作 |
|-------------|---------|
| `fs/read` | 解析路径 → `GET /nodes/:key`（提取 payload） |
| `fs/write` | 构建 f-node → `PUT /nodes/:key`（多次）→ 逐层重建 d-node |
| `fs/mkdir` | 构建空 d-node → `PUT /nodes/:key`（多次）→ 逐层重建 d-node |
| `fs/rm` | 重建不含目标子节点的 d-node → `PUT /nodes/:key`（多次） |
| `fs/mv` | `rm` + 将引用插入新位置 → 逐层重建 |
| `fs/cp` | 在新位置插入现有节点引用 → 逐层重建 |
| `fs/rewrite` | 解析声明式 entries/deletes → 在内存中计算最终树 → 一次性重建 → `PUT /nodes/:key`（批量） |

### 大文件工作流

当文件超过 `maxNodeSize`（4MB）时，fs API 不适用。客户端应：

```
1. 使用底层 API 分块上传文件
   PUT /api/realm/{realmId}/nodes/node:chunk1...  (s-node)
   PUT /api/realm/{realmId}/nodes/node:chunk2...  (s-node)
   PUT /api/realm/{realmId}/nodes/node:file...    (f-node, 引用 chunks)

2. 使用 rewrite 将已上传的 f-node 挂载到目录树
   POST /api/realm/{realmId}/nodes/depot:MAIN/fs/rewrite
   { entries: { "data/large-file.bin": { "link": "node:file..." } } }
```

> **注意**：`link` 是 rewrite 专有的操作类型，用于将一个已存在的节点挂载到指定路径。不在单独端点中提供。

> **重要**：文件系统 API 是高层抽象，底层仍使用 CAS 不可变节点模型。服务端负责：
> 1. 解析 nodeKey 获取实际 root hash
> 2. 按路径遍历 d-node 树定位目标
> 3. 执行变更并重建 Merkle 路径
> 4. 上传所有新产生的节点
> 5. 返回新 Root

---

## 错误响应格式

所有错误遵循统一格式：

```json
{
  "error": "PATH_NOT_FOUND",
  "message": "The path 'src/nonexistent.ts' does not exist",
  "details": {
    "path": "src/nonexistent.ts",
    "resolvedTo": "src",
    "missingSegment": "nonexistent.ts"
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `error` | `string` | 错误码 |
| `message` | `string` | 人类可读的错误描述 |
| `details` | `object` | 补充信息（可选，按错误类型不同而不同） |

---

## 安全考量

1. **路径遍历防护**：`path` 中不允许 `..` 和绝对路径，仅支持向下的相对路径
2. **大小限制**：read/write 均限制单 block 文件（≤ `maxNodeSize`），防止 Lambda 超限
3. **节点数限制**：`tree` API 通过 BFS limit 控制响应大小，防止资源耗尽
4. **Scope 验证**：所有操作的 root 必须在 Token scope 内，与底层 Node API 保持一致
5. **写操作审计**：所有写操作通过 `canUpload` 权限控制，不可变存储自带审计追踪
6. **rewrite 原子性**：声明式重写全部成功或不产生新 Root，不存在部分应用的中间状态

