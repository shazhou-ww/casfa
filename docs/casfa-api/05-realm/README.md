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

## 子文档

- [端点信息与使用统计](./01-endpoint.md) — Realm 基本信息和 usage 统计
- [Ticket 管理](./02-tickets.md) — ⚠️ 未实现
- [Node 操作](./03-nodes.md) — 节点的读取、上传与 Claim
- [Depot 管理](./04-depots.md) — 命名存储空间的 CRUD 与 Commit

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
| POST | `/api/realm/{realmId}/nodes/check` | 批量检查节点状态 | AT 或 JWT |
| PUT | `/api/realm/{realmId}/nodes/:key` | 上传节点 | AT 或 JWT (canUpload) |
| GET | `/api/realm/{realmId}/nodes/:key` | 读取节点原始二进制 | AT 或 JWT + Proof |
| GET | `/api/realm/{realmId}/nodes/:key/metadata` | 获取节点元信息 | AT 或 JWT + Proof |
| POST | `/api/realm/{realmId}/nodes/:key/claim` | PoP 方式 Claim 节点所有权 | AT 或 JWT (canUpload) |

### 文件系统操作

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `…/nodes/:key/fs/stat` | 获取文件/目录元信息 | AT 或 JWT + Proof |
| GET | `…/nodes/:key/fs/read` | 读取文件内容 | AT 或 JWT + Proof |
| GET | `…/nodes/:key/fs/ls` | 列出目录内容 | AT 或 JWT + Proof |
| POST | `…/nodes/:key/fs/write` | 创建或覆盖文件 | AT 或 JWT + Proof (canUpload) |
| POST | `…/nodes/:key/fs/mkdir` | 创建目录 | AT 或 JWT + Proof (canUpload) |
| POST | `…/nodes/:key/fs/rm` | 删除文件或目录 | AT 或 JWT + Proof (canUpload) |
| POST | `…/nodes/:key/fs/mv` | 移动/重命名 | AT 或 JWT + Proof (canUpload) |
| POST | `…/nodes/:key/fs/cp` | 复制文件或目录 | AT 或 JWT + Proof (canUpload) |
| POST | `…/nodes/:key/fs/rewrite` | 声明式批量重写目录树 | AT 或 JWT + Proof (canUpload) |

> 文件系统操作详见 [04-filesystem.md](../04-filesystem.md)。

### Depot 操作

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/api/realm/{realmId}/depots` | 列出 Depot | AT 或 JWT |
| POST | `/api/realm/{realmId}/depots` | 创建 Depot | AT 或 JWT (canManageDepot) |
| GET | `/api/realm/{realmId}/depots/:depotId` | 获取 Depot 详情 | AT 或 JWT |
| PATCH | `/api/realm/{realmId}/depots/:depotId` | 修改 Depot 元信息 | AT 或 JWT (canManageDepot) |
| DELETE | `/api/realm/{realmId}/depots/:depotId` | 删除 Depot | AT 或 JWT (canManageDepot) |
| POST | `/api/realm/{realmId}/depots/:depotId/commit` | 提交新 Root | AT 或 JWT (canUpload) |

## 权限控制

### Delegate 权限标志

| 标志 | 影响的操作 |
|------|-----------|
| `canUpload` | 允许上传节点（`PUT /nodes/:key`）、Claim 节点、Commit Depot、文件系统写操作 |
| `canManageDepot` | 允许创建/修改/删除 Depot |

### Scope 限制

读取节点时需要证明节点在 Delegate 的 scope 内。通过 `X-CAS-Proof` Header 提供证明：

```http
GET /api/realm/{realmId}/nodes/:key
Authorization: Bearer {access_token}
X-CAS-Proof: 0:1:2
```

### 所有权验证

上传节点时，d-node 的每个 child 引用都需通过所有权验证：

1. **Ownership 验证**：child 被 Delegate 链中任一成员上传过
2. **Scope 验证**：通过 `X-CAS-Child-Proofs` Header 提供 child 的 scope 证明

## 错误响应

### Token 相关

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `INVALID_TOKEN_FORMAT` | 401 | Token 格式无效 |
| `TOKEN_NOT_FOUND` | 401 | Delegate 不存在 |
| `TOKEN_REVOKED` | 401 | Delegate 已被撤销 |
| `TOKEN_EXPIRED` | 401 | AT 已过期 |
| `ACCESS_TOKEN_REQUIRED` | 403 | 需要 AT 或 JWT |

### 访问控制相关

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `REALM_MISMATCH` | 403 | Token realm 与 URL realmId 不匹配 |
| `NODE_NOT_IN_SCOPE` | 403 | 节点不在授权范围 |
| `UPLOAD_NOT_ALLOWED` | 403 | Delegate 没有 canUpload 权限 |
| `DEPOT_MANAGE_NOT_ALLOWED` | 403 | Delegate 没有 canManageDepot 权限 |
| `CHILD_NOT_AUTHORIZED` | 403 | 上传 d-node 时子节点引用验证失败 |
| `ROOT_NOT_AUTHORIZED` | 403 | Commit Depot 时 root 所有权验证失败 |
