# Realm CAS 操作 API

通过 Realm 路由访问 CAS 存储的 API。所有数据访问需要 **Access Token（AT）或 User JWT**（Root Delegate）。

## 认证

所有 Realm 路由需要 `Authorization` header：

```http
Authorization: Bearer {access_token_base64 或 jwt}
```

中间件自动识别格式：
- 包含 `.` 分隔符 → JWT（Root Delegate，depth=0）
- 否则 → AT（子 Delegate，depth≥1）

> **注**：Refresh Token (RT) 只能用于 `POST /api/auth/refresh` 换取新 AT，不能直接访问数据。

### Realm 验证

URL 中的 `realmId` 必须与 Token 关联的 realm 一致，否则返回 `403 REALM_MISMATCH`。

## 授权模型

### Direct Authorization Check

Node / Metadata / FS 路由中的 `:key` 参数必须是 delegate **直接有权访问**的节点：

```
nodeId 授权判定：
  1. root delegate（depth=0）→ ✅ 任意 nodeId 放行
  2. hasOwnership(nodeId, delegateId) → ✅ 放行
  3. nodeId ∈ delegate.scopeRoots → ✅ 放行
  4. 否则 → ❌ 403 NODE_NOT_AUTHORIZED
```

这是 O(1) 检查。不需要自定义 Header 或 proof walk。

### 隐式授权（~N 导航）

通过 Direct Authorization Check 后，URL 中的 `~N` 导航段或 FS `?path=` 中的 `~N` 前缀段，沿 DAG children 数组向下遍历。到达的任何节点都在 `nodeId` 子树中，天然在授权范围内。

`~N` 格式遵循 CAS URI 规范（`02-cas-uri.md`），表示 children 数组的第 N 个子节点。

## 子文档

- [端点信息与使用统计](./01-endpoint.md) — Realm 基本信息和 usage 统计
- [Node 操作](./02-nodes.md) — 节点的读取、上传与导航
- [文件系统操作](./03-filesystem.md) — 基于 Node 的类文件系统 CRUD
- [Depot 管理](./04-depots.md) — 命名存储空间的 CRUD 与 Commit
- [Check & Claim](./05-claim.md) — 批量检查节点状态与 claim 所有权

## 端点列表

### 基本信息

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/api/realm/{realmId}` | 获取 Realm 端点信息 | AT 或 JWT |
| GET | `/api/realm/{realmId}/usage` | 获取使用统计 | AT 或 JWT |

### Delegate 管理

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| POST | `/api/realm/{realmId}/delegates` | 创建子 Delegate | AT 或 JWT |
| GET | `/api/realm/{realmId}/delegates` | 列出直属子 Delegate | AT 或 JWT |
| GET | `/api/realm/{realmId}/delegates/:delegateId` | 获取 Delegate 详情 | AT 或 JWT |
| POST | `/api/realm/{realmId}/delegates/:delegateId/revoke` | 撤销 Delegate（级联） | AT 或 JWT |

### Node 操作

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| PUT | `/api/realm/{realmId}/nodes/:key` | 上传节点 | AT 或 JWT (canUpload) |
| GET | `/api/realm/{realmId}/nodes/:key` | 读取节点二进制 | AT 或 JWT |
| GET | `/api/realm/{realmId}/nodes/:key/~0/~1/...` | 导航读取节点 | AT 或 JWT |

### Metadata 操作

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/api/realm/{realmId}/metadata/:key` | 获取节点元信息 | AT 或 JWT |
| GET | `/api/realm/{realmId}/metadata/:key/~0/~1/...` | 导航获取元信息 | AT 或 JWT |

### 文件系统操作

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/api/realm/{realmId}/fs/:key/stat` | 获取文件/目录元信息 | AT 或 JWT |
| GET | `/api/realm/{realmId}/fs/:key/read` | 读取文件内容 | AT 或 JWT |
| GET | `/api/realm/{realmId}/fs/:key/ls` | 列出目录内容 | AT 或 JWT |
| POST | `/api/realm/{realmId}/fs/:key/write` | 创建或覆盖文件 | AT 或 JWT (canUpload) |
| POST | `/api/realm/{realmId}/fs/:key/mkdir` | 创建目录 | AT 或 JWT (canUpload) |
| POST | `/api/realm/{realmId}/fs/:key/rm` | 删除文件或目录 | AT 或 JWT (canUpload) |
| POST | `/api/realm/{realmId}/fs/:key/mv` | 移动/重命名 | AT 或 JWT (canUpload) |
| POST | `/api/realm/{realmId}/fs/:key/cp` | 复制文件或目录 | AT 或 JWT (canUpload) |
| POST | `/api/realm/{realmId}/fs/:key/rewrite` | 声明式批量重写 | AT 或 JWT (canUpload) |

### Check & Claim 操作

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| POST | `/api/realm/{realmId}/check` | 批量检查节点状态 | AT 或 JWT |
| POST | `/api/realm/{realmId}/claim` | 批量 Claim 节点所有权 | AT 或 JWT (canUpload) |

### Depot 操作

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/api/realm/{realmId}/depots` | 列出 Depot | AT 或 JWT |
| POST | `/api/realm/{realmId}/depots` | 创建 Depot | AT 或 JWT (canManageDepot) |
| GET | `/api/realm/{realmId}/depots/:depotId` | 获取 Depot 详情 | AT 或 JWT |
| PATCH | `/api/realm/{realmId}/depots/:depotId` | 修改 Depot | AT 或 JWT (canManageDepot) |
| DELETE | `/api/realm/{realmId}/depots/:depotId` | 删除 Depot | AT 或 JWT (canManageDepot) |
| POST | `/api/realm/{realmId}/depots/:depotId/commit` | 提交新 Root | AT 或 JWT (canUpload) |

## 权限控制

### Delegate 权限标志

| 标志 | 影响的操作 |
|------|-----------|
| `canUpload` | 允许上传节点（`PUT /nodes/:key`）、Claim 节点、Commit Depot、文件系统写操作 |
| `canManageDepot` | 允许创建/修改/删除 Depot |

### Scope 限制

读取节点时，`:key` 必须通过 Direct Authorization Check。不再需要 `X-CAS-Proof` 自定义 Header。

```bash
# Scoped delegate 访问自己的 scope root
GET /api/realm/{realmId}/nodes/nod_SCOPE_ROOT
Authorization: Bearer {access_token}

# 从 scope root 沿 ~N 导航
GET /api/realm/{realmId}/nodes/nod_SCOPE_ROOT/~1/~2
Authorization: Bearer {access_token}
```
