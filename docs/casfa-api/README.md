# CASFA API 文档

CASFA (Content-Addressable Storage for Agents) 是一个为 AI Agent 设计的内容寻址存储服务 API。

> **日期**: 2026-02-06

## 概述

所有 API 路由均以 `/api` 为前缀。

CASFA 采用 **Delegate Token 授权体系**，提供统一的认证和授权机制。

## 认证体系

### Token 类型

| 类型 | Header 格式 | 说明 |
|------|-------------|------|
| User Token (JWT) | `Authorization: Bearer {jwt}` | OAuth 登录后获取，用于用户管理和 Token 签发 |
| Delegate Token | `Authorization: Bearer {base64}` | 再授权 Token，可转签发子 Token |
| Access Token | `Authorization: Bearer {base64}` | 访问 Token，用于 CAS 数据操作 |

### Token 能力对比

| 能力 | User JWT | Delegate Token | Access Token |
|------|----------|----------------|--------------|
| 创建 Delegate Token | ✓ | ✓ (转签发) | ✗ |
| 创建 Access Token | ✓ | ✓ (转签发) | ✗ |
| 创建 Ticket | ✗ | ✓ | ✗ |
| 读取 Node | ✗ | ✗ | ✓ (需 scope 证明) |
| 写入 Node | ✗ | ✗ | ✓ (需 can_upload) |
| Depot 操作 | ✗ | ✗ | ✓ (需 can_manage_depot) |
| 查看/管理 Token | ✓ | ✗ | ✗ |

## ID 格式规范

所有标识符使用以下格式：

| 类型 | 格式 | 示例 |
|------|------|------|
| User ID | `usr_{base32}` | `usr_A6JCHNMFWRT90AXMYWHJ8HKS90` |
| Token ID | `dlt1_{base32}` | `dlt1_4xzrt7y2m5k9bqwp3fnhjc6d` |
| Ticket ID | `ticket:{ulid}` | `ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC` |
| Depot ID | `depot:{name}` | `depot:MAIN` |
| Node Key | `node:{blake3_hash}` | `node:abc123...` |
| Request ID | `req_{base64}` | `req_xxxxxxxxxxxxxxxxxxxxxxxx` |

> **Token ID 计算**：Token ID 是 Token 内容（128 字节）的 Blake3-128 hash

## 时间格式规范

| 类型 | 格式 | 单位 | 示例 |
|------|------|------|------|
| 时间戳 | Unix epoch | 毫秒 (int64) | `1738497600000` (2025-02-02T08:00:00Z) |
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
| POST | `/api/oauth/refresh` | 刷新 Token | 无 |
| GET | `/api/oauth/me` | 获取当前用户信息 | User JWT |

### Token 管理 API

[详细文档](./02-tokens.md)

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| POST | `/api/tokens` | 创建 Delegate Token | User JWT |
| GET | `/api/tokens` | 列出 Delegate Token | User JWT |
| GET | `/api/tokens/:tokenId` | 获取 Token 详情 | User JWT |
| POST | `/api/tokens/:tokenId/revoke` | 撤销 Token | User JWT |
| POST | `/api/tokens/delegate` | 转签发 Token | Delegate Token |

### 客户端授权申请 API

[详细文档](./03-client-auth.md)

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| POST | `/api/tokens/requests` | 发起授权申请 | 无 |
| GET | `/api/tokens/requests/:requestId/poll` | 轮询状态（客户端侧） | 无 |
| GET | `/api/tokens/requests/:requestId` | 查看详情（用户侧） | User JWT |
| POST | `/api/tokens/requests/:requestId/approve` | 批准申请 | User JWT |
| POST | `/api/tokens/requests/:requestId/reject` | 拒绝申请 | User JWT |

> **注意**：授权申请不可枚举，无列表 API。

### Admin 管理 API

