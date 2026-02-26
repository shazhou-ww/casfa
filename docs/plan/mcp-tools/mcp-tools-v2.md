# MCP Tools v2 规划

> 日期: 2026-02-26  
> 基于: v1 规划 (2026-02-15) + 已实现的 16 tools + 最新 API 和 Controllers

---

## 核心设计理念

**AI Agent = 文本内容 + 结构感知**

对于 AI agent 而言，它不需要通过 MCP 接口访问非文本内容。如果 agent 有电脑客户端或
sandbox，二进制文件（图片、编译产物等）应在 sandbox 中通过 CLI 上传/下载。因此 MCP
层面 agent 应该更关心：

1. **文件系统的结构**（项目骨架、目录树）— 最高优先级
2. **文本文件的内容**（代码、文档、配置）— 核心能力
3. **搜索与定位**（grep、find）— 大型项目中的效率工具

---

## 一、现状总结

### 已实现的 16 个 Tools

| # | Tool | 类别 | 对应 HTTP 端点 | Annotations |
|---|------|------|---------------|-------------|
| 1 | `list_depots` | Read: Depot | `GET /depots` | readOnly, idempotent |
| 2 | `get_depot` | Read: Depot | `GET /depots/:id` | readOnly, idempotent |
| 3 | `fs_stat` | Read: FS | `GET /nodes/fs/:key/stat` | readOnly, idempotent |
| 4 | `fs_ls` | Read: FS | `GET /nodes/fs/:key/ls` | readOnly, idempotent |
| 5 | `fs_read` | Read: FS | `GET /nodes/fs/:key/read` | readOnly, idempotent |
| 6 | `node_metadata` | Read: Node | `GET /nodes/metadata/:key[/*]` | readOnly, idempotent |
| 7 | `fs_write` | Write: FS | `POST /nodes/fs/:key/write` | idempotent |
| 8 | `fs_mkdir` | Write: FS | `POST /nodes/fs/:key/mkdir` | idempotent |
| 9 | `fs_rm` | Write: FS | `POST /nodes/fs/:key/rm` | destructive |
| 10 | `fs_mv` | Write: FS | `POST /nodes/fs/:key/mv` | destructive |
| 11 | `fs_cp` | Write: FS | `POST /nodes/fs/:key/cp` | idempotent |
| 12 | `fs_rewrite` | Write: FS | `POST /nodes/fs/:key/rewrite` | destructive |
| 13 | `depot_commit` | Write: Depot | `POST /depots/:id/commit` | destructive |
| 14 | `create_delegate` | Write: Delegate | `POST /delegates` | — |
| 15 | `get_realm_info` | Read: Realm | `GET /realm/:realmId` | readOnly, idempotent |
| 16 | `get_usage` | Read: Realm | `GET /realm/:realmId/usage` | readOnly, idempotent |

### 已实现的 4 个 Resource Templates

| URI Template | 说明 | 缓存策略 |
|-------------|------|---------|
| `cas://depot:{depotId}` | Depot 当前 root 元数据 | 可变 — 靠 subscribe 刷新 |
| `cas://depot:{depotId}/{+path}` | Depot 下的文件/目录 | 可变（跟随 depot root） |
| `cas://node:{nodeKey}` | 不可变 CAS 节点元数据 | 永久缓存 |
| `cas://node:{nodeKey}/{+path}` | 不可变节点下的文件/目录 | 永久缓存 |

### 已实现的 4 个 Prompts

| Prompt | 参数 | 说明 |
|--------|------|------|
| `casfa-guide` | — | CAS 概念概览 |
| `edit-files` | `depotId` | 写入工作流指南（链式编辑 + 提交） |
| `explore-project` | `depotId` | 项目探索策略 |
| `refactor` | `depotId` | `fs_rewrite` 使用指南 |

---

## 二、v2 第一批：`fs_tree`（结构感知）

### 为什么优先做 `fs_tree`

