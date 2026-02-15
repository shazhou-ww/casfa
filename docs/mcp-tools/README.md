# MCP Tools 规划

> 日期: 2026-02-15

## 设计原则

### 1. 不暴露二进制数据

AI 不适合处理二进制数据。以下底层 API **不暴露**为 MCP Tool：

| 排除的 API | 原因 |
|------------|------|
| `PUT /nodes/raw/:key` | 请求体为 CAS 二进制格式（f-node / d-node / s-node） |
| `GET /nodes/raw/:key` | 响应体为 CAS 二进制节点数据 |
| `GET /nodes/raw/:key/~N...` | 同上，导航后仍返回二进制 |
| `POST /nodes/check` | 底层 CAS 操作，AI 无需直接使用 |
| `POST /nodes/claim` | 底层 ownership 操作（涉及 PoP / path walk） |

AI 通过高层 **文件系统 API**（`/nodes/fs/`）和 **元数据 API**（`/nodes/metadata/`）与 CAS 数据交互，这些 API 返回 JSON 或纯文本，对 AI 友好。

### 2. 不暴露管理与权限 API

管理权限和 auth 隔离 API 无需向 AI 暴露：

| 排除的 API | 原因 |
|------------|------|
| `POST /api/auth/*` | OAuth 2.1 授权流程，由客户端处理 |
| `POST /api/oauth/*` | Cognito 登录代理 |
| `GET/PATCH /api/admin/*` | 用户管理 |
| `GET /realm/{realmId}/delegates` | 列出 Delegate（管理操作） |
| `POST .../delegates/:id/revoke` | 撤销 Delegate（管理操作） |
| `POST /realm/{realmId}/depots` | 创建 Depot（canManageDepot） |
| `PATCH /realm/{realmId}/depots/:id` | 修改 Depot（canManageDepot） |
| `DELETE /realm/{realmId}/depots/:id` | 删除 Depot（canManageDepot） |

这些操作由用户在 Web UI 或 CLI 中完成。

> **例外**：`POST /realm/{realmId}/delegates`（创建子 Delegate）暴露为 MCP Tool，允许 AI Agent 向下分配受限权限的子 Token 给其他 Agent 或工具。

### 3. 文本优先

- `fs_read` 返回文件内容，AI 应仅用于读取文本文件（代码、文档等）
- `fs_write` 接受文本内容，AI 应仅用于写入文本文件
- 大文件（>4MB）需使用底层 Node API 分块处理，不在 MCP Tool 范围内

---

## Tool 总览

| # | Tool | 对应 API | 类型 | 说明 |
|---|------|----------|------|------|
| 1 | `list_depots` | `GET /depots` | 读 | 列出所有 Depot |
| 2 | `get_depot` | `GET /depots/:depotId` | 读 | 获取 Depot 详情 |
| 3 | `fs_stat` | `GET /nodes/fs/:key/stat` | 读 | 获取文件/目录元信息 |
| 4 | `fs_ls` | `GET /nodes/fs/:key/ls` | 读 | 列出目录内容 |
| 5 | `fs_read` | `GET /nodes/fs/:key/read` | 读 | 读取文本文件内容 |
| 6 | `node_metadata` | `GET /nodes/metadata/:key` | 读 | 获取节点结构化元数据 |
| 7 | `fs_write` | `POST /nodes/fs/:key/write` | 写 | 创建或覆盖文本文件 |
| 8 | `fs_mkdir` | `POST /nodes/fs/:key/mkdir` | 写 | 创建目录 |
| 9 | `fs_rm` | `POST /nodes/fs/:key/rm` | 写 | 删除文件或目录 |
| 10 | `fs_mv` | `POST /nodes/fs/:key/mv` | 写 | 移动/重命名 |
| 11 | `fs_cp` | `POST /nodes/fs/:key/cp` | 写 | 复制文件或目录 |
| 12 | `fs_rewrite` | `POST /nodes/fs/:key/rewrite` | 写 | 声明式批量重写 |
| 13 | `depot_commit` | `POST /depots/:depotId/commit` | 写 | 提交新 Root 到 Depot |
| 14 | `create_delegate` | `POST /realm/{realmId}/delegates` | 写 | 创建子 Delegate（分配受限权限） |
| 15 | `get_realm_info` | `GET /realm/{realmId}` | 读 | 获取 Realm 配置信息 |
| 16 | `get_usage` | `GET /realm/{realmId}/usage` | 读 | 获取存储使用统计 |