[详细文档](./04-admin.md)

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/api/admin/users` | 列出所有用户 | Admin |
| PATCH | `/api/admin/users/:userId` | 修改用户角色 | Admin |

### 文件系统操作 API

[详细文档](./05-filesystem.md)

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/api/realm/{realmId}/nodes/{nodeKey}/fs/stat` | 获取文件/目录元信息 | Access Token |
| GET | `/api/realm/{realmId}/nodes/{nodeKey}/fs/read` | 读取文件内容 | Access Token |
| GET | `/api/realm/{realmId}/nodes/{nodeKey}/fs/ls` | 列出目录内容 | Access Token |
| POST | `/api/realm/{realmId}/nodes/{nodeKey}/fs/write` | 创建或覆盖文件 | Access Token (canUpload) |
| POST | `/api/realm/{realmId}/nodes/{nodeKey}/fs/mkdir` | 创建目录 | Access Token (canUpload) |
| POST | `/api/realm/{realmId}/nodes/{nodeKey}/fs/rm` | 删除文件或目录 | Access Token (canUpload) |
| POST | `/api/realm/{realmId}/nodes/{nodeKey}/fs/mv` | 移动/重命名 | Access Token (canUpload) |
| POST | `/api/realm/{realmId}/nodes/{nodeKey}/fs/cp` | 复制文件或目录 | Access Token (canUpload) |
| POST | `/api/realm/{realmId}/nodes/{nodeKey}/fs/rewrite` | 声明式树重写 | Access Token (canUpload) |

### Realm CAS 操作 API