AI agent 拿到一个 depot，第一反应是"这个仓库里有什么？结构是怎样的？"——目前只能
一层一层 `fs_ls`，效率很低。`fs_tree` 是 AI 理解项目结构的第一步。

### 设计：深度限制 + 预算截断，不做传统分页

传统分页（offset/cursor）不适合 tree 场景：
- AI 不需要"翻页"，它的模式是 **先看骨架 → 再展开感兴趣的子目录**
- DAG 是 content-addressed 存储，没有天然的稳定 cursor
- 无状态设计，每次调用独立

**核心机制：BFS + maxEntries 预算**

```
BFS 逐节点展开：
  当某节点的直接子节点数 > 剩余 budget
  → 该节点标记 collapsed: true（不展开）
  → 同层后续所有未处理节点也标记 collapsed
  → 停止

已经展开的节点保持完整，不会出现"部分展开"的目录。
Agent 如需查看 collapsed 目录，应该用 fs_tree 缩小 path 范围，
或用 fs_find/fs_grep 搜索感兴趣的内容。
```

### Tool 17: `fs_tree`

```jsonc
{
  "name": "fs_tree",
  "description": "Get a recursive directory tree. Returns a nested JSON structure with file metadata. Directories that exceed the entry budget are marked `collapsed: true` (use fs_tree with a narrower path to expand them). This is typically the first tool to call when exploring a project.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "nodeKey": {
        "type": "string",
        "description": "Root node identifier: depot ID (dpt_xxx) or node key (nod_xxx)"
      },
      "path": {
        "type": "string",
        "description": "Directory path to start from (e.g., 'src'). Omit for root."
      },
      "depth": {
        "type": "number",
        "description": "Max recursion depth (default: 3, -1 for unlimited). Directories beyond this depth are collapsed."
      },
      "maxEntries": {
        "type": "number",
        "description": "Max total entries in the result (default: 500). When budget is exhausted, remaining directories are collapsed."
      }
    },
    "required": ["nodeKey"]
  },
  "annotations": { "readOnlyHint": true, "idempotentHint": true }
}
```

### 返回结构

```typescript
/** 目录节点 */
interface FsTreeDir {
  hash: string;           // nod_xxx
  kind: "dir";
  count: number;          // 直接子节点数（不递归计算）
  collapsed?: true;       // 未展开标记（depth 超限或 budget 不足）
  children?: Record<string, FsTreeNode>;  // name → node（展开时有）
}

/** 文件节点 */
interface FsTreeFile {
  hash: string;           // nod_xxx
  kind: "file";
  type: string;           // content-type, e.g. "text/typescript"
  size: number;           // 文件字节数
}

type FsTreeNode = FsTreeDir | FsTreeFile;

/** 顶层返回（就是根 FsTreeDir + 统计信息） */
interface FsTreeResponse extends FsTreeDir {
  truncated: boolean;     // 是否有节点因 budget 不足被 collapsed
}
```

### 返回示例

```json
{
  "hash": "nod_abc123",
  "kind": "dir",
  "count": 5,
  "truncated": false,
  "children": {
    "README.md": {
      "hash": "nod_fff666",
      "kind": "file",
      "type": "text/markdown",
      "size": 2048
    },
    "package.json": {
      "hash": "nod_eee555",
      "kind": "file",
      "type": "application/json",
      "size": 890
    },
    "src": {
      "hash": "nod_def456",
      "kind": "dir",
      "count": 3,
      "children": {
        "index.ts": {
          "hash": "nod_aaa111",
          "kind": "file",
          "type": "text/typescript",
          "size": 1234
        },
        "services": {
          "hash": "nod_bbb222",
          "kind": "dir",
          "count": 8,
          "collapsed": true
        },
        "utils": {
          "hash": "nod_ccc333",
          "kind": "dir",
          "count": 4,
          "collapsed": true
        }
      }
    },
    "docs": {
      "hash": "nod_ddd444",
      "kind": "dir",
      "count": 15,
      "collapsed": true
    },
    "tsconfig.json": {
      "hash": "nod_ggg777",
      "kind": "file",
      "type": "application/json",
      "size": 312
    }
  }
}
```