---

## Tool 详细定义

### 1. list_depots

列出当前用户 Realm 下的所有 Depot。

```jsonc
{
  "name": "list_depots",
  "description": "List all depots in the user's realm. A depot is a named mutable pointer to a CAS root node, like a Git branch. Returns depot IDs, titles, current root keys, and timestamps.",
  "inputSchema": {
    "type": "object",
    "properties": {},
    "required": []
  }
}
```

**返回示例**：

```json
[
  {
    "depotId": "dpt_01H5K6Z9X3ABCDEF01234567",
    "title": "my-project",
    "root": "nod_abc123...",
    "createdAt": 1707600000000,
    "updatedAt": 1707600100000
  }
]
```

---

### 2. get_depot

获取指定 Depot 的详细信息，包括当前 root、历史记录等。

```jsonc
{
  "name": "get_depot",
  "description": "Get details of a specific depot, including its current root node key and commit history. Use the depot's root key as a starting point for file system operations.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "depotId": {
        "type": "string",
        "description": "Depot ID (dpt_ prefix)"
      }
    },
    "required": ["depotId"]
  }
}
```

**返回示例**：

```json
{
  "depotId": "dpt_01H5K6Z9X3ABCDEF01234567",
  "title": "my-project",
  "root": "nod_abc123...",
  "maxHistory": 100,
  "history": ["nod_prev1...", "nod_prev2..."],
  "createdAt": 1707600000000,
  "updatedAt": 1707600100000
}
```

---

### 3. fs_stat

获取文件或目录的元信息。

```jsonc
{
  "name": "fs_stat",
  "description": "Get metadata about a file or directory at a given path. Returns type (file/dir), name, CAS key, size (for files), or child count (for directories). The nodeKey can be a depot ID (dpt_xxx, resolves to current root) or a node key (nod_xxx, immutable hash).",
  "inputSchema": {
    "type": "object",
    "properties": {
      "nodeKey": {
        "type": "string",
        "description": "Root node identifier: depot ID (dpt_xxx) or node key (nod_xxx)"
      },
      "path": {
        "type": "string",
        "description": "Relative path within the tree (e.g., 'src/main.ts'). Omit for root node itself. Supports ~N index segments (e.g., '~0/~1')."
      }
    },
    "required": ["nodeKey"]
  }
}
```

**返回示例（文件）**：

```json
{
  "type": "file",
  "name": "main.ts",
  "key": "nod_abc123...",
  "size": 2048,
  "contentType": "text/typescript"
}
```

**返回示例（目录）**：

```json
{
  "type": "dir",
  "name": "src",
  "key": "nod_def456...",
  "childCount": 5
}
```

---

### 4. fs_ls

列出目录的直接子节点。支持分页。

```jsonc
{
  "name": "fs_ls",
  "description": "List the direct children of a directory. Returns each child's name, type (file/dir), CAS key, index, and size or child count. Supports pagination via cursor. Use this to browse project structure.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "nodeKey": {
        "type": "string",
        "description": "Root node identifier: depot ID (dpt_xxx) or node key (nod_xxx)"
      },
      "path": {
        "type": "string",
        "description": "Directory path within the tree (e.g., 'src/commands'). Omit for root directory."
      },
      "limit": {
        "type": "number",
        "description": "Max children per page (default 100, max 1000)"
      },
      "cursor": {
        "type": "string",
        "description": "Pagination cursor from a previous response"
      }
    },
    "required": ["nodeKey"]
  }
}
```

**返回示例**：

```json
{
  "path": "src",
  "key": "nod_def456...",
  "children": [
    {
      "name": "cli.ts",
      "index": 0,
      "type": "file",
      "key": "nod_aaa...",
      "size": 1024,
      "contentType": "text/typescript"
    },
    {
      "name": "commands",
      "index": 1,
      "type": "dir",
      "key": "nod_bbb...",
      "childCount": 3
    }
  ],
  "total": 2,
  "nextCursor": null
}
```

---

### 5. fs_read

读取文本文件内容。