[详细文档](./06-realm/README.md)

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/api/realm/{realmId}` | 获取 Realm 端点信息 | Access Token |
| GET | `/api/realm/{realmId}/usage` | 获取使用统计 | Access Token |
| GET | `/api/realm/{realmId}/nodes/:key` | 读取节点 | Access Token |
| PUT | `/api/realm/{realmId}/nodes/:key` | 写入节点 | Access Token |
| GET | `/api/realm/{realmId}/depots` | 列出 Depot | Access Token |
| POST | `/api/realm/{realmId}/depots` | 创建 Depot | Access Token |
| PATCH | `/api/realm/{realmId}/depots/:depotId` | 修改 Depot | Access Token |
| DELETE | `/api/realm/{realmId}/depots/:depotId` | 删除 Depot | Access Token |
| GET | `/api/realm/{realmId}/tickets` | 列出 Ticket | Access Token |
| POST | `/api/realm/{realmId}/tickets` | 创建 Ticket | Access Token |
| GET | `/api/realm/{realmId}/tickets/:ticketId` | 查询 Ticket | Access Token |
| POST | `/api/realm/{realmId}/tickets/:ticketId/submit` | 提交 Ticket | Access Token |

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
| `INVALID_REQUEST` | 400 | 请求参数错误 |
| `INVALID_TOKEN_FORMAT` | 401 | Token Base64 格式无效 |
| `TOKEN_NOT_FOUND` | 401 | Token ID 不存在 |
| `TOKEN_REVOKED` | 401 | Token 已被撤销 |
| `TOKEN_EXPIRED` | 401 | Token 已过期 |
| `UNAUTHORIZED` | 401 | 未认证或 Token 无效 |
| `FORBIDDEN` | 403 | 权限不足 |
| `ACCESS_TOKEN_REQUIRED` | 403 | 需要 Access Token |
| `DELEGATE_TOKEN_REQUIRED` | 403 | 需要 Delegate Token |
| `REALM_MISMATCH` | 403 | Token realm 与 URL realmId 不匹配 |
| `NODE_NOT_IN_SCOPE` | 403 | 节点不在授权范围 |
| `DEPOT_ACCESS_DENIED` | 403 | 无权访问该 Depot |
| `NOT_FOUND` | 404 | 资源不存在 |
| `PATH_NOT_FOUND` | 404 | 文件系统路径不存在 |
| `NOT_A_FILE` | 400 | 目标不是文件 |
| `NOT_A_DIRECTORY` | 400 | 目标不是目录 |
| `FILE_TOO_LARGE` | 400/413 | 读取时表示多 block 不支持（400），写入时表示超过大小限制（413） |
| `CONTENT_LENGTH_MISMATCH` | 400 | fs/write 实际 body 字节数与 Content-Length 不一致 |
| `INVALID_ROOT` | 400 | nodeKey 无效或引用的节点不存在 |
| `INVALID_PATH` | 400 | 文件路径无效（空段、`..`、绝对路径等） |
| `INDEX_OUT_OF_BOUNDS` | 400 | indexPath 中的索引超出范围 |
| `NAME_TOO_LONG` | 400 | 文件/目录名超过 maxNameBytes |
| `COLLECTION_FULL` | 400 | 目录子节点数达到 maxCollectionChildren 上限 |
| `CANNOT_REMOVE_ROOT` | 400 | 不能删除根节点 |
| `CANNOT_MOVE_ROOT` | 400 | 不能移动根节点 |
| `MOVE_INTO_SELF` | 400 | 不能将目录移入自身或其子目录 |
| `TARGET_EXISTS` | 409 | 目标路径已存在 |
| `EXISTS_AS_FILE` | 409 | 路径已存在且是文件 |
| `TOO_MANY_ENTRIES` | 400 | rewrite entries + deletes 条目超限 |
| `EMPTY_REWRITE` | 400 | rewrite 的 entries 和 deletes 都为空 |
| `ROOT_NOT_AUTHORIZED` | 403 | PATCH depot root 引用验证失败 |
| `LINK_NOT_AUTHORIZED` | 403 | link 引用验证失败（非本 Token 上传且无有效 proof） |
| `CHILD_NOT_AUTHORIZED` | 403 | PUT node 子节点引用验证失败 |
| `REQUEST_NOT_FOUND` | 404 | 授权申请不存在 |
| `CONFLICT` | 409 | 资源状态冲突 |
| `GONE` | 410 | 资源已过期或已撤销 |
| `QUOTA_EXCEEDED` | 413 | 超出配额限制 |
| `RATE_LIMITED` | 429 | 请求过于频繁 |
| `MAX_DEPTH_EXCEEDED` | 400 | 超出最大转签发深度 |
| `INDEX_PATH_REQUIRED` | 400 | 缺少 X-CAS-Index-Path |
| `INTERNAL_ERROR` | 500 | 服务器内部错误 |

### 示例

```json
{
  "error": "NODE_NOT_IN_SCOPE",
  "message": "The requested node is not within the authorized scope",
  "details": {
    "nodeKey": "node:abc123...",
    "indexPath": "0:1:2"
  }
}
```

## 限流策略

> **TODO**：限流策略待后续完善。以下为初步规划，实际参数可能根据压测结果调整。尤其需要考虑多 Token 聚合限流（Per realm 维度）以防止通过签发多个 Access Token 绕过 Per token 限流。

| 端点类别 | 限制 | 窗口 | 维度 |
|---------|------|------|------|
| OAuth 端点 | 10 req | 1 min | Per IP |
| Token 轮询 | 1 req | 5 sec | Per requestId |
| Token 管理 | 30 req | 1 min | Per user |
| Realm 操作 | 100 req | 1 min | Per token |
| Node 上传 | 60 req | 1 min | Per realm |
| 文件系统操作 | 60 req | 1 min | Per token |
| Admin 操作 | 30 req | 1 min | Per admin |

超出限制时返回 `429 Too Many Requests`：

```json
{
  "error": "RATE_LIMITED",
  "message": "Too many requests",
  "details": {
    "retryAfter": 30
  }
}
```

## 幂等性保证

### 幂等操作

| 操作 | 幂等性 | 说明 |
|------|--------|------|
| `GET` 所有端点 | ✅ 幂等 | 读取操作 |
| `PUT /nodes/:key` | ✅ 幂等 | 相同内容产生相同 key |
| `DELETE` 资源 | ✅ 幂等 | 重复删除返回成功 |
| `fs/stat`, `fs/read`, `fs/ls` | ✅ 幂等 | 读取操作 |
| `fs/mkdir` | ⚠️ 条件幂等 | 目录已存在时返回当前 root，不产生新 root |

### 非幂等操作

| 操作 | 幂等性 | 说明 |
|------|--------|------|
| `POST /tokens` | ❌ 非幂等 | 每次创建新 Token |
| `POST /tickets` | ❌ 非幂等 | 每次创建新 Ticket |
| `POST /tokens/delegate` | ❌ 非幂等 | 每次创建新 Token |
| `POST /tickets/:id/submit` | ⚠️ 仅一次 | 成功后不可重复 |
| `fs/write`, `fs/rm`, `fs/mv`, `fs/cp` | ❌ 非幂等 | 每次产生新 root（但相同内容的 CAS hash 相同） |
| `fs/rewrite` | ❌ 非幂等 | 声明式重写，每次产生新 root |

## 相关文档

- [服务信息 API](./00-info.md)
- [OAuth 认证 API](./01-oauth.md)
- [Token 管理 API](./02-tokens.md)
- [客户端授权申请](./03-client-auth.md)
- [Admin 管理 API](./04-admin.md)
- [文件系统操作 API](./05-filesystem.md)
- [Realm CAS 操作 API](./06-realm/README.md)