AI 一眼可以看出：
- `services/` 有 8 个子项但被折叠，可用 `fs_tree(path: "src/services")` 展开
- `docs/` 有 15 个子项但被折叠
- `utils/` 有 4 个子项但被折叠

### BFS 截断算法伪代码

```
budget = maxEntries

BFS 逐节点展开:
  dequeue node
  entries = loadTreeEntries(node.hash)
  node.count = entries.length

  if node.depth >= maxDepth:
    node.collapsed = true
    continue

  if entries.length > budget:
    node.collapsed = true
    // 同层后续所有未处理节点标记 collapsed
    for remaining in queue where depth == node.depth:
      remaining.collapsed = true
    break  // 停止 BFS

  budget -= entries.length
  node.children = {}
  for entry in entries:
    if entry is dir:
      enqueue { hash, kind: "dir", depth: node.depth + 1 }
    else:
      add { hash, kind: "file", type, size }
    node.children[entry.name] = child
```

### 典型使用模式

```
# 1. 先看整体骨架
fs_tree(nodeKey: "dpt_xxx", depth: 2)

# 2. 看到 src/services 被折叠了，深入展开
fs_tree(nodeKey: "dpt_xxx", path: "src/services", depth: 3)

# 3. 如果某个目录有几百个文件（collapsed），改用搜索
fs_find(nodeKey: "dpt_xxx", pattern: "*.test.ts", path: "src/services")
```

### 实现层级

`fs_tree` 的 BFS 遍历在 `@casfa/fs` 核心包中实现（`read-ops.ts`），服务端
FsService adapter 包装为 `tree(realm, rootNodeKey, path?, depth?, maxEntries?)`，
MCP handler 调用并返回。

---

## 三、后续 v2 规划

以下按优先级排列，在 `fs_tree` 完成后逐步实施。

### P1：`fs_find` — 文件名搜索

按 glob 模式搜索文件/目录名。实现类似 `fs_tree`，BFS 遍历 + glob 匹配 + 结果上限。

### P2：`fs_grep` — 全文搜索

在文件树内搜索文本/正则。实现成本最高（需要遍历 + 逐文件解码 + 匹配），但对
AI coding agent 价值极高。需考虑：
- 跳过二进制文件
- 节点遍历上限（Lambda timeout）
- 大文件只搜索首个 block

### P3：Delegate 生命周期

| Tool | 说明 |
|------|------|
| `list_delegates` | 列出当前 token 的子 delegate |
| `get_delegate` | 查看子 delegate 详情 |
| `revoke_delegate` | 撤销子 delegate |

实现成本低（`delegatesDb` 已有完整 CRUD），对多 Agent 编排场景有价值。

### P4：`create_delegate` 参数增强

补充 `canManageDepot`、`delegatedDepots` 参数。

### P5：`create_depot`

AI 创建新 depot。需要 `canManageDepot` 权限。

---

## 四、设计原则

### 延续 v1

1. **不暴露二进制数据** — AI 通过高层 FS API 和元数据 API 交互
2. **文本优先** — `fs_read`/`fs_write` 仅处理 UTF-8 文本
3. **Tool + Resource 互补** — Tool 供 AI 主动调用，Resource 供客户端附加上下文

### v2 新增

4. **结构优先** — AI 最需要的是项目骨架（`fs_tree`），其次才是文件内容（`fs_read`）
5. **搜索有界** — 搜索/遍历类 Tool 必须有预算上限（`maxEntries`、`maxDepth`、`maxResults`），CAS DAG 可能很大
6. **不做传统分页** — 用深度限制 + BFS 截断 + collapsed 标记替代 cursor 分页，更符合 AI 的交互模式
7. **渐进暴露** — 不一次性暴露所有 API，每个 Tool 增加 AI context 窗口消耗