```jsonc
{
  "name": "fs_read",
  "description": "Read the contents of a text file. Only works for single-block files (≤4MB). Returns the file content as text. Do NOT use this for binary files (images, compiled code, etc.).",
  "inputSchema": {
    "type": "object",
    "properties": {
      "nodeKey": {
        "type": "string",
        "description": "Root node identifier: depot ID (dpt_xxx) or node key (nod_xxx)"
      },
      "path": {
        "type": "string",
        "description": "File path within the tree (e.g., 'src/main.ts'). Supports ~N index segments."
      }
    },
    "required": ["nodeKey"]
  }
}
```

**返回**：文件文本内容（UTF-8）。

> **Note**：底层 HTTP API 返回原始字节（`Content-Type` 为文件 MIME 类型）。MCP handler 需将响应体以 UTF-8 解码为文本返回给 AI。对于二进制文件（图片、编译产物等），AI 端应避免调用此 Tool。

---

### 6. node_metadata

获取 CAS 节点的结构化元数据。

```jsonc
{
  "name": "node_metadata",
  "description": "Get structural metadata of a CAS node. For dict nodes, returns the children map (name → key). For file nodes, returns size and content type. Useful for inspecting the tree structure at the CAS level.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "nodeKey": {
        "type": "string",
        "description": "Node key (nod_xxx) or depot ID (dpt_xxx)"
      },
      "navigation": {
        "type": "string",
        "description": "Optional ~N navigation path from nodeKey (e.g., '~0/~1/~2'). Each segment selects a child by index."
      }
    },
    "required": ["nodeKey"]
  }
}
```

**返回示例（dict 节点）**：

```json
{
  "key": "nod_abc123...",
  "kind": "dict",
  "payloadSize": 0,
  "children": {
    "src": "nod_child1...",
    "README.md": "nod_child2..."
  }
}
```

**返回示例（file 节点）**：

```json
{
  "key": "nod_abc123...",
  "kind": "file",
  "payloadSize": 2048,
  "contentType": "text/typescript",
  "successor": null
}
```

---

### 7. fs_write

创建或覆盖文本文件。

```jsonc
{
  "name": "fs_write",
  "description": "Create or overwrite a text file. Returns a new root node key (CAS is immutable — writes produce a new tree root). The depot is NOT automatically updated; call depot_commit with the returned newRoot to persist the change. For chained edits, use the returned newRoot as the nodeKey for the next operation.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "nodeKey": {
        "type": "string",
        "description": "Root node identifier: depot ID (dpt_xxx) or node key (nod_xxx)"
      },
      "path": {
        "type": "string",
        "description": "File path (e.g., 'src/main.ts'). Intermediate directories are created automatically."
      },
      "content": {
        "type": "string",
        "description": "The text content to write (UTF-8)"
      },
      "contentType": {
        "type": "string",
        "description": "MIME type (default: auto-detected from file extension, fallback 'text/plain')"
      }
    },
    "required": ["nodeKey", "path", "content"]
  }
}
```

**返回示例**：

```json
{
  "newRoot": "nod_newroot...",
  "file": {
    "path": "src/main.ts",
    "key": "nod_filekey...",
    "size": 2048,
    "contentType": "text/typescript"
  },
  "created": true
}
```

> **实现说明**：MCP handler 接收 `content` 字符串，编码为 UTF-8 字节后调用 `POST /nodes/fs/:key/write`，设置对应的 `Content-Type` 和 `Content-Length`。

---

### 8. fs_mkdir

创建目录（自动创建中间目录）。

```jsonc
{
  "name": "fs_mkdir",
  "description": "Create a directory (like mkdir -p). Intermediate directories are created automatically. Idempotent: if the directory already exists, returns the current root without changes.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "nodeKey": {
        "type": "string",
        "description": "Root node identifier: depot ID (dpt_xxx) or node key (nod_xxx)"
      },
      "path": {
        "type": "string",
        "description": "Directory path to create (e.g., 'src/utils/parsers')"
      }
    },
    "required": ["nodeKey", "path"]
  }
}
```

**返回示例**：

```json
{
  "newRoot": "nod_newroot...",
  "dir": {
    "path": "src/utils/parsers",
    "key": "nod_dirkey..."
  },
  "created": true
}
```

---

### 9. fs_rm

删除文件或目录。

```jsonc
{
  "name": "fs_rm",
  "description": "Delete a file or directory. Deleting a directory removes all its children recursively (but CAS nodes are not physically deleted since they may be referenced elsewhere). Returns the new root.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "nodeKey": {
        "type": "string",
        "description": "Root node identifier: depot ID (dpt_xxx) or node key (nod_xxx)"
      },
      "path": {
        "type": "string",
        "description": "Path of the file or directory to delete (e.g., 'src/old-module.ts'). Supports ~N index segments."
      }
    },
    "required": ["nodeKey", "path"]
  }
}
```

