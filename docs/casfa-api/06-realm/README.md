# Realm CAS 操作 API

通过 Realm 路由访问 CAS 存储的 API。所有数据访问都需要 Access Token。

## 认证

所有 Realm 路由需要 `Authorization` header，使用 Access Token：

```http
Authorization: Bearer {base64_encoded_token}
```

> **重要**：
> - **Delegate Token** 不能直接访问数据，需先转签发为 Access Token
> - **User JWT** 不能访问 Realm 路由

### Realm 验证

URL 中的 `realmId` 必须与 Token 关联的 realm 一致，否则返回 `403 REALM_MISMATCH`。

## 子文档

- [端点信息与使用统计](./01-endpoint.md) - Realm 基本信息和 usage 统计
- [Ticket 管理](./02-tickets.md) - Ticket 的创建、查询、提交
- [Node 操作](./03-nodes.md) - 节点的读取和上传
- [Depot 管理](./04-depots.md) - 命名存储空间的创建和管理

## 端点列表

### 基本信息

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/api/realm/{realmId}` | 获取 Realm 端点信息 | Access Token |
| GET | `/api/realm/{realmId}/usage` | 获取使用统计 | Access Token |

### Ticket 管理

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| POST | `/api/realm/{realmId}/tickets` | 创建 Ticket | **Delegate Token** |
| GET | `/api/realm/{realmId}/tickets` | 列出 Ticket | Access Token |
| GET | `/api/realm/{realmId}/tickets/:ticketId` | 获取 Ticket 详情 | Access Token |
| POST | `/api/realm/{realmId}/tickets/:ticketId/submit` | 提交 Ticket | Access Token |

> **注意**：创建 Ticket 需要 **Delegate Token**，其他 Ticket 操作使用 Access Token。

### Node 操作

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/api/realm/{realmId}/nodes/:key` | 读取节点 | Access Token |
| GET | `/api/realm/{realmId}/nodes/:key/metadata` | 获取节点元信息 | Access Token |
| PUT | `/api/realm/{realmId}/nodes/:key` | 上传节点 | Access Token (canUpload) |

### Depot 操作

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/api/realm/{realmId}/depots` | 列出 Depot | Access Token |
| POST | `/api/realm/{realmId}/depots` | 创建 Depot | Access Token (canManageDepot) |
| GET | `/api/realm/{realmId}/depots/:depotId` | 获取 Depot 详情 | Access Token |
| PATCH | `/api/realm/{realmId}/depots/:depotId` | 修改 Depot | Access Token (canManageDepot) |
| DELETE | `/api/realm/{realmId}/depots/:depotId` | 删除 Depot | Access Token (canManageDepot) |

## 权限控制

### Token 权限标志

| 标志 | 影响的操作 |
|------|-----------|
| `canUpload` | 允许上传节点（`PUT /nodes/:key`） |
| `canManageDepot` | 允许创建/修改/删除 Depot |

### Scope 限制

读取节点时需要证明节点在 Token 的 scope 内。通过 `X-CAS-Index-Path` Header 提供证明：

```http
GET /api/realm/{realmId}/nodes/:key
Authorization: Bearer {access_token}
X-CAS-Index-Path: 0:1:2
```

### 可见范围

Ticket 和 Depot 的可见范围由 Issuer Chain 决定。

Access Token 可以看到其 Issuer Chain 中任意 Token 创建的 Ticket/Depot：
- 该 Access Token 的直接 Issuer（签发它的 Delegate Token）创建的资源
- Issuer 的 Issuer 创建的资源，以此类推
- 直到用户创建的资源

对于修改操作（更新、删除 Depot），还需要验证资源的 `creatorIssuerId` 在当前 Token 的 Issuer Chain 中。

## 错误响应

### Token 相关

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `INVALID_TOKEN_FORMAT` | 401 | Token Base64 格式无效 |
| `TOKEN_NOT_FOUND` | 401 | Token ID 不存在 |
| `TOKEN_REVOKED` | 401 | Token 已被撤销 |
| `TOKEN_EXPIRED` | 401 | Token 已过期 |
| `ACCESS_TOKEN_REQUIRED` | 403 | 需要 Access Token |
| `DELEGATE_TOKEN_REQUIRED` | 403 | 需要 Delegate Token |

### 访问控制相关

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `REALM_MISMATCH` | 403 | Token realm 与 URL realmId 不匹配 |
| `INDEX_PATH_REQUIRED` | 400 | 缺少 X-CAS-Index-Path |
| `NODE_NOT_IN_SCOPE` | 403 | 节点不在授权范围 |
| `DEPOT_ACCESS_DENIED` | 403 | 无权访问该 Depot |
| `UPLOAD_NOT_ALLOWED` | 403 | Token 没有 canUpload 权限 |
| `DEPOT_MANAGE_NOT_ALLOWED` | 403 | Token 没有 canManageDepot 权限 |
