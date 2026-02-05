# Node 操作

节点是 CAS 中的基本存储单元，包括三种类型：

- **d-node (dict)**: 目录节点，包含子节点映射
- **f-node (file)**: 文件顶层节点，包含 content-type
- **s-node (successor)**: 文件后继节点，用于大文件分块

## Ticket 认证限制

使用 `Authorization: Ticket` 认证时，Node 操作受以下限制：

| 操作 | 限制 |
|------|------|
| 读取 (`GET`) | 只能访问 `input` 节点及其子节点；`output` 已设置时也可访问 |
| 上传 (`PUT`) | 需要 `writable: true`，受 `quota` 和 `accept` 限制 |
| 预检查 (`POST prepare-nodes`) | 需要 `writable: true` |

超出 scope 的访问返回 `403 Forbidden`。

---

## POST /api/realm/{realmId}/prepare-nodes

预上传检查：提交一个 key 列表，服务端返回哪些节点需要上传。

> **重要**: 此操作具有副作用。对于已存在的节点，会 **touch 其生命周期**（更新 `lastAccessedAt` 时间戳），防止被 GC 回收。这意味着即使只是检查节点存在性，也会影响节点的 GC 优先级。

### 请求

```json
{
  "keys": ["node:abc123...", "node:def456...", "node:ghi789..."]
}
```

### 响应

```json
{
  "missing": ["node:abc123...", "node:ghi789..."],
  "exists": ["node:def456..."]
}
```

| 字段 | 描述 |
|------|------|
| `missing` | 需要上传的节点 key 列表 |
| `exists` | 已存在的节点 key 列表（已 touch 生命周期） |

### 幂等性

此操作是幂等的，可以安全重试。多次调用对同一节点的效果等同于单次调用。

---

## GET /api/realm/{realmId}/nodes/:key/metadata

获取节点元信息，包括类型、payload 大小、子节点列表等。

### 响应

Dict 节点 (d-node)：

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

File 节点 (f-node)：

```json
{
  "key": "node:abc123...",
  "kind": "file",
  "payloadSize": 1234,
  "contentType": "text/plain",
  "successor": "node:next..."
}
```

Successor 节点 (s-node)：

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

### 响应

- Content-Type: `application/octet-stream`
- Body: 节点二进制数据（cas-core 格式）

响应头包含元数据：

- `X-CAS-Kind`: 节点类型
- `X-CAS-Payload-Size`: payload 大小

---

## PUT /api/realm/{realmId}/nodes/:key

上传节点（二进制格式）。

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

| 状态码 | 错误代码 | 描述 |
|--------|---------|------|
| 400 | `invalid_request` | 节点格式无效 |
| 400 | `checksum_mismatch` | 校验和不匹配 |
| 400 | `missing_nodes` | 引用的子节点不存在 |
| 413 | `quota_exceeded` | 配额超限 |

子节点缺失错误示例：

```json
{
  "error": "missing_nodes",
  "message": "Referenced child nodes are not present in storage",
  "details": {
    "missing": ["node:xxx...", "node:yyy..."]
  }
}
```
