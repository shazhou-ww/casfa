# Node 操作

节点是 CAS 中的基本存储单元，包括三种类型：

- **d-node (dict)**: 目录节点，包含子节点映射
- **f-node (file)**: 文件顶层节点，包含 content-type
- **s-node (successor)**: 文件后继节点，用于大文件分块

## 认证

所有 Node 操作需要 **Access Token**：

```http
Authorization: Bearer {base64_encoded_token}
```

### 读取限制

读取时需要提供 `X-CAS-Index-Path` Header，证明目标节点在 Token 的 scope 内：

```http
GET /api/realm/{realmId}/nodes/:key
Authorization: Bearer {access_token}
X-CAS-Index-Path: 0:1:2
```

### 写入限制

写入需要 Token 具有 `canUpload` 权限。

---

## GET /api/realm/{realmId}/nodes/:key/metadata

获取节点元信息，包括类型、payload 大小、子节点列表等。

### 请求

```http
GET /api/realm/usr_abc123/nodes/node:abc123.../metadata
Authorization: Bearer {access_token}
X-CAS-Index-Path: 0:1
```

### 响应

**Dict 节点 (d-node)**：

```json
{
  "key": "node:abc123...",
  "kind": "dict",
  "payloadSize": 256,
  "children": {
    "file1.txt": "node:file1...",
    "subdir": "node:subdir..."
  }
}
```

**File 节点 (f-node)**：

```json
{
  "key": "node:abc123...",
  "kind": "file",
  "payloadSize": 1234,
  "contentType": "text/plain",
  "successor": "node:next..."
}
```

**Successor 节点 (s-node)**：

```json
{
  "key": "node:abc123...",
  "kind": "successor",
  "payloadSize": 4194304,
  "successor": "node:next..."
}
```

| 字段 | 描述 |
|------|------|
| `key` | 节点 key |
| `kind` | 节点类型：`dict`, `file`, `successor` |
| `payloadSize` | payload 大小（字节） |
| `children` | 子节点映射（仅 d-node） |
| `contentType` | 内容类型（仅 f-node） |
| `successor` | 后继节点 key（f-node/s-node，可选） |

---

## GET /api/realm/{realmId}/nodes/:key

获取节点的二进制数据。

### 请求

```http
GET /api/realm/usr_abc123/nodes/node:abc123...
Authorization: Bearer {access_token}
X-CAS-Index-Path: 0:1:2
```

### 响应

- Content-Type: `application/octet-stream`
- Body: 节点二进制数据（cas-core 格式）

响应头包含元数据：

- `X-CAS-Kind`: 节点类型
- `X-CAS-Payload-Size`: payload 大小

### Index-Path 说明

`X-CAS-Index-Path` Header 证明目标节点是 Token scope 的子节点：

```
scope
├── [0] depot:MAIN root
│   ├── [0] file1.txt
│   └── [1] subdir/
│       ├── [0] a.txt        (indexPath: 0:1:0)
│       └── [1] b.txt        (indexPath: 0:1:1)
└── [1] depot:BACKUP root
    └── ...
```

### 错误

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `INDEX_PATH_REQUIRED` | 400 | 缺少 X-CAS-Index-Path Header |
| `INVALID_INDEX_PATH` | 400 | Index-Path 格式无效 |
| `NODE_NOT_IN_SCOPE` | 403 | 节点不在授权范围 |
| `NOT_FOUND` | 404 | 节点不存在 |

---

## PUT /api/realm/{realmId}/nodes/:key

上传节点（二进制格式）。需要 Token 具有 `canUpload` 权限。

### 请求

**请求头**:

| Header | 类型 | 描述 |
|--------|------|------|
| `Content-Type` | `string` | 必须为 `application/octet-stream` |
| `Content-Length` | `number` | 请求体字节数 |
| `Content-MD5` | `string?` | 可选，Base64 编码的 MD5 校验和 |
| `X-CAS-Blake3` | `string?` | 可选，Hex 编码的 Blake3 校验和 |

> **校验和验证**: 如果提供了 `Content-MD5` 或 `X-CAS-Blake3`，服务端会验证上传内容的完整性。验证失败返回 `400 Bad Request`。

**请求体**: 二进制节点数据

节点格式遵循 cas-core 二进制格式，包含：

- Magic bytes 和头部结构
- Hash 验证（节点 key = content hash）
- 子节点存在性验证
- 子节点引用验证（见下方说明）

### 请求示例

```http
PUT /api/realm/usr_abc123/nodes/node:abc123...
Authorization: Bearer {access_token}
Content-Type: application/octet-stream
Content-Length: 12345

(二进制数据)
```

