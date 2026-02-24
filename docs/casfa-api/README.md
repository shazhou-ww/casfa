# CASFA API 文档

CASFA (Content-Addressable Storage for Agents) 是一个为 AI Agent 设计的内容寻址存储服务 API。

> **日期**: 2026-02-15

## 概述

所有 API 路由均以 `/api` 为前缀。

CASFA 采用 **Delegate 授权体系**，提供统一的认证和授权机制。

## 认证体系

### Token 类型

| 类型 | Header 格式 | 说明 |
|------|-------------|------|
| User JWT | `Authorization: Bearer {jwt}` | OAuth 登录后获取，用于管理操作，Root Delegate 也可直接访问数据 |
| Access Token (AT) | `Authorization: Bearer {base64}` | 32 字节二进制 Token，用于 CAS 数据操作 |
| Refresh Token (RT) | `Authorization: Bearer {base64}` | 24 字节二进制 Token，用于旋转获取新 RT + AT |

### Delegate 模型

所有授权实体统一为 **Delegate**：

- **Root Delegate**（depth=0）：服务器中间件在用户首次 JWT 请求时自动创建，使用 User JWT 直接访问数据，无需 RT/AT
- **Child Delegate**（depth>0）：通过 `POST /api/realm/{realmId}/delegates` 转签发，持有 RT + AT

### Token 能力对比

| 能力 | User JWT (Root Delegate) | Access Token (Child) | Refresh Token |
|------|--------------------------|---------------------|---------------|
| 转签发 Child Delegate | ✓ | ✓ | ✗ |
| 读取 Node | ✓ | ✓ | ✗ |
| 写入 Node | ✓ (需 canUpload) | ✓ (需 canUpload) | ✗ |
| Depot 操作 | ✓ (需 canManageDepot) | ✓ (需 canManageDepot) | ✗ |
| 旋转获取新 AT | ✗ (JWT 自动续期) | ✗ | ✓ |
| 管理用户 | ✓ (需 admin) | ✗ | ✗ |

> **Root Delegate 特殊性**：Root delegate 使用 JWT 直接访问 Realm 数据路由，中间件自动将 JWT 转换为 `AccessTokenAuthContext`，下游无感知。Root delegate 不持有 RT/AT，不需要 refresh。PoP 验证也自动跳过。

### 授权模型

Realm 路由中对 `:key`（nodeId）执行 **Direct Authorization Check**：

```
nodeId 授权判定：
  1. root delegate（depth=0）→ ✅ 任意 nodeId 放行
  2. hasOwnership(nodeId, delegateId) → ✅ 放行
  3. nodeId ∈ delegate.scopeRoots → ✅ 放行
  4. 否则 → ❌ 403
```

这是 O(1) 检查，不需要自定义 Header（`X-CAS-Proof`）或 DAG proof walk。

URL 中的 `~N` 导航段 / FS `?path=` 中的 `~N` 段提供从 `nodeId` 向下的隐式授权 — 能从 `nodeId` 沿 DAG 走到的节点，天然在 delegate 的授权范围内。

## ID 格式规范

所有标识符使用统一的 `prefix_[CrockfordBase32]{26}` 格式（128 位）：

| 类型 | 前缀 | 示例 |
|------|------|------|
| User ID | `usr_` | `usr_A6JCHNMFWRT90AXMYWHJ8HKS90` |
| Delegate ID | `dlt_` | `dlt_01HQXK5V8N3Y7M2P4R6T9W0ABC` |
| Depot ID | `dpt_` | `dpt_01HQXK5V8N3Y7M2P4R6T9W0DEF` |
| Request ID | `req_` | `req_01HQXK5V8N3Y7M2P4R6T9W0GHI` |
| Node Key | `nod_` | `nod_abc123def456...`（hex 编码的 Blake3 hash） |

> **Delegate ID** 使用 ULID 格式（48 位时间戳 + 80 位随机 = 128 位），自然按时间排序。

### Token 二进制格式

| Token 类型 | 大小 | 布局 |
|------------|------|------|
| Access Token (AT) | 32 字节 | `[delegateId 16B][expiresAt 8B][nonce 8B]` |
| Refresh Token (RT) | 24 字节 | `[delegateId 16B][nonce 8B]` |

> **安全设计**：服务端不保存完整 Token，仅保存 Token 的 Blake3 hash。Token 仅在创建时返回一次。

## 时间格式规范

| 类型 | 格式 | 单位 | 示例 |
|------|------|------|------|
| 时间戳 | Unix epoch | 毫秒 (int64) | `1738497600000` |
| 持续时间 | 整数 | 秒 (int32) | `3600` (1 小时) |

### 字段命名约定

| 后缀 | 类型 | 示例 |
|------|------|------|
| `*At` | 时间戳（毫秒） | `createdAt`, `expiresAt`, `updatedAt` |
| `*In` | 持续时间（秒） | `expiresIn` |

## 路由表

### 服务信息