**返回示例**：

```json
{
  "newRoot": "nod_newroot...",
  "removed": {
    "path": "src/old-module.ts",
    "type": "file",
    "key": "nod_oldkey..."
  }
}
```

---

### 10. fs_mv

移动或重命名文件/目录。

```jsonc
{
  "name": "fs_mv",
  "description": "Move or rename a file or directory. If the target's parent directory doesn't exist, it is created automatically. Returns the new root.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "nodeKey": {
        "type": "string",
        "description": "Root node identifier: depot ID (dpt_xxx) or node key (nod_xxx)"
      },
      "from": {
        "type": "string",
        "description": "Source path (e.g., 'src/old-name.ts')"
      },
      "to": {
        "type": "string",
        "description": "Destination path (e.g., 'src/utils/new-name.ts')"
      }
    },
    "required": ["nodeKey", "from", "to"]
  }
}
```

**返回示例**：

```json
{
  "newRoot": "nod_newroot...",
  "from": "src/old-name.ts",
  "to": "src/utils/new-name.ts"
}
```

---

### 11. fs_cp

复制文件或目录。

```jsonc
{
  "name": "fs_cp",
  "description": "Copy a file or directory to a new path. In CAS, copying a directory only creates new references (no data duplication). Returns the new root.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "nodeKey": {
        "type": "string",
        "description": "Root node identifier: depot ID (dpt_xxx) or node key (nod_xxx)"
      },
      "from": {
        "type": "string",
        "description": "Source path (e.g., 'src/template.ts')"
      },
      "to": {
        "type": "string",
        "description": "Destination path (e.g., 'src/utils/template-copy.ts')"
      }
    },
    "required": ["nodeKey", "from", "to"]
  }
}
```

**返回示例**：

```json
{
  "newRoot": "nod_newroot...",
  "from": "src/template.ts",
  "to": "src/utils/template-copy.ts"
}
```

---

### 12. fs_rewrite

声明式批量重写目录树。一次性描述目标状态，服务端计算差异并产生新 Root。

```jsonc
{
  "name": "fs_rewrite",
  "description": "Declaratively restructure a directory tree in a single operation. Describe the desired final state through path mappings (from/dir/link) and deletions — the server computes the new tree atomically. No intermediate roots are produced. Use this for batch moves, renames, directory restructuring, or mounting existing nodes. Max 100 total entries + deletes.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "nodeKey": {
        "type": "string",
        "description": "Root node identifier: depot ID (dpt_xxx) or node key (nod_xxx)"
      },
      "entries": {
        "type": "object",
        "description": "Path mappings. Keys are target paths in the new tree. Values are objects with ONE of: {\"from\": \"old/path\"} to reference a node from the original tree, {\"dir\": true} to create an empty directory, or {\"link\": \"nod_xxx\"} to mount an existing CAS node.",
        "additionalProperties": {
          "type": "object",
          "properties": {
            "from": { "type": "string", "description": "Source path in the original tree" },
            "dir": { "type": "boolean", "description": "Create empty directory (must be true)" },
            "link": { "type": "string", "description": "CAS node key to mount (nod_xxx, must be owned)" }
          }
        }
      },
      "deletes": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Paths to delete from the tree"
      }
    },
    "required": ["nodeKey"]
  }
}
```

**请求示例**：

```json
{
  "nodeKey": "dpt_01H5K6Z9X3ABCDEF01234567",
  "entries": {
    "lib/core/index.ts": { "from": "src/core.ts" },
    "lib/core/utils.ts": { "from": "src/utils/core-utils.ts" },
    "lib/plugins": { "from": "src/plugins" }
  },
  "deletes": [
    "src/core.ts",
    "src/utils/core-utils.ts",
    "src/old-plugins"
  ]
}
```

**返回示例**：

```json
{
  "newRoot": "nod_newroot...",
  "entriesApplied": 3,
  "deleted": 3
}
```

**语义说明**：

