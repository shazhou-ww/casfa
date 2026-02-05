# Realm CAS 操作 API

通过 Realm 路由访问 CAS 存储的 API。支持多种认证方式。

## 认证

所有 Realm 路由需要 `Authorization` header，支持以下认证方式：

### User Token（完整权限）

```http
Authorization: Bearer {userToken}
```

### Agent Token（Realm 范围权限）

```http
Authorization: Agent {agentToken}
```

### Ticket（受限访问）

```http
Authorization: Ticket {ticketId}
```

> Ticket 认证只能访问 Realm 路由的子集，且受 scope 和 quota 限制。详见 [Ticket 管理与认证](./02-tickets.md)。

### 认证方式对比

| 认证方式 | 可访问端点 | 限制 |
|---------|-----------|------|
| Bearer (User) | 全部 | 无 |
| Agent | 全部 | Realm 配置限制 |
| Ticket | Node 操作 + commit | scope + quota |

> `realmId` 格式为 `user:{id}`，其中 id 为 Cognito UUID 的 Crockford Base32 编码（26 位字符）

## 子文档

- [端点信息与使用统计](./01-endpoint.md) - Realm 基本信息和 usage 统计
- [Ticket 管理](./02-tickets.md) - Realm 下的 Ticket 列表与管理
- [Node 操作](./03-nodes.md) - 节点的预检查、上传、下载、元信息获取
- [Depot 管理](./04-depots.md) - 命名存储空间的版本控制

## 端点列表

### 基本信息

| 方法 | 路径 | 描述 | 权限 |
|------|------|------|------|
| GET | `/api/realm/{realmId}` | 获取 Realm 端点信息 | Read |
| GET | `/api/realm/{realmId}/usage` | 获取使用统计 | Read |

### Ticket 管理

| 方法 | 路径 | 描述 | 权限 |
|------|------|------|------|
| POST | `/api/realm/{realmId}/tickets` | 创建 Ticket | Write |
| GET | `/api/realm/{realmId}/tickets` | 列出 Realm 下所有 Tickets | Read |
| GET | `/api/realm/{realmId}/tickets/:ticketId` | 获取 Ticket 详情 | Read |
| POST | `/api/realm/{realmId}/tickets/:ticketId/commit` | 提交结果（Ticket 认证） | Ticket |
| POST | `/api/realm/{realmId}/tickets/:ticketId/revoke` | 撤销 Ticket（仅 Issuer） | Write |
| DELETE | `/api/realm/{realmId}/tickets/:ticketId` | 删除 Ticket（仅 User） | Write |

### Node 操作

| 方法 | 路径 | 描述 | 权限 |
|------|------|------|------|
| POST | `/api/realm/{realmId}/prepare-nodes` | 预上传检查 | Write |
| GET | `/api/realm/{realmId}/nodes/:key/metadata` | 获取节点元信息 | Read |
| GET | `/api/realm/{realmId}/nodes/:key` | 获取节点二进制数据 | Read |
| PUT | `/api/realm/{realmId}/nodes/:key` | 上传节点 | Write |

### Depot 操作

| 方法 | 路径 | 描述 | 权限 |
|------|------|------|------|
| GET | `/api/realm/{realmId}/depots` | 列出所有 Depots | Read |
| POST | `/api/realm/{realmId}/depots` | 创建 Depot | Write |
| GET | `/api/realm/{realmId}/depots/:depotId` | 获取 Depot 详情（含 history） | Read |
| PATCH | `/api/realm/{realmId}/depots/:depotId` | 修改 Depot 元数据 | Write |
| POST | `/api/realm/{realmId}/depots/:depotId/commit` | 提交新 root | Write |
| DELETE | `/api/realm/{realmId}/depots/:depotId` | 删除 Depot | Write |

> **注意**: 使用 Ticket 认证时不支持 Depot 操作和 Ticket 管理接口，这些端点只能通过 Bearer/Agent 认证访问。
