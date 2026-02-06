# Depot 管理

Depot 是 CAS 中的命名存储空间，用于组织和管理数据。每个用户有一个默认的 MAIN depot。

## 认证

Depot 操作需要 **Access Token**：

```http
Authorization: Bearer {base64_encoded_token}
```

### 权限要求

| 操作 | 权限要求 |
|------|----------|
| 列出 Depot | Access Token |
| 查看 Depot | Access Token |
| 创建 Depot | Access Token + `canManageDepot` |
| 修改 Depot | Access Token + `canManageDepot` |
| 删除 Depot | Access Token + `canManageDepot` |

### 可见范围

Depot 的可见范围由 Issuer Chain 决定。Access Token 可以看到其 Issuer Chain 中任意 Token 创建的 Depot：

- 该 Access Token 的直接 Issuer（签发它的 Delegate Token）创建的 Depot
- Issuer 的 Issuer 创建的 Depot，以此类推
- 直到用户创建的 Depot

对于修改操作（更新、删除），还需要验证 Depot 的 `creatorIssuerId` 在当前 Token 的 Issuer Chain 中。

---

## 端点列表

| 方法 | 路径 | 描述 | 权限 |
|------|------|------|------|
| GET | `/api/realm/{realmId}/depots` | 列出 Depot | Access Token |
| POST | `/api/realm/{realmId}/depots` | 创建 Depot | canManageDepot |
| GET | `/api/realm/{realmId}/depots/:depotId` | 获取 Depot 详情 | Access Token |
| PATCH | `/api/realm/{realmId}/depots/:depotId` | 修改 Depot | canManageDepot |
| DELETE | `/api/realm/{realmId}/depots/:depotId` | 删除 Depot | canManageDepot |

---

## GET /api/realm/{realmId}/depots

列出 Realm 中的 Depot。

### 请求

```http
GET /api/realm/usr_abc123/depots?limit=20
Authorization: Bearer {access_token}
```

### 查询参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `limit` | `number` | 每页数量，默认 20，最大 100 |
| `cursor` | `string` | 分页游标 |

### 响应

```json
{
  "depots": [
    {
      "depotId": "depot:MAIN",
      "name": "Main Depot",
      "creatorIssuerId": "dlt1_xxxxx",
      "createdAt": 1738497600000
    }
  ],
  "nextCursor": "xxx"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `depotId` | `string` | Depot ID |
| `name` | `string` | Depot 名称 |
| `creatorIssuerId` | `string` | 创建者 Token ID |
| `createdAt` | `number` | 创建时间 |

---

## POST /api/realm/{realmId}/depots

创建新的 Depot。需要 `canManageDepot` 权限。

### 请求

```http
POST /api/realm/usr_abc123/depots
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "name": "My Depot",
  "depotId": "my-depot"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | `string` | 是 | Depot 显示名称（1-128 字符） |
| `depotId` | `string` | 否 | Depot ID（省略则自动生成 ULID） |

### 响应

```json
{
  "depotId": "depot:my-depot",
  "name": "My Depot",
  "root": "node:empty...",
  "creatorIssuerId": "dlt1_xxxxx",
  "createdAt": 1738497600000,
  "updatedAt": 1738497600000
}
```

> 新创建的 Depot 以空 dict node (d-node) 作为初始 root

### 错误

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `DEPOT_MANAGE_NOT_ALLOWED` | 403 | Token 没有 canManageDepot 权限 |
| `CONFLICT` | 409 | Depot ID 已存在 |

---

## GET /api/realm/{realmId}/depots/:depotId

获取 Depot 详情，包含当前 root。

### 请求

```http
GET /api/realm/usr_abc123/depots/depot:MAIN
Authorization: Bearer {access_token}
```

### 响应

```json
{
  "depotId": "depot:MAIN",
  "name": "Main Depot",
  "root": "node:abc123...",
  "creatorIssuerId": "dlt1_xxxxx",
  "createdAt": 1704067200000,
  "updatedAt": 1738497600000
}
```

| 字段 | 描述 |
|------|------|
| `depotId` | Depot 唯一标识 |
| `name` | Depot 名称 |
| `root` | 当前根节点 key |
| `creatorIssuerId` | 创建者 Token ID |
| `createdAt` | 创建时间（epoch 毫秒） |
| `updatedAt` | 最后更新时间（epoch 毫秒） |