### 响应

```json
{
  "key": "node:abc123...",
  "kind": "file",
  "payloadSize": 12345
}
```

| 字段 | 描述 |
|------|------|
| `key` | 节点 key |
| `kind` | 节点类型：`dict`, `file`, `successor` |
| `payloadSize` | payload 大小 |

### 错误

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `UPLOAD_NOT_ALLOWED` | 403 | Token 没有 canUpload 权限 |
| `INVALID_REQUEST` | 400 | 节点格式无效 |
| `CHECKSUM_MISMATCH` | 400 | 校验和不匹配 |
| `MISSING_NODES` | 400 | 引用的子节点不存在 |
| `CHILD_NOT_AUTHORIZED` | 403 | 引用的子节点未通过引用验证 |
| `QUOTA_EXCEEDED` | 413 | 配额超限 |

**子节点缺失错误示例**：

```json
{
  "error": "MISSING_NODES",
  "message": "Referenced child nodes are not present in storage",
  "details": {
    "missing": ["node:xxx...", "node:yyy..."]
  }
}
```

### 子节点引用验证

上传包含 children 的节点（d-node、带 successor 的 f-node/s-node）时，服务端验证每个子节点引用的合法性，防止通过构造包含任意 hash 的节点来窃取内容。

每个 child 引用必须满足以下条件之一：

| 验证方式 | 条件 | 说明 |
|----------|------|------|
| **uploader 验证** | 子节点的 `uploaderTokenId` == 当前 Token ID | 本 Token 上传的节点，当然可以引用 |
| **scope 验证** | 子节点在当前 Token 的 scope 树内 | scope 内已有的节点，客户端本来就能读取 |

> **性能影响**：uploader 验证附着在已有的存在性检查流程上——读取子节点记录时顺便比较 `uploaderTokenId` 字段，零额外 IO。scope 验证仅在 uploader 验证失败时回退执行。
>
> **安全说明**：如果不做引用验证，攻击者可以构造一个 d-node，children 里包含别人的节点 hash，上传后 commit 到自己的 depot，再通过正常读取路径获取该节点的内容——hash 泄漏即等于内容泄漏。

---

## 节点格式说明

### Node Key 计算

节点 key 是节点二进制内容的 Blake3 hash：

```
key = "node:" + hex(blake3(node_bytes))
```

### 二进制格式概述

```
┌──────────────┐
│ Magic (4B)   │  Node type identifier
├──────────────┤
│ Header       │  Metadata (content-type, child count, etc.)
├──────────────┤
│ Payload      │  Actual data
└──────────────┘
```

详细格式请参考 [CAS 二进制格式文档](../../CAS_BINARY_FORMAT.md)。

---

## POST /api/realm/{realmId}/nodes/check

批量检查节点的服务端状态，返回三类结果：已拥有、未拥有、不存在。

### 请求

```http
POST /api/realm/usr_abc123/nodes/check
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "keys": [
    "node:abc123...",
    "node:def456...",
    "node:ghi789..."
  ]
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `keys` | `string[]` | 是 | 需要检查的节点 key 列表（最多 1000 个） |

### 响应

```json
{
  "missing": ["node:ghi789..."],
  "owned": ["node:abc123..."],
  "unowned": ["node:def456..."]
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `missing` | `string[]` | 不存在的节点 key |
| `owned` | `string[]` | 存在且当前 delegate 有 ownership 的节点 |
| `unowned` | `string[]` | 存在但当前 delegate 无 ownership 的节点 |

### 错误

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `INVALID_REQUEST` | 400 | keys 必须是非空数组 |
| `INVALID_REQUEST` | 400 | 超过 1000 个 keys |

### 使用场景

客户端上传目录树时，先收集所有节点的 key，调用此 API 检查服务端状态：

```typescript
// 1. 收集所有待上传节点的 key
const allKeys = collectNodeKeys(directory);

// 2. 调用 nodes/check 检查
const { missing, owned, unowned } = await api.checkNodes(allKeys);

// 3. 只上传缺失和未拥有的节点
for (const key of [...missing, ...unowned]) {
  await api.uploadNode(key, nodeData[key]);
}
```

这样可以避免重复上传已拥有的节点，大幅提升上传效率。

---

## 使用建议

1. **批量上传前先检查**：使用 `nodes/check` API 检查哪些节点需要上传
2. **提供校验和**：上传时提供 `Content-MD5` 或 `X-CAS-Blake3` 确保完整性
3. **按依赖顺序上传**：先上传子节点，再上传父节点
4. **合理使用 Index-Path**：客户端需要追踪节点的路径以便读取时提供证明
