# Claim API

批量获取节点 ownership。支持 Proof-of-Possession (PoP) 和 path-based 两种 claim 方式。

---

## 设计动机

在 CAS 系统中，**ownership** 是权限控制的核心：

- `PUT /nodes/:key` 上传节点时，所有子节点引用必须通过 ownership 检查
- `rewrite` 的 `link` 操作挂载已有节点时，必须拥有该节点
- `commit` 提交新 root 时，root 节点必须被 delegate 链拥有

当 delegate 想引用其他 delegate 上传的节点（或 scope 内已有的节点）时，需要先通过 **claim** 获取 ownership。

Claim API 提供了两种方式：
1. **PoP Claim** — 客户端持有节点内容 + access token 字节，通过 keyed hash 证明持有权
2. **Path-based Claim** — 从一个已授权的节点出发，沿 `~N` 路径导航到目标节点，证明可达性

---

## POST /api/realm/{realmId}/claim

批量 claim 节点 ownership。需要 `canUpload` 权限。

### 请求

```http
POST /api/realm/usr_abc123/claim
Authorization: Bearer {access_token 或 jwt}
Content-Type: application/json

{
  "claims": [
    { "key": "nod_ABC", "pop": "pop:XXXXXX..." },
    { "key": "nod_TARGET", "from": "nod_SCOPE_ROOT", "path": "~0/~1/~2" }
  ]
}
```

### 请求字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `claims` | `ClaimEntry[]` | Claim 条目列表 |

每个 `ClaimEntry` 是以下两种之一：

#### PoP Claim

```json
{ "key": "nod_ABC", "pop": "pop:XXXXXX..." }
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `key` | `string` | 要 claim 的节点 key |
| `pop` | `string` | Proof-of-Possession 值：`BLAKE3-128-keyed(AT_bytes, node_content)` 的 Crockford Base32 编码 |

客户端持有节点内容和 Access Token 原始字节，计算 keyed hash 证明。

> **Root Delegate 例外**：depth=0 的 Root Delegate 使用 JWT 认证，没有 AT 字节，PoP 验证被跳过（JWT 已证明身份）。Root delegate 通常也不需要 claim（depth=0 跳过所有 ownership 检查）。

#### Path-based Claim

```json
{ "key": "nod_TARGET", "from": "nod_SCOPE_ROOT", "path": "~0/~1/~2" }
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `key` | `string` | 要 claim 的目标节点 key |
| `from` | `string` | 起始节点 key（必须通过 Direct Authorization Check） |
| `path` | `string` | 从 `from` 到 `key` 的 `~N` 索引路径（`/` 分隔） |

**服务端验证流程**：

1. 检查 `from` 是否直接授权（Direct Authorization Check：ownership / scope root / root delegate）
2. 从 `from` 沿 `path` 的 `~N` 段逐层遍历 DAG
3. 验证最终到达的节点 hash == `key`
4. 写入 ownership 记录

> **典型场景**：scoped delegate 的 scope root 内有很多子节点，delegate 需要引用其中某些节点（例如对目录树做局部修改后 PUT 新的 d-node）。通过 path-based claim 可以批量获取这些子节点的 ownership，无需持有节点内容。

### 混合批量示例

一次请求混合使用 PoP 和 path-based claim：

```json
{
  "claims": [
    { "key": "nod_A", "pop": "pop:XXX" },
    { "key": "nod_B", "from": "nod_SCOPE_ROOT", "path": "~1/~0" },
    { "key": "nod_C", "from": "nod_SCOPE_ROOT", "path": "~1/~1" }
  ]
}
```

### 响应

```json
{
  "results": [
    { "key": "nod_A", "ok": true, "alreadyOwned": false },
    { "key": "nod_B", "ok": true, "alreadyOwned": true },
    { "key": "nod_C", "ok": false, "error": "PATH_MISMATCH" }
  ]
}
```

### 响应字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `results` | `ResultEntry[]` | 每个 claim 的结果，与请求中 `claims` 顺序一一对应 |

每个 `ResultEntry`：

| 字段 | 类型 | 说明 |
|------|------|------|
| `key` | `string` | 节点 key |
| `ok` | `boolean` | claim 是否成功 |
| `alreadyOwned` | `boolean` | `true` = 已拥有（幂等返回），`false` = 新 claim |
| `error` | `string` | 失败原因（仅 `ok: false` 时） |