- `entries` 中的 `from` 引用基于**原树**，即使源路径同时出现在 `deletes` 中也能引用
- 同一路径同时出现在 `entries` 和 `deletes` 中，效果为先删后写
- `from` 配合 `deletes` = mv；`from` 不配 `deletes` = cp
- 中间目录自动创建
- 全部成功或全部不生效（原子操作）

---

### 13. depot_commit

将新 Root 提交到 Depot。文件系统写操作只产生新 Root，不自动更新 Depot；需要显式调用此 Tool 完成提交。

```jsonc
{
  "name": "depot_commit",
  "description": "Commit a new root node to a depot. File system write operations (fs_write, fs_rm, fs_mv, etc.) produce a new root but do NOT update the depot automatically. Call this to persist the new root. The old root is moved to history.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "depotId": {
        "type": "string",
        "description": "Depot ID (dpt_ prefix)"
      },
      "root": {
        "type": "string",
        "description": "New root node key (nod_ prefix) from a previous write operation"
      }
    },
    "required": ["depotId", "root"]
  }
}
```

**返回**：更新后的完整 Depot 对象（同 `get_depot`）。

---

### 14. create_delegate

创建子 Delegate，分配受限权限给其他 Agent 或工具。子 Delegate 的权限不能超过父 Delegate。

```jsonc
{
  "name": "create_delegate",
  "description": "Create a child delegate with restricted permissions. The child inherits the caller's realm and cannot exceed the caller's permissions (canUpload, canManageDepot, expiration, scope). Returns a new access token and refresh token for the child delegate. Use this to grant limited access to other AI agents or tools — e.g., read-only access to a specific subtree.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "name": {
        "type": "string",
        "description": "Display name for the delegate (e.g., 'code-review-agent', 'doc-writer')"
      },
      "canUpload": {
        "type": "boolean",
        "description": "Allow write operations (upload nodes, fs_write, etc.). Default: false. Cannot exceed parent's permission."
      },
      "scope": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Scope paths restricting accessible nodes. '.' inherits all parent scope roots. '0:1:2' navigates parent root 0 → child 1 → child 2 to create a narrower scope. Omit to inherit parent's full scope."
      },
      "expiresIn": {
        "type": "number",
        "description": "Lifetime in seconds. Cannot exceed parent's remaining lifetime. Omit for no expiry (bounded by parent)."
      }
    },
    "required": []
  }
}
```

> **注**：`canManageDepot` 和 `delegatedDepots` 不暴露给 AI — Depot 管理是用户级操作。AI 创建的子 Delegate 默认 `canManageDepot: false`。

**返回示例**：

```json
{
  "delegate": {
    "delegateId": "dlt_01HQXK5V8N3Y7M2P4R6T9W0ABC",
    "name": "code-review-agent",
    "realm": "usr_abc123",
    "parentId": "dlt_PARENT...",
    "depth": 2,
    "canUpload": false,
    "canManageDepot": false,
    "expiresAt": 1738584000000,
    "createdAt": 1738497600000
  },
  "accessToken": "base64...",
  "accessTokenExpiresAt": 1738501200000,
  "refreshToken": "base64..."
}
```

**典型场景**：

| 场景 | 参数 |
|------|------|
| 只读代码审查 Agent | `{ name: "reviewer", canUpload: false, scope: ["."] }` |
| 限时写入 Agent | `{ name: "writer", canUpload: true, expiresIn: 3600 }` |
| 子目录只读 Agent | `{ name: "docs-reader", scope: ["0:2"] }` — 仅访问 parent scope root 0 的第 2 个子节点 |

---

### 15. get_realm_info

获取 Realm 配置信息。

```jsonc
{
  "name": "get_realm_info",
  "description": "Get the current realm's configuration and limits, including whether the token has upload (write) permission.",
  "inputSchema": {
    "type": "object",
    "properties": {},
    "required": []
  }
}
```

**返回示例**：

```json
{
  "realm": "usr_abc123",
  "commit": {},
  "nodeLimit": 4194304,
  "maxNameBytes": 255
}
```

> `commit` 字段存在时表示当前 Token 有 `canUpload` 权限。

---

### 16. get_usage

获取 Realm 的存储使用统计。

```jsonc
{
  "name": "get_usage",
  "description": "Get storage usage statistics for the current realm, including physical/logical bytes, node count, and quota.",
  "inputSchema": {
    "type": "object",
    "properties": {},
    "required": []
  }
}
```

**返回示例**：

