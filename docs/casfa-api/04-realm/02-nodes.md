# Node 操作

CAS 节点的读取、上传、导航与批量检查。

---

## POST /api/realm/{realmId}/nodes/check

批量检查节点在存储中的状态。返回 missing（不存在）、owned（存在且被当前 Delegate 链拥有）、unowned（存在但未被拥有）三类。

> **无需 Direct Authorization Check**：check 只查询节点的存在性和 ownership 状态，不返回节点内容，因此不要求 nodeId 在 delegate 的 scope 内。任何有效的 AT/JWT 都可以查询任意 key。

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

(CAS 二进制节点数据)
```

请求体为 CAS 二进制格式的节点数据（f-node、d-node 或 s-node）。

**不需要任何额外 Header 或 query parameter** — 子节点引用通过 ownership 检查自动验证。

### 验证流程

1. **结构验证**：校验 CAS 二进制格式合法性
2. **Hash 验证**：计算 BLAKE3 hash，与 URL 中的 key 比对
3. **子节点引用验证**（d-node）：每个 child 需通过 **ownership 检查**（`hasOwnership(childKey, delegateId)`）
4. **配额检查**：确认 Realm 配额充足

> **子节点 ownership**：上传 d-node 时，所有引用的子节点必须被当前 Delegate 链拥有。如果子节点不属于自己（例如引用 scope 内已有节点），需要先通过 `POST /api/realm/{realmId}/claim` 获取 ownership，然后再 PUT。
>
> **Root delegate（depth=0）跳过**子节点 ownership 检查（全部放行）。

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
| `CHILD_NOT_AUTHORIZED` | 403 | d-node 子节点 ownership 验证失败（`unauthorized` 字段列出未授权的 key） |

---

## GET /api/realm/{realmId}/nodes/:key

读取节点原始二进制数据。

### 请求

```http
GET /api/realm/usr_abc123/nodes/nod_abc123...
Authorization: Bearer {access_token 或 jwt}
```

`:key` 必须通过 Direct Authorization Check（见 [04-realm/README.md](./README.md)）。

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
| `NODE_NOT_AUTHORIZED` | 403 | nodeId 未通过 Direct Authorization Check |

---

## GET /api/realm/{realmId}/nodes/:key/~0/~1/~2

从 `:key` 沿 `~N` index path 导航，读取到达的目标节点二进制数据。

### 请求

```http
GET /api/realm/usr_abc123/nodes/nod_SCOPE_ROOT/~1/~2
Authorization: Bearer {access_token 或 jwt}
```

- `:key` 必须通过 Direct Authorization Check
- URL 中 `:key` 之后的每一段必须是 `~N` 格式（`~0`, `~1`, `~2` ...）
- 服务端从 `:key` 开始，沿 children 数组的第 N 个位置逐层向下导航
- 最终到达的节点返回二进制内容

### 路由规则

```
GET /:realmId/nodes/:key/*
```

通配符 `*` 部分所有段必须是 `~\d+` 格式，否则返回 404。`/nodes/:key` 下没有任何子路由（`metadata`、`fs`、`claim` 已独立），通配符零冲突。

### 响应

与 `GET /nodes/:key` 相同：

- **Content-Type**: `application/octet-stream`
- **X-CAS-Kind**: 节点类型
- **X-CAS-Payload-Size**: 有效数据大小
- **X-CAS-Content-Type**: MIME 类型（仅 file 节点）
- **Body**: 目标节点的 CAS 二进制数据

### 错误

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `NODE_NOT_AUTHORIZED` | 403 | `:key` 未通过 Direct Authorization Check |
| `not_found` | 404 | 起始节点不存在 |
| `INDEX_OUT_OF_BOUNDS` | 400 | `~N` 中 N 超出 children 数组范围 |
| `NOT_A_DIRECTORY` | 400 | 导航中途遇到非 d-node（无 children） |

### 示例

```bash
# Root delegate — 直接访问任意节点
GET /api/realm/R/nodes/nod_ABC123
Authorization: Bearer {jwt}

# Scoped delegate — 从 scope root 导航到子节点
GET /api/realm/R/nodes/nod_SCOPE_ROOT/~0/~3
Authorization: Bearer {access_token}

# 多级导航
GET /api/realm/R/nodes/nod_SCOPE_ROOT/~1/~0/~2
Authorization: Bearer {access_token}
```

---

## GET /api/realm/{realmId}/metadata/:key

获取节点结构化元信息。

### 请求

```http
GET /api/realm/usr_abc123/metadata/nod_abc123...
Authorization: Bearer {access_token 或 jwt}
```

`:key` 必须通过 Direct Authorization Check。

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
| `children` | `Record<string, string>` | 子节点名称→key 映射（仅 dict）。注意：JSON object 不保证顺序，如需按索引定位子节点请使用 `~N` 导航或 `fs/ls`（返回 `index` 字段） |
| `contentType` | `string` | MIME 类型（仅 file） |
| `successor` | `string \| null` | 后继节点 key（仅 file / successor） |

### 错误

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `not_found` | 404 | 节点不存在 |
| `NODE_NOT_AUTHORIZED` | 403 | nodeId 未通过 Direct Authorization Check |

---

## GET /api/realm/{realmId}/metadata/:key/~0/~1/~2

从 `:key` 沿 `~N` index path 导航，获取到达的目标节点元信息。

与 node 导航路由完全对应，仅返回格式不同（JSON metadata 而非二进制）。

### 请求

```http
GET /api/realm/usr_abc123/metadata/nod_SCOPE_ROOT/~1/~2
Authorization: Bearer {access_token 或 jwt}
```

### 路由规则

```
GET /:realmId/metadata/:key/*
```

通配符 `*` 部分所有段必须是 `~\d+` 格式。

### 响应

与 `GET /metadata/:key` 相同（dict / file / successor 三种格式）。

### 错误

与 node 导航路由相同（`NODE_NOT_AUTHORIZED`、`INDEX_OUT_OF_BOUNDS`、`NOT_A_DIRECTORY`）。