### HTTP 状态码

batch 中每个 claim **独立处理**，某个失败不影响其他：

| 状态码 | 条件 |
|--------|------|
| `200` | 全部成功 |
| `207 Multi-Status` | 部分成功、部分失败 |
| `403` | 全部失败（权限不足） |
| `400` | 请求格式错误 |

### 错误码（per-claim）

| 错误码 | 说明 |
|--------|------|
| `NODE_NOT_FOUND` | 节点不存在 |
| `INVALID_POP` | PoP 验证失败 |
| `FROM_NOT_AUTHORIZED` | `from` 节点未通过 Direct Authorization Check |
| `PATH_MISMATCH` | 沿 path 导航后到达的节点 hash ≠ `key` |
| `INDEX_OUT_OF_BOUNDS` | path 中某个 `~N` 超出 children 范围 |
| `NOT_A_DIRECTORY` | path 导航中途遇到非 d-node |

### 请求级错误

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `UPLOAD_NOT_ALLOWED` | 403 | Delegate 没有 canUpload 权限 |
| `REALM_MISMATCH` | 403 | Token realm 与请求 realm 不匹配 |
| `EMPTY_CLAIMS` | 400 | claims 数组为空 |
| `TOO_MANY_CLAIMS` | 400 | claims 数量超过 100 |

---

## 典型工作流

### 场景 1：Scoped delegate 上传引用 scope 内已有节点的新节点

```
# 1. 先 claim scope 内的已有节点（path-based）
POST /api/realm/R/claim
{
  "claims": [
    { "key": "nod_EXISTING_A", "from": "nod_SCOPE_ROOT", "path": "~0/~2" },
    { "key": "nod_EXISTING_B", "from": "nod_SCOPE_ROOT", "path": "~1/~0/~3" }
  ]
}
→ 200, all ok

# 2. 现在 delegate 拥有 nod_EXISTING_A 和 nod_EXISTING_B
#    上传引用它们的新节点（PUT 只检查 ownership）
PUT /api/realm/R/nodes/nod_NEW_NODE
Authorization: Bearer {access_token}
Body: (CAS binary referencing nod_EXISTING_A and nod_EXISTING_B)
→ 200
```

### 场景 2：批量 claim 子树节点用于 rewrite link

```
# 1. 列出 scope root 的子节点，获取索引
GET /api/realm/R/fs/nod_SCOPE_ROOT/ls
→ children: [{ name: "lib", index: 0, key: "nod_LIB" }, ...]

# 2. claim lib 节点
POST /api/realm/R/claim
{
  "claims": [
    { "key": "nod_LIB", "from": "nod_SCOPE_ROOT", "path": "~0" }
  ]
}

# 3. 在 rewrite 中 link 挂载
POST /api/realm/R/fs/nod_SCOPE_ROOT/rewrite
{
  "entries": {
    "vendor/lib": { "link": "nod_LIB" }
  }
}
```

### 场景 3：PoP claim 外部获取的节点

```
# 客户端从其他渠道获取了节点内容和 key
# 计算 PoP 并 claim

POST /api/realm/R/claim
{
  "claims": [
    { "key": "nod_EXTERNAL", "pop": "pop:ABC123..." }
  ]
}
→ 200, ok

# 现在可以在 PUT 或 rewrite link 中引用该节点
```

---

## 与其他 API 的关系

| API | 与 Claim 的关系 |
|-----|----------------|
| `PUT /nodes/:key` | 子节点引用需要 ownership → 先 claim |
| `fs/rewrite` link | 挂载已有节点需要 ownership → 先 claim |
| `depots/commit` | 提交 root 需要 ownership → 通常已通过上传自动获得 |
| `GET /nodes/:key` | 读取只需 Direct Authorization Check，不需要 ownership |
| `GET /metadata/:key` | 同上 |

> **上传即拥有**：当 delegate 通过 `PUT /nodes/:key` 自己上传节点时，自动获得 ownership，无需额外 claim。Claim 只在引用**他人上传的**或 **scope 内已有的**节点时需要。
