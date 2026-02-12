# Node 操作

CAS 节点的读取、上传、批量检查与 Claim。

---

## POST /api/realm/{realmId}/nodes/check

批量检查节点在存储中的状态。返回 missing（不存在）、owned（存在且被当前 Delegate 链拥有）、unowned（存在但未被拥有）三类。

### 请求

```http
POST /api/realm/usr_abc123/nodes/check
Authorization: Bearer {access_token 或 jwt}
Content-Type: application/json

{
  "keys": ["nod_abc123...", "nod_def456...", "nod_ghi789..."]
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `keys` | `string[]` | 节点 key 列表（`nod_` 前缀） |

### 响应

```json
{
  "missing": ["nod_ghi789..."],
  "owned": ["nod_abc123..."],
  "unowned": ["nod_def456..."]
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `missing` | `string[]` | 不存在于存储中的节点 |
| `owned` | `string[]` | 存在且被当前 Delegate 链拥有的节点 |
| `unowned` | `string[]` | 存在但未被当前 Delegate 链拥有的节点 |

> **Well-known 节点**（如空字典）始终归类为 `owned`。

---

## PUT /api/realm/{realmId}/nodes/:key

上传 CAS 节点。需要 `canUpload` 权限。

### 请求

```http
PUT /api/realm/usr_abc123/nodes/nod_abc123...
Authorization: Bearer {access_token 或 jwt}
Content-Type: application/octet-stream
X-CAS-Child-Proofs: nod_child1...:0:1,nod_child2...:0:2

(CAS 二进制节点数据)
```

请求体为 CAS 二进制格式的节点数据（f-node、d-node 或 s-node）。

### Headers

| Header | 必填 | 说明 |
|--------|------|------|
| `X-CAS-Child-Proofs` | 否 | d-node 子节点的 scope 证明（当子节点非当前 Delegate 链上传时提供） |

### 验证流程

1. **结构验证**：校验 CAS 二进制格式合法性
2. **Hash 验证**：计算 BLAKE3 hash，与 URL 中的 key 比对
3. **子节点引用验证**（d-node）：每个 child 需通过 ownership 验证或 scope 验证
4. **配额检查**：确认 Realm 配额充足

### 响应

```json
{
  "key": "nod_abc123...",
  "payloadSize": 2048,
  "kind": "file"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `key` | `string` | 节点 key |
| `payloadSize` | `number` | 有效数据大小（字节） |
| `kind` | `string` | 节点类型：`file`、`dict`、`successor` |

### 错误

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `UPLOAD_NOT_ALLOWED` | 403 | Delegate 没有 canUpload 权限 |
| `REALM_QUOTA_EXCEEDED` | 403 | Realm 存储配额不足 |
| `missing_nodes` | 409 | d-node 引用的子节点不存在（`missing` 字段列出缺失的 key） |
| `CHILD_NOT_AUTHORIZED` | 403 | d-node 子节点引用验证失败（`unauthorized` 字段列出未授权的 key） |

---

## GET /api/realm/{realmId}/nodes/:key

读取节点原始二进制数据。需要 Scope 证明。

### 请求

```http
GET /api/realm/usr_abc123/nodes/nod_abc123...
Authorization: Bearer {access_token 或 jwt}
X-CAS-Proof: 0:1:2
```

### Headers

| Header | 必填 | 说明 |
|--------|------|------|
| `X-CAS-Proof` | 是 | 证明节点在 Delegate scope 内的 index-path |

### 响应

- **Content-Type**: `application/octet-stream`
- **X-CAS-Kind**: 节点类型（`file`、`dict`、`successor`）
- **X-CAS-Payload-Size**: 有效数据大小
- **X-CAS-Content-Type**: MIME 类型（仅 file 节点）
- **Body**: CAS 二进制节点数据

### 错误

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `not_found` | 404 | 节点不存在 |
| `NODE_NOT_IN_SCOPE` | 403 | 节点不在授权范围 |

---

## GET /api/realm/{realmId}/nodes/:key/metadata

获取节点结构化元信息。需要 Scope 证明。

### 请求

```http
GET /api/realm/usr_abc123/nodes/nod_abc123.../metadata
Authorization: Bearer {access_token 或 jwt}
X-CAS-Proof: 0:1
```

### 响应（dict 节点）

```json
{
  "key": "nod_abc123...",
  "kind": "dict",
  "payloadSize": 0,
  "children": {
    "src": "nod_child1...",
    "README.md": "nod_child2..."
  }
}
```

### 响应（file 节点）

```json
{
  "key": "nod_abc123...",
  "kind": "file",
  "payloadSize": 2048,
  "contentType": "text/typescript",
  "successor": null
}
```

### 响应（successor 节点）

```json
{
  "key": "nod_abc123...",
  "kind": "successor",
  "payloadSize": 4194304,
  "successor": "nod_next..."
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `key` | `string` | 节点 key |
| `kind` | `string` | 节点类型 |
| `payloadSize` | `number` | 有效数据大小 |
| `children` | `Record<string, string>` | 子节点映射（仅 dict） |
| `contentType` | `string` | MIME 类型（仅 file） |
| `successor` | `string \| null` | 后继节点 key（仅 file / successor） |

---

## POST /api/realm/{realmId}/nodes/:key/claim

通过 Proof-of-Possession (PoP) 方式 Claim 已存在节点的所有权。需要 `canUpload` 权限。

### 设计动机

当节点已被其他 Delegate 上传至存储，当前 Delegate 想获取其所有权（例如，将其挂载到自己的目录树中），可通过 PoP 证明持有 AT 字节和节点内容来 Claim。

### 请求

```http
POST /api/realm/usr_abc123/nodes/nod_abc123.../claim
Authorization: Bearer {access_token 或 jwt}
Content-Type: application/json

{
  "pop": "PoP-hash-string..."
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `pop` | `string` | Proof-of-Possession 值：`BLAKE3-128-keyed(AT_bytes, node_content)` 的 Crockford Base32 编码 |

> **Root Delegate 例外**：depth=0 的 Root Delegate 使用 JWT 认证，没有 AT 字节，因此 PoP 验证被跳过（JWT 已证明身份）。

### 响应

```json
{
  "nodeHash": "nod_abc123...",
  "alreadyOwned": false,
  "delegateId": "dlt_abc123..."
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `nodeHash` | `string` | 节点 key |
| `alreadyOwned` | `boolean` | `true` = 已拥有（幂等返回），`false` = 新 Claim |
| `delegateId` | `string` | 执行 Claim 的 Delegate ID |

### 错误

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `UPLOAD_NOT_ALLOWED` | 403 | Delegate 没有 canUpload 权限 |
| `REALM_MISMATCH` | 403 | Token realm 与请求 realm 不匹配 |
| `NODE_NOT_FOUND` | 404 | 节点不存在 |
| `INVALID_POP` | 403 | PoP 验证失败 |
