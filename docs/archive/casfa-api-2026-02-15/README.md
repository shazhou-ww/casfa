# CASFA API 文档

CASFA (Content-Addressable Storage for Agents) 是一个为 AI Agent 设计的内容寻址存储服务 API。

> **日期**: 2026-02-12

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
| 读取 Node | ✓ (需 scope 证明) | ✓ (需 scope 证明) | ✗ |
| 写入 Node | ✓ (需 canUpload) | ✓ (需 canUpload) | ✗ |
| Depot 操作 | ✓ (需 canManageDepot) | ✓ (需 canManageDepot) | ✗ |
| 旋转获取新 AT | ✗ (JWT 自动续期) | ✗ | ✓ |
| 管理用户 | ✓ (需 admin) | ✗ | ✗ |

> **Root Delegate 特殊性**：Root delegate 使用 JWT 直接访问 Realm 数据路由，中间件自动将 JWT 转换为 `AccessTokenAuthContext`，下游无感知。Root delegate 不持有 RT/AT，不需要 refresh。PoP 验证也自动跳过。

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

### Auth API

[详细文档](./02-auth.md)

| 方法 | 路径 | 描述 | 认证 | 状态 |
|------|------|------|------|------|
| POST | `/api/auth/refresh` | 旋转 RT → 新 RT + AT | Refresh Token | ✅ 已实现 |
| POST | `/api/auth/request` | 发起授权申请 | 无 | ⚠️ 未实现 |
| GET | `/api/auth/request/:requestId/poll` | 轮询授权状态 | 无 | ⚠️ 未实现 |
| POST | `/api/auth/request/:requestId/approve` | 批准申请 | User JWT | ⚠️ 未实现 |
| POST | `/api/auth/request/:requestId/deny` | 拒绝申请 | User JWT | ⚠️ 未实现 |

### Admin 管理 API

[详细文档](./03-admin.md)

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/api/admin/users` | 列出所有用户 | Admin |
| PATCH | `/api/admin/users/:userId` | 修改用户角色 | Admin |

### Realm CAS 操作 API

[详细文档](./04-realm/README.md)

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/api/realm/{realmId}` | 获取 Realm 端点信息 | AT 或 JWT |
| GET | `/api/realm/{realmId}/usage` | 获取使用统计 | AT 或 JWT |
| GET | `/api/realm/{realmId}/nodes/:key` | 读取节点 | AT 或 JWT |
| GET | `/api/realm/{realmId}/nodes/:key/metadata` | 获取节点元信息 | AT 或 JWT |
| PUT | `/api/realm/{realmId}/nodes/:key` | 上传节点 | AT 或 JWT (canUpload) |
| POST | `/api/realm/{realmId}/nodes/check` | 批量检查节点状态 | AT 或 JWT |
| POST | `/api/realm/{realmId}/nodes/:key/claim` | 认领节点所有权 (PoP) | AT 或 JWT (canUpload) |
| GET | `…/nodes/:key/fs/stat` | 获取文件/目录元信息 | AT 或 JWT + Proof |
| GET | `…/nodes/:key/fs/read` | 读取文件内容 | AT 或 JWT + Proof |
| GET | `…/nodes/:key/fs/ls` | 列出目录内容 | AT 或 JWT + Proof |
| POST | `…/nodes/:key/fs/write` | 创建或覆盖文件 | AT 或 JWT + Proof (canUpload) |
| POST | `…/nodes/:key/fs/mkdir` | 创建目录 | AT 或 JWT + Proof (canUpload) |
| POST | `…/nodes/:key/fs/rm` | 删除文件或目录 | AT 或 JWT + Proof (canUpload) |
| POST | `…/nodes/:key/fs/mv` | 移动/重命名 | AT 或 JWT + Proof (canUpload) |
| POST | `…/nodes/:key/fs/cp` | 复制文件或目录 | AT 或 JWT + Proof (canUpload) |
| POST | `…/nodes/:key/fs/rewrite` | 声明式批量重写目录树 | AT 或 JWT + Proof (canUpload) |
| POST | `/api/realm/{realmId}/delegates` | 创建子 Delegate | AT 或 JWT |
| GET | `/api/realm/{realmId}/delegates` | 列出子 Delegate | AT 或 JWT |
| GET | `/api/realm/{realmId}/delegates/:delegateId` | 获取 Delegate 详情 | AT 或 JWT |
| POST | `/api/realm/{realmId}/delegates/:delegateId/revoke` | 撤销 Delegate | AT 或 JWT |
| GET | `/api/realm/{realmId}/depots` | 列出 Depot | AT 或 JWT |
| POST | `/api/realm/{realmId}/depots` | 创建 Depot | AT 或 JWT (canManageDepot) |
| GET | `/api/realm/{realmId}/depots/:depotId` | 获取 Depot 详情 | AT 或 JWT |
| PATCH | `/api/realm/{realmId}/depots/:depotId` | 修改 Depot | AT 或 JWT (canManageDepot) |
| DELETE | `/api/realm/{realmId}/depots/:depotId` | 删除 Depot | AT 或 JWT (canManageDepot) |
| POST | `/api/realm/{realmId}/depots/:depotId/commit` | 提交新 Root | AT 或 JWT (canUpload) |

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
| `NODE_NOT_IN_SCOPE` | 403 | 节点不在授权范围 |
| `UPLOAD_NOT_ALLOWED` | 403 | Token 没有 canUpload 权限 |
| `DEPOT_MANAGE_NOT_ALLOWED` | 403 | Token 没有 canManageDepot 权限 |
| `ROOT_NOT_AUTHORIZED` | 403 | Root 引用验证失败 |
| `CHILD_NOT_AUTHORIZED` | 403 | 子节点引用验证失败 |
| `INVALID_POP` | 403 | Proof-of-Possession 校验失败 |
| `NODE_NOT_FOUND` | 404 | 节点不存在 |
| `REALM_QUOTA_EXCEEDED` | 403 | 超出 Realm 配额限制 |
| `MAX_DEPTH_EXCEEDED` | 400 | 超出最大转签发深度 |
| `INDEX_PATH_REQUIRED` | 400 | 缺少 X-CAS-Index-Path |
| `INTERNAL_ERROR` | 500 | 服务器内部错误 |

## 幂等性保证

### 幂等操作

| 操作 | 幂等性 | 说明 |
|------|--------|------|
| `GET` 所有端点 | ✅ 幂等 | 读取操作 |
| `PUT /nodes/:key` | ✅ 幂等 | 相同内容产生相同 key |
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