```json
{
  "realm": "usr_abc123",
  "physicalBytes": 1073741824,
  "logicalBytes": 2147483648,
  "nodeCount": 15000,
  "quotaLimit": 10737418240,
  "updatedAt": 1707600000000
}
```

---

## 典型工作流

### 浏览项目结构

```
AI 调用顺序：
1. list_depots         → 找到 "my-project" 的 depotId
2. fs_ls(dpt_xxx)      → 查看根目录
3. fs_ls(dpt_xxx, "src")  → 深入 src 目录
4. fs_read(dpt_xxx, "src/main.ts")  → 读取文件内容
```

### 修改单个文件并提交

```
1. fs_read(dpt_xxx, "src/config.ts")    → 读取当前内容
2. fs_write(dpt_xxx, "src/config.ts", newContent)
     → { newRoot: "nod_A..." }
3. depot_commit(dpt_xxx, "nod_A...")     → 提交
```

### 链式多文件修改

```
1. fs_write(dpt_xxx, "src/a.ts", contentA)
     → { newRoot: "nod_step1..." }
2. fs_write("nod_step1...", "src/b.ts", contentB)    ← 用上一步的 newRoot
     → { newRoot: "nod_step2..." }
3. fs_write("nod_step2...", "src/c.ts", contentC)
     → { newRoot: "nod_step3..." }
4. depot_commit(dpt_xxx, "nod_step3...")              ← 一次性提交最终结果
```

### 目录重构

```
1. fs_rewrite(dpt_xxx, {
     entries: {
       "lib/core.ts":  { from: "src/core.ts" },
       "lib/utils.ts": { from: "src/utils.ts" }
     },
     deletes: ["src/core.ts", "src/utils.ts", "src/deprecated"]
   })
     → { newRoot: "nod_refactored..." }
2. depot_commit(dpt_xxx, "nod_refactored...")
```

### 创建新文件 + 重构（混合操作）

```
1. fs_write(dpt_xxx, "src/new-module/index.ts", code)
     → { newRoot: "nod_step1..." }
2. fs_rewrite("nod_step1...", {
     entries: {
       "src/new-module/helper.ts": { from: "src/utils/helper.ts" }
     },
     deletes: ["src/utils/helper.ts"]
   })
     → { newRoot: "nod_step2..." }
3. depot_commit(dpt_xxx, "nod_step2...")
```

### 分配子 Agent 权限

```
1. create_delegate({
     name: "code-review-bot",
     canUpload: false,
     expiresIn: 7200
   })
     → { delegate: { delegateId: "dlt_xxx" }, accessToken: "...", refreshToken: "..." }
     # 将 accessToken 交给子 Agent 使用

2. 子 Agent 用新 Token 调用 MCP：
   fs_ls(dpt_xxx)           → 可以浏览
   fs_read(dpt_xxx, "...")  → 可以读取
   fs_write(...)            → ❌ 403 UPLOAD_NOT_ALLOWED（只读）
```

---

## 实现注意事项

### MCP Handler 中的数据转换

| Tool | 转换需求 |
|------|---------|
| `fs_read` | HTTP 响应 body（raw bytes）→ UTF-8 文本字符串 |
| `fs_write` | `content` 字符串 → UTF-8 bytes → HTTP 请求 body |
| `create_delegate` | 响应中 `refreshToken` 和 `accessToken` 为 base64 编码字符串，AI 可直接传递 |
| 其他 | JSON ↔ JSON，无需额外转换 |

### Realm 自动推断

所有 Tool 调用中不需要传 `realmId` 参数。MCP handler 从 AccessTokenAuthContext 中获取 `realm`，自动拼接到 HTTP API 路径中。

### 错误映射

MCP Tool 的错误应映射为 MCP 标准错误格式：

```json
{
  "content": [{
    "type": "text",
    "text": "Error: PATH_NOT_FOUND — The path 'src/nonexistent.ts' does not exist"
  }],
  "isError": true
}
```

### nodeKey 的灵活性

所有接受 `nodeKey` 的 Tool 同时支持：
- `dpt_xxx` — 解析为 Depot 当前 root（可变，适合首次操作）
- `nod_xxx` — 直接使用节点 hash（不可变，适合链式操作中使用上一步的 `newRoot`）

这使得 AI 可以用简洁的 `dpt_xxx` 开始操作，链式修改时切换到 `nod_xxx`，无需额外 API 调用。
