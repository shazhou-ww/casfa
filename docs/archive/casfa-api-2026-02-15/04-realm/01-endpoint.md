# Realm 端点信息与使用统计

## GET /api/realm/{realmId}

获取 Realm 端点信息和配置限制。

### 请求

```http
GET /api/realm/usr_abc123
Authorization: Bearer {access_token 或 jwt}
```

### 响应

```json
{
  "realm": "usr_abc123",
  "commit": {},
  "nodeLimit": 4194304,
  "maxNameBytes": 255
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `realm` | `string` | Realm ID（`usr_` 前缀） |
| `commit` | `object \| undefined` | 存在时表示当前 Delegate 有 `canUpload` 权限，可提交写操作 |
| `nodeLimit` | `number` | 单个节点最大字节数（默认 4MB） |
| `maxNameBytes` | `number` | 文件/目录名最大字节数（UTF-8，默认 255） |

> **注**：`commit` 字段仅在 Delegate 具有 `canUpload` 权限时返回，否则为 `undefined`。客户端可据此判断是否具备写操作能力。

---

## GET /api/realm/{realmId}/usage

获取 Realm 的存储使用统计。

### 请求

```http
GET /api/realm/usr_abc123/usage
Authorization: Bearer {access_token 或 jwt}
```

### 响应

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

| 字段 | 类型 | 说明 |
|------|------|------|
| `realm` | `string` | Realm ID |
| `physicalBytes` | `number` | 物理存储字节（去重后） |
| `logicalBytes` | `number` | 逻辑存储字节（含文件内容，不含 d-node 结构） |
| `nodeCount` | `number` | 节点总数 |
| `quotaLimit` | `number` | 存储配额上限（字节） |
| `updatedAt` | `number` | 统计更新时间（Unix 毫秒） |

> **物理 vs 逻辑**：由于 CAS 去重，多个文件引用相同内容时 `physicalBytes` 不会增长，但 `logicalBytes` 按引用累计。