### 错误

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `NOT_FOUND` | 404 | Depot 不存在 |
| `DEPOT_ACCESS_DENIED` | 403 | 无权访问该 Depot |

---

## PATCH /api/realm/{realmId}/depots/:depotId

修改 Depot 的元数据或更新 root。需要 `canManageDepot` 权限。

### 请求

```http
PATCH /api/realm/usr_abc123/depots/depot:MAIN
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "name": "New Name",
  "root": "node:newroot..."
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | `string` | 否 | 新名称（1-128 字符） |
| `root` | `string` | 否 | 新的根节点 key（必须已存在，且需通过引用验证） |

### Root 引用验证

更新 `root` 时，服务端验证调用方有权引用该节点，与 `rewrite` 的 `link` 和底层 `PUT /nodes/:key` 的子节点引用验证规则一致：

| 验证方式 | 条件 | 典型场景 |
|----------|------|----------|
| **uploader 验证** | 节点的 `uploaderTokenId` == 当前 Token ID | fs/write 或 rewrite 产生的 newRoot |
| **scope 验证** | 节点在当前 Token 的 scope 树内 | 回退到已知的历史 root |

> **安全说明**：如果不做引用验证，攻击者可以猜测/泄漏一个 node hash，将其设为自己 Depot 的 root，再通过 `fs/read` 等路径读取其内容——hash 泄漏即等于内容泄漏。

### 响应

```json
{
  "depotId": "depot:MAIN",
  "name": "New Name",
  "root": "node:newroot...",
  "creatorIssuerId": "dlt1_xxxxx",
  "createdAt": 1704067200000,
  "updatedAt": 1738501200000
}
```

### 错误

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `DEPOT_MANAGE_NOT_ALLOWED` | 403 | Token 没有 canManageDepot 权限 |
| `DEPOT_ACCESS_DENIED` | 403 | 无权访问该 Depot |
| `NOT_FOUND` | 404 | Depot 不存在 |
| `INVALID_ROOT` | 400 | root 节点不存在 |
| `ROOT_NOT_AUTHORIZED` | 403 | root 引用验证失败：既非本 Token 上传，也不在 Token scope 内 |

---

## DELETE /api/realm/{realmId}/depots/:depotId

删除 Depot。需要 `canManageDepot` 权限。

> **注意**：MAIN depot 不能删除。

### 请求

```http
DELETE /api/realm/usr_abc123/depots/depot:my-depot
Authorization: Bearer {access_token}
```

### 响应

```json
{
  "success": true
}
```

### 错误

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `DEPOT_MANAGE_NOT_ALLOWED` | 403 | Token 没有 canManageDepot 权限 |
| `DEPOT_ACCESS_DENIED` | 403 | 无权访问该 Depot |
| `NOT_FOUND` | 404 | Depot 不存在 |
| `FORBIDDEN` | 403 | 不能删除 MAIN depot |

---

## Issuer Chain 验证

Depot 的访问权限通过 Issuer Chain 验证：

```
User (usr_abc)
  └── Token A (dlt1_aaa)  ← 创建了 depot:X
        └── Token B (dlt1_bbb)  ← 可以访问 depot:X
              └── Token C (dlt1_ccc)  ← 可以访问 depot:X
```

- Token A 创建的 depot:X，其 `creatorIssuerId` = `dlt1_aaa`
- Token B 和 Token C 的 Issuer Chain 包含 `dlt1_aaa`，所以可以访问
- 其他 Token（不在这个 chain 上）不能访问 depot:X

### 示例

Token C 的 issuerChain: `["usr_abc", "dlt1_aaa", "dlt1_bbb"]`

验证逻辑：
1. depot:X 的 creatorIssuerId = `dlt1_aaa`
2. Token C 的 issuerChain 包含 `dlt1_aaa`
3. ✓ 允许访问

---

## 使用建议

1. **合理命名**：使用有意义的 depot 名称和 ID
2. **权限分离**：只给需要管理 depot 的 Token 设置 `canManageDepot`
3. **追踪来源**：通过 `creatorIssuerId` 追踪 depot 的创建者