[详细文档](./00-info.md)

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/api/health` | 服务健康检查 | 无 |
| GET | `/api/info` | 获取服务配置信息 | 无 |

### OAuth 认证 API

[详细文档](./01-oauth.md)

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/api/oauth/config` | 获取 Cognito 配置 | 无 |
| POST | `/api/oauth/token` | 交换授权码获取 Token | 无 |
| POST | `/api/oauth/login` | 用户登录（邮箱密码） | 无 |
| POST | `/api/oauth/refresh` | 刷新 JWT Token | 无 |
| GET | `/api/oauth/me` | 获取当前用户信息 | User JWT |

### Local Auth（本地认证，`AUTH_MODE=local` 时启用）

[详细文档](./01-oauth.md#local-auth本地认证)

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| POST | `/api/local/register` | 用户注册 | 无 |
| POST | `/api/local/login` | 用户登录 | 无 |
| POST | `/api/local/refresh` | 刷新 JWT Token | 无 |

### Auth API

[详细文档](./02-auth.md)

#### Well-Known 元数据

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/.well-known/oauth-authorization-server` | OAuth 2.1 授权服务器元数据 | 无 |
| GET | `/.well-known/oauth-protected-resource` | 受保护资源元数据 | 无 |

#### OAuth 2.1 授权

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| POST | `/api/auth/register` | 动态客户端注册 | 无 |
| GET | `/api/auth/authorize/info` | 获取授权请求信息 | 无 |
| POST | `/api/auth/authorize` | 批准授权请求 | User JWT |
| POST | `/api/auth/token` | Token 端点（授权码/刷新） | 无 |

#### 内部 Token 刷新

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| POST | `/api/auth/refresh` | 旋转 RT → 新 RT + AT | Refresh Token |

### Admin 管理 API

[详细文档](./03-admin.md)

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/api/admin/users` | 列出所有用户 | Admin |
| PATCH | `/api/admin/users/:userId` | 修改用户角色 | Admin |

### Realm CAS 操作 API

[详细文档](./04-realm/README.md)

#### Node 二进制操作

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| PUT | `/api/realm/{realmId}/nodes/raw/:key` | 上传节点 | AT 或 JWT (canUpload) |
| GET | `/api/realm/{realmId}/nodes/raw/:key` | 读取节点二进制 | AT 或 JWT |
| GET | `/api/realm/{realmId}/nodes/raw/:key/~0/~1` | 导航读取节点 | AT 或 JWT |

#### Node Metadata 操作

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/api/realm/{realmId}/nodes/metadata/:key` | 获取节点元信息 | AT 或 JWT |
| GET | `/api/realm/{realmId}/nodes/metadata/:key/~0/~1` | 导航获取元信息 | AT 或 JWT |

#### Node 文件系统操作

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/api/realm/{realmId}/nodes/fs/:key/stat` | 文件/目录元信息 | AT 或 JWT |
| GET | `/api/realm/{realmId}/nodes/fs/:key/read` | 读取文件内容 | AT 或 JWT |
| GET | `/api/realm/{realmId}/nodes/fs/:key/ls` | 列出目录内容 | AT 或 JWT |
| POST | `/api/realm/{realmId}/nodes/fs/:key/write` | 创建或覆盖文件 | AT 或 JWT (canUpload) |
| POST | `/api/realm/{realmId}/nodes/fs/:key/mkdir` | 创建目录 | AT 或 JWT (canUpload) |
| POST | `/api/realm/{realmId}/nodes/fs/:key/rm` | 删除文件或目录 | AT 或 JWT (canUpload) |
| POST | `/api/realm/{realmId}/nodes/fs/:key/mv` | 移动/重命名 | AT 或 JWT (canUpload) |
| POST | `/api/realm/{realmId}/nodes/fs/:key/cp` | 复制文件或目录 | AT 或 JWT (canUpload) |
| POST | `/api/realm/{realmId}/nodes/fs/:key/rewrite` | 声明式批量重写 | AT 或 JWT (canUpload) |

#### Node Check & Claim 操作

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| POST | `/api/realm/{realmId}/nodes/check` | 批量检查节点状态 | AT 或 JWT |
| POST | `/api/realm/{realmId}/nodes/claim` | 批量 Claim 节点所有权 | AT 或 JWT (canUpload) |

#### Delegate 管理

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| POST | `/api/realm/{realmId}/delegates` | 创建子 Delegate | AT 或 JWT |
| GET | `/api/realm/{realmId}/delegates` | 列出直属子 Delegate | AT 或 JWT |
| GET | `/api/realm/{realmId}/delegates/:delegateId` | 获取 Delegate 详情 | AT 或 JWT |
| POST | `/api/realm/{realmId}/delegates/:delegateId/revoke` | 撤销 Delegate（级联） | AT 或 JWT |

#### Depot 操作

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/api/realm/{realmId}/depots` | 列出 Depot | AT 或 JWT |
| POST | `/api/realm/{realmId}/depots` | 创建 Depot | AT 或 JWT (canManageDepot) |
| GET | `/api/realm/{realmId}/depots/:depotId` | 获取 Depot 详情 | AT 或 JWT |
| PATCH | `/api/realm/{realmId}/depots/:depotId` | 修改 Depot | AT 或 JWT (canManageDepot) |
| DELETE | `/api/realm/{realmId}/depots/:depotId` | 删除 Depot | AT 或 JWT (canManageDepot) |
| POST | `/api/realm/{realmId}/depots/:depotId/commit` | 提交新 Root | AT 或 JWT (canUpload) |

#### 基本信息

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/api/realm/{realmId}` | 获取 Realm 端点信息 | AT 或 JWT |
| GET | `/api/realm/{realmId}/usage` | 获取使用统计 | AT 或 JWT |

### MCP API

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| POST | `/api/mcp` | MCP JSON-RPC 端点 | AT 或 JWT |

### CAS 内容服务（decoded 内容访问）

以 decoded 形式提供 CAS 内容：d-node 返回 JSON children listing，f-node 返回带 MIME 类型的文件内容，s-node 返回 422 错误。

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/cas/:key` | 直接读取 decoded CAS 内容 | AT 或 JWT |
| GET | `/cas/:key/~0/~1/...` | 导航读取 decoded CAS 内容 | AT 或 JWT |

## 错误响应

所有 API 在发生错误时返回统一格式：

```json
{
  "error": "错误代码",
  "message": "人类可读的错误描述",
  "details": { ... }
}
```

### 错误代码列表

| 错误代码 | HTTP 状态码 | 描述 |
|---------|------------|------|
| `validation_error` | 400 | 请求参数验证失败 |
| `INVALID_TOKEN_FORMAT` | 401 | Token 格式无效 |
| `TOKEN_INVALID` | 401 | Token 已失效（可能被重放） |
| `DELEGATE_NOT_FOUND` | 401/404 | Delegate 不存在 |
| `DELEGATE_REVOKED` | 401/403 | Delegate 已被撤销 |
| `DELEGATE_EXPIRED` | 401 | Delegate 已过期 |
| `DELEGATE_ALREADY_REVOKED` | 409 | Delegate 已被撤销（重复操作） |
| `ROOT_REFRESH_NOT_ALLOWED` | 400 | Root delegate 不支持 refresh |
| `NOT_REFRESH_TOKEN` | 400 | 期望 RT 但收到了 AT |
| `UNAUTHORIZED` | 401 | 未认证或 Token 无效 |
| `FORBIDDEN` | 403 | 权限不足 |
| `INVALID_REALM` | 400 | 无效的 Realm |
| `REALM_MISMATCH` | 403 | Token realm 与 URL realmId 不匹配 |
| `INVALID_SCOPE` | 400 | Scope 不是父 delegate 的子集 |
| `PERMISSION_ESCALATION` | 400 | 权限不能超过父 delegate |
| `NODE_NOT_AUTHORIZED` | 403 | nodeId 未通过 Direct Authorization Check |
| `UPLOAD_NOT_ALLOWED` | 403 | Token 没有 canUpload 权限 |
| `DEPOT_MANAGE_NOT_ALLOWED` | 403 | Token 没有 canManageDepot 权限 |
| `ROOT_NOT_AUTHORIZED` | 403 | Root 引用验证失败 |
| `CHILD_NOT_AUTHORIZED` | 403 | 子节点引用验证失败（PUT 时子节点 ownership 检查不通过） |
| `INVALID_POP` | 403 | Proof-of-Possession 校验失败 |
| `NODE_NOT_FOUND` | 404 | 节点不存在 |
| `REALM_QUOTA_EXCEEDED` | 403 | 超出 Realm 配额限制 |
| `MAX_DEPTH_EXCEEDED` | 400 | 超出最大转签发深度 |
| `INTERNAL_ERROR` | 500 | 服务器内部错误 |

## 幂等性保证

### 幂等操作

| 操作 | 幂等性 | 说明 |
|------|--------|------|
| `GET` 所有端点 | ✅ 幂等 | 读取操作 |
| `PUT /nodes/raw/:key` | ✅ 幂等 | 相同内容产生相同 key |
| `DELETE` 资源 | ✅ 幂等 | 重复删除返回成功 |
| `fs/stat`, `fs/read`, `fs/ls` | ✅ 幂等 | 读取操作 |
| `fs/mkdir` | ⚠️ 条件幂等 | 目录已存在时返回当前 root |

### 非幂等操作

| 操作 | 幂等性 | 说明 |
|------|--------|------|
| `POST /realm/{realmId}/delegates` | ❌ 非幂等 | 每次创建新 delegate + RT + AT |
| `POST /auth/refresh` | ❌ 非幂等 | 每次旋转产生新 RT + AT |
| `fs/write`, `fs/rm`, `fs/mv`, `fs/cp` | ❌ 非幂等 | 每次产生新 root |
| `fs/rewrite` | ❌ 非幂等 | 声明式重写，每次产生新 root |

## 相关文档

- [服务信息 API](./00-info.md)
- [OAuth 认证 API](./01-oauth.md)
- [Auth API](./02-auth.md)
- [Admin 管理 API](./03-admin.md)
- [Realm CAS 操作 API](./04-realm/README.md)
