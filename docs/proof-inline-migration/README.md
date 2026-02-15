# Proof 消除：nodeId 直接授权 + 路径隐式证明

> 版本: 3.0
> 日期: 2026-02-15

---

## 目录

1. [问题](#1-问题)
2. [方案：Path-as-Proof](#2-方案path-as-proof)
3. [URL 设计](#3-url-设计)
4. [授权模型](#4-授权模型)
5. [为什么合理](#5-为什么合理)
6. [PUT 子节点引用 与 Claim 改造](#6-put-子节点引用-与-claim-改造)
7. [实现计划](#7-实现计划)
8. [影响范围](#8-影响范围)
9. [不变的部分](#9-不变的部分)

---

## 1. 问题

当前系统使用两个自定义 HTTP Header 传递 proof：

| Header | 用途 | 格式 |
|--------|------|------|
| `X-CAS-Proof` | 读/写操作的节点访问证明 | `{"nodeHash":"ipath#0:1:2"}` (JSON) |
| `X-CAS-Child-Proofs` | PUT 上传时子节点引用授权 | `child1_key=0:1:2,child2_key=0:3` |

**这引发了以下问题：**

1. **浏览器不友好** — `<img src>` / `<a href>` / `fetch()` 无法附加自定义 Header，必须通过 SDK 包装
2. **CORS 预检** — 自定义 Header 触发 preflight (`OPTIONS`)，增加延迟
3. **缓存失效** — CDN/反向代理不按自定义 Header 区分缓存
4. **工具兼容性** — curl、Postman 等需要额外 `-H` 参数
5. **链接不可分享** — 无法生成包含完整鉴权信息的 URL
6. **概念冗余** — proof 中的 nodeHash 与 URL `:key` 重复；scope index 是对 scope root 列表的间接引用

---

## 2. 方案：Path-as-Proof

### 2.1 核心思路

**与其在请求中附带"从 scope root 到 target 的 proof 路径"，不如让 URL 中的 `{nodeId}` 就是 delegate 直接有权访问的节点，然后通过 `{path}` 向下导航 — 路径本身就是证明。**

| | 旧模型 | 新模型 |
|--|--------|--------|
| **`{nodeId}`** | 目标节点（可能不直接有权限） | 起始节点（必须直接有权限） |
| **proof** | 单独参数：从 scope root 到 target 的 index path | 不需要 — 从 `{nodeId}` 经 path 到达的节点，自然在授权范围内 |
| **scope index** | `ipath#0:1:2` 中的 `0` 选择 scope root | 不需要 — `{nodeId}` 本身就是 scope root，无需间接引用 |

### 2.2 示例

```
# 旧模型：target 是 nod_TARGET，proof 说明如何从 scope root 到达它
GET /nodes/nod_TARGET
X-CAS-Proof: {"TARGET_HASH":"ipath#0:1:2"}

# 新模型：直接用 scope root 作为 nodeId，路径导航到 target
GET /nodes/raw/nod_SCOPE_ROOT/~1/~2
```

FS 操作中同理：

```
# 旧模型
GET /nodes/nod_TARGET/fs/read?path=src/main.ts
X-CAS-Proof: {"TARGET_HASH":"ipath#0:1:2"}

# 新模型：scope root 作为 nodeId，FS path 自然包含 ~N 导航
GET /nodes/fs/nod_SCOPE_ROOT/read?path=~1/~2/src/main.ts
```

### 2.3 为什么 proof 彻底消失了

旧系统中 proof 做两件事：

1. **选择 scope root**（多 scope 时通过 index 选择）
2. **提供 index path**（从 scope root 到 target 的 child 索引序列）

新模型中：

1. **`{nodeId}` 本身就是 scope root** — 不再需要 scope index 间接引用
2. **URL path 就是导航路径** — `~N` 段直接编码在 URL 或 FS `?path=` 中

两个职责都被 URL 结构自然吸收了。

---

## 3. URL 设计

### 3.1 Node 二进制路由（`/nodes/raw/:key`）

`/nodes/raw/:key` 承载节点本体的读、写、导航。所有 CAS 节点操作统一在 `/nodes/` 命名空间下，通过不同子路径区分：`raw/`（二进制）、`metadata/`（元信息）、`fs/`（文件系统）、`check`、`claim`。

#### 直接访问

```
GET  /:realmId/nodes/raw/:key         → 获取节点二进制内容
PUT  /:realmId/nodes/raw/:key         → 上传节点（见 §6）
```

#### 导航访问（从 nodeId 沿 `~N` 路径到达目标）

```
GET  /:realmId/nodes/raw/:key/~0/~1/~2     → 沿 index path 导航，获取目标二进制
```

`~N` 段遵循 CAS URI 规范（02-cas-uri.md §4.2），复用 `PathSegment { kind: "index" }` 类型。

通配符路由 `GET /:realmId/nodes/raw/:key/*` 只需处理 `~N` 导航。handler 校验所有段必须是 `~\d+` 格式，否则 404。`raw` 是固定路径段，与同级的 `metadata`、`fs`、`check`、`claim` 互不冲突。

```typescript
realmRouter.get("/:realmId/nodes/raw/:key", nodeAuthMiddleware, chunks.get)
realmRouter.put("/:realmId/nodes/raw/:key", canUploadMiddleware, chunks.put)
realmRouter.get("/:realmId/nodes/raw/:key/*", nodeAuthMiddleware, chunks.getNavigated)
```

### 3.2 Metadata 路由（`/nodes/metadata/:key`）

从 `/nodes/:key/metadata` 搬到 `/nodes/metadata/:key`：

```
GET  /:realmId/nodes/metadata/:key              → 获取节点元数据
GET  /:realmId/nodes/metadata/:key/~0/~1/~2     → 沿 index path 导航后获取元数据
```

同样支持 `~N` 导航：通配符 `GET /:realmId/nodes/metadata/:key/*` 只处理 `~N` 段。

```typescript
realmRouter.get("/:realmId/nodes/metadata/:key", nodeAuthMiddleware, chunks.getMetadata)
realmRouter.get("/:realmId/nodes/metadata/:key/*", nodeAuthMiddleware, chunks.getMetadataNavigated)
```

### 3.3 FS 路由（`/nodes/fs/:key`）

从 `/nodes/:key/fs/*` 搬到 `/nodes/fs/:key/*`：

```
GET  /:realmId/nodes/fs/:key/stat          → stat
GET  /:realmId/nodes/fs/:key/read          → read（?path=~1/~2/src/main.ts）
GET  /:realmId/nodes/fs/:key/ls            → ls（?path=src）
POST /:realmId/nodes/fs/:key/write         → write
POST /:realmId/nodes/fs/:key/mkdir         → mkdir
POST /:realmId/nodes/fs/:key/rm            → rm
POST /:realmId/nodes/fs/:key/mv            → mv
POST /:realmId/nodes/fs/:key/cp            → cp
POST /:realmId/nodes/fs/:key/rewrite       → rewrite
```

`:key` 必须是 delegate 直接有权访问的节点。`?path=` 中的 `~N` 段提供从该节点向下的 DAG 导航，后续 name 段在导航达到的子树中按名称查找。

### 3.4 Claim 路由（`/nodes/claim`）

从 `/nodes/:key/claim` 搬到 `/nodes/claim`（同时支持批量，见 §6.2）：

```
POST /:realmId/nodes/claim           → 批量 claim（PoP + path-based）
```

### 3.5 Nodes Check（不变）

```
POST /:realmId/nodes/check           → 批量检查节点存在性（不变）
```

`check` 是固定路由，不会与 `:key` 冲突（Hono static segment 优先于 param）。

### 3.6 对比总结

| 路由类型 | 当前 | 新模型 |
|---------|------|--------|
| `GET /nodes/:key` | `:key`=target, `X-CAS-Proof` | **移至** `GET /nodes/raw/:key`（`:key`=authorized node） |
| `GET /nodes/:key/~0/~1` | N/A | `GET /nodes/raw/:key/~0/~1` — 从 `:key` 沿 index path 导航 |
| `GET /nodes/:key/metadata` | `:key`=target, `X-CAS-Proof` | **移至** `GET /nodes/metadata/:key` |
| `GET /nodes/:key/fs/read` | `:key`=target, `X-CAS-Proof`, `?path=` | **移至** `GET /nodes/fs/:key/read?path=~0/~1/src/main.ts` |
| `POST /nodes/:key/fs/mkdir` | `:key`=target, `X-CAS-Proof`, body `path` | **移至** `POST /nodes/fs/:key/mkdir` |
| `POST /nodes/:key/claim` | `:key`=target, `{ pop }` | **移至** `POST /nodes/claim`（批量） |
| `PUT /nodes/:key` | `X-CAS-Child-Proofs` | **移至** `PUT /nodes/raw/:key`，见 [§6](#6-put-子节点引用-与-claim-改造) |

### 3.7 完整 URL 示例

```bash
# Root delegate — 任意节点均可访问
GET /api/realm/R/nodes/raw/nod_ABCDEF
Authorization: Bearer <token>

# Scoped delegate — 使用自己的 scope root
GET /api/realm/R/nodes/raw/nod_SCOPE_ROOT/~1/~2
Authorization: Bearer <token>

# 节点元数据
GET /api/realm/R/nodes/metadata/nod_SCOPE_ROOT/~1/~2
Authorization: Bearer <token>

# FS 读取，path 开头是 ~N 导航
GET /api/realm/R/nodes/fs/nod_SCOPE_ROOT/read?path=~1/~2/src/main.ts
Authorization: Bearer <token>

# FS ls，无导航（scope root 就是树根）
GET /api/realm/R/nodes/fs/nod_SCOPE_ROOT/ls?path=src
Authorization: Bearer <token>

# 浏览器可直接使用的链接（token 在 cookie 或 query）
<img src="/api/realm/R/nodes/fs/nod_SCOPE_ROOT/read?path=~0/images/logo.png">

# 批量 claim
POST /api/realm/R/nodes/claim
Authorization: Bearer <token>
{ "claims": [{ "key": "nod_A", "from": "nod_SCOPE", "path": "~0/~2" }] }
```

---

## 4. 授权模型

### 4.1 Direct Authorization Check

中间件对 URL 中的 `{nodeId}` 执行**直接授权检查**（不需要 proof walk）：

```
nodeId 授权判定：
  1. root delegate（depth=0）→ ✅ 任意 nodeId 放行
  2. hasOwnership(nodeId, delegateId) → ✅ 放行
  3. nodeId ∈ delegate.scopeRoots → ✅ 放行
  4. 否则 → ❌ 403
```

这是 O(1) 检查，不需要遍历 DAG。

### 4.2 Path 隐式授权

一旦 `{nodeId}` 通过 Direct Authorization：

- URL 中的 `~N` 导航段 → 沿 `{nodeId}` 的 children 数组逐层向下
- FS `?path=` 中的 `~N` + name 混合段 → 在 `{nodeId}` 子树中导航

到达的任何节点都在 `{nodeId}` 的子树中，因此**天然在 delegate 的授权范围内**。服务端不需要额外验证 — 能走到就说明在 scope 内。

### 4.3 与旧模型对比

```
旧模型                              新模型
──────                              ──────
Client 知道 target hash             Client 知道 scope root
Client 构造 proof (scope→target)    Client 用 scope root 作为 nodeId
Server 解析 proof                   Server 检查 nodeId 是否直接授权
Server walk DAG 验证 proof          Server 只在实际导航时 walk（这会自然发生）
                                    
proof walk = 验证 + 导航 冗余       导航 = 验证（合二为一）
```

关键洞察：**旧模型中 proof walk 和实际数据读取都会遍历 DAG，是重复工作。新模型中只需一次遍历。**

### 4.4 多 Scope Root 的处理

旧模型中多 scope 通过 scope index（`ipath#0:...` 或 `ipath#1:...`）区分。

新模型中**直接用不同的 nodeId**：

```
# Delegate 有 scope roots: [nod_A, nod_B]

# 访问 scope A 下的节点
GET /nodes/raw/nod_A/~0/~1

# 访问 scope B 下的节点
GET /nodes/raw/nod_B/~2
```

不再需要 scope index 的抽象层。

---

## 5. 为什么合理

### 5.1 概念简化

| 消除项 | 说明 |
|--------|------|
| **X-CAS-Proof header** | URL path 自身是 proof |
| **ProofMap** | 不再需要 nodeHash → ProofWord 映射 |
| **scope index** | nodeId 直接就是 scope root，不用间接编号 |
| **proof walk** | 与数据导航合并，一次遍历 |

### 5.2 格式统一

与 CAS URI 规范（02-cas-uri.md）完全一致：

| CAS URI | HTTP URL |
|---------|----------|
| `cas://node:XXX/~0/~1/src/main.ts` | `/nodes/fs/nod_XXX/read?path=~0/~1/src/main.ts` |
| `cas://node:XXX/~0/~1` | `/nodes/raw/nod_XXX/~0/~1` |

`~N` 段的语义在两个上下文中完全相同：按 children 数组索引导航。

### 5.3 浏览器/工具原生兼容

移除自定义 Header 后：

- **只需 `Authorization: Bearer <token>`** — 标准 OAuth2
- `<img src>` / `<a href>` 可直接使用（配合 cookie 或 signed URL）
- curl 只需一个 `-H "Authorization: ..."` 参数
- CDN 按 URL（含 path + query string）天然缓存

### 5.4 消除 CORS 配置

`allowHeaders` 不再需要 `X-CAS-Proof`。只保留标准的 `Content-Type` 和 `Authorization`。

---

## 6. PUT 子节点引用 与 Claim 改造

### 6.1 PUT 子节点引用：仅 ownership

`PUT /nodes/raw/:key` 上传节点时，如果引用了子节点，服务端验证上传者对这些子节点有 ownership。

**不再支持通过 proof/path 引用未拥有的子节点**。如果子节点不属于自己，需要先通过 `/nodes/claim` 获取 ownership，然后再 PUT。

```
# 旧模型：PUT 时通过 X-CAS-Child-Proofs header 证明 scope 可达性
PUT /nodes/:key
X-CAS-Child-Proofs: nod_child1=0:1:2,nod_child2=0:3

# 新模型：PUT 时只检查 ownership，无需任何额外参数
PUT /nodes/raw/:key
(body = raw binary, 无额外 header/query)
```

**优势**：
- `PUT` API 干净简洁 — 只需 `Authorization` header + binary body
- 去掉 `X-CAS-Child-Proofs` header 和对应的解析/验证逻辑
- 语义清晰：你上传的节点只能引用你拥有的节点

### 6.2 Claim 改造：支持批量 + path-based

为了支撑 PUT 只检查 ownership 的模型，claim 需要增强：

#### 6.2.1 当前 Claim API

```
POST /api/realm/{realmId}/nodes/{key}/claim
Body: { "pop": "pop:XXXXXX..." }
```

- 只支持单个节点
- 只支持 PoP（需要持有节点内容）

#### 6.2.2 新 Claim API

```
POST /api/realm/{realmId}/nodes/claim
Body: { "claims": [...] }
```

**改造点**：

1. **路由从 `/nodes/{key}/claim` 改为 `/nodes/claim`** — 因为要支持批量 claim
2. **支持两种 claim 方式**：PoP 和 path-based
3. **支持批量**：一次请求 claim 多个节点

**请求格式**：

```typescript
{
  claims: Array<
    | { key: string; pop: string }         // PoP claim
    | { key: string; from: string; path: string }  // Path-based claim
  >
}
```

**PoP Claim**（保持现有语义）：

```json
{
  "claims": [
    { "key": "nod_ABC", "pop": "pop:XXXXXX..." },
    { "key": "nod_DEF", "pop": "pop:YYYYYY..." }
  ]
}
```

客户端持有节点内容 + access token bytes，计算 keyed-hash 证明。

**Path-based Claim**：

```json
{
  "claims": [
    { "key": "nod_TARGET", "from": "nod_SCOPE_ROOT", "path": "~0/~1/~2" }
  ]
}
```

- `key` — 要 claim 的目标节点
- `from` — 起始节点（必须是 delegate 直接有权限的节点：ownership 或 scope root）
- `path` — 从 `from` 到 `key` 的 `~N` index 路径

服务端验证流程：
1. 检查 `from` 是否直接授权（同 §4.1 Direct Authorization Check）
2. 从 `from` 沿 `path` 的 `~N` 段遍历 DAG
3. 验证最终到达的节点 hash == `key`
4. 写入 ownership

**混合批量**：

```json
{
  "claims": [
    { "key": "nod_A", "pop": "pop:XXX" },
    { "key": "nod_B", "from": "nod_SCOPE_ROOT", "path": "~1/~0" },
    { "key": "nod_C", "from": "nod_SCOPE_ROOT", "path": "~1/~1" }
  ]
}
```

一次请求混合使用 PoP 和 path-based claim。

#### 6.2.3 响应格式

```typescript
{
  results: Array<{
    key: string;
    ok: boolean;
    alreadyOwned?: boolean;
    error?: string;
  }>
}
```

**部分成功**：batch 中每个 claim 独立处理，某个失败不影响其他。HTTP 状态码：
- 全部成功 → `200`
- 部分失败 → `207 Multi-Status`
- 全部失败 → `403` 或 `400`

#### 6.2.4 典型工作流

scoped delegate 要上传一个引用了 scope 内已有节点的新节点：

```
# 1. 先 claim scope 内的已有节点（path-based）
POST /api/realm/R/nodes/claim
{
  "claims": [
    { "key": "nod_EXISTING_A", "from": "nod_SCOPE_ROOT", "path": "~0/~2" },
    { "key": "nod_EXISTING_B", "from": "nod_SCOPE_ROOT", "path": "~1/~0/~3" }
  ]
}

# 2. 现在 delegate 拥有 nod_EXISTING_A 和 nod_EXISTING_B
# 上传引用它们的新节点（PUT 只检查 ownership）
PUT /api/realm/R/nodes/raw/nod_NEW_NODE
(binary content referencing nod_EXISTING_A and nod_EXISTING_B)
```

### 6.3 Rewrite link

FS rewrite 中 `link` 条目引用已有节点时，同样走 **ownership** 检查。如果 link 的节点不属于自己，先 claim 再 rewrite。

rewrite schema 中 `link.proof` 字段可以移除：

```json
{
  "entries": {
    "vendor/lib": { "link": "nod_ABC" }
  }
}
```

服务端对 `nod_ABC` 做 ownership 检查。不再需要 `proof` 字段。

---

## 7. 实现计划

### Phase 1: 授权中间件改造

**文件**: `apps/server/backend/src/middleware/proof-validation.ts`

当前的 `proofValidationMiddleware` 做三件事：
1. 解析 `X-CAS-Proof` header
2. 构建 `ProofMap`
3. 调用 `verifyNodeAccess(nodeKey, delegateId, proofMap, ctx)`

**改造为 `nodeAuthMiddleware`**：
1. 从 URL 提取 `{nodeId}`（即 `:key`）
2. 执行 Direct Authorization Check（见 §4.1）：
   - `isRootDelegate(delegateId)` → pass
   - `hasOwnership(nodeId, delegateId)` → pass
   - `nodeId ∈ scopeRoots` → pass
   - 否则 → 403
3. 存入 context：`c.set("authorizedNodeId", nodeId)`

不再需要 `verifyNodeAccess`、`ProofMap`、`parseProofHeader`。

### Phase 2: 路由重构 — 统一在 /nodes/ 命名空间下

**文件**: `apps/server/backend/src/router.ts`

将所有 CAS 节点操作统一到 `/nodes/` 命名空间，通过不同子路径区分：`raw/`、`metadata/`、`fs/`、`check`、`claim`。

**当前路由 → 新路由**：

| 当前 | 新 |
|------|-----|
| `GET /:realmId/nodes/:key` | `GET /:realmId/nodes/raw/:key` |
| `PUT /:realmId/nodes/:key` | `PUT /:realmId/nodes/raw/:key` |
| `GET /:realmId/nodes/:key/metadata` | `GET /:realmId/nodes/metadata/:key` |
| `GET /:realmId/nodes/:key/fs/stat` | `GET /:realmId/nodes/fs/:key/stat` |
| `GET /:realmId/nodes/:key/fs/read` | `GET /:realmId/nodes/fs/:key/read` |
| `GET /:realmId/nodes/:key/fs/ls` | `GET /:realmId/nodes/fs/:key/ls` |
| `POST /:realmId/nodes/:key/fs/write` | `POST /:realmId/nodes/fs/:key/write` |
| `POST /:realmId/nodes/:key/fs/mkdir` | `POST /:realmId/nodes/fs/:key/mkdir` |
| `POST /:realmId/nodes/:key/fs/rm` | `POST /:realmId/nodes/fs/:key/rm` |
| `POST /:realmId/nodes/:key/fs/mv` | `POST /:realmId/nodes/fs/:key/mv` |
| `POST /:realmId/nodes/:key/fs/cp` | `POST /:realmId/nodes/fs/:key/cp` |
| `POST /:realmId/nodes/:key/fs/rewrite` | `POST /:realmId/nodes/fs/:key/rewrite` |
| `POST /:realmId/nodes/:key/claim` | `POST /:realmId/nodes/claim`（批量，见 Phase 6） |

controller 代码不需要改（仍从 `:key` param 获取 nodeId），只改路由注册。

### Phase 3: Node 导航路由

**文件**: `apps/server/backend/src/router.ts`, `apps/server/backend/src/controllers/chunks.ts`

`/nodes/raw/:key` 下现在只剩 GET 和 PUT，安全添加通配符：

```typescript
realmRouter.get("/:realmId/nodes/raw/:key", nodeAuthMiddleware, chunks.get)
realmRouter.put("/:realmId/nodes/raw/:key", canUploadMiddleware, chunks.put)
realmRouter.get("/:realmId/nodes/raw/:key/*", nodeAuthMiddleware, chunks.getNavigated)
```

**`chunks.getNavigated` handler**：
- 解析 `*` 通配部分，所有段必须是 `~\d+` 格式，否则 404
- 从 `{nodeId}` 沿 index path 导航到目标节点
- 返回二进制内容

**metadata 导航**同理：

```typescript
realmRouter.get("/:realmId/nodes/metadata/:key", nodeAuthMiddleware, chunks.getMetadata)
realmRouter.get("/:realmId/nodes/metadata/:key/*", nodeAuthMiddleware, chunks.getMetadataNavigated)
```

### Phase 4: FS path 适配

**文件**: `apps/server/backend/src/controllers/filesystem.ts`

FS 控制器已经支持 `?path=` 中的 `~N` 段（使用 `parsePathSegments()`），**无需改动**。

变化点：
1. 路由路径从 `/nodes/:key/fs/*` 改为 `/nodes/fs/:key/*`
2. 中间件从 `proofValidationMiddleware` 替换为 `nodeAuthMiddleware`

### Phase 5: chunks PUT 简化

**文件**: `apps/server/backend/src/controllers/chunks.ts`

> 注意：PUT 路由使用 `canUploadMiddleware` 而非 `nodeAuthMiddleware`。
> 上传的 `:key` 是新节点的 content hash，不需要事先授权。
> 路由为 `PUT /:realmId/nodes/raw/:key`。
> 授权检查发生在**子节点引用**层面（ownership）。

1. 移除 `X-CAS-Child-Proofs` header 解析逻辑
2. 移除 `parseChildProofsHeader` 和 `validateProofAgainstScope` 调用
3. 对子节点引用只做 **ownership 检查**：`hasOwnership(childKey, delegateId)`
4. root delegate（depth=0）跳过子节点 ownership 检查（全部放行）
5. 不需要任何额外 query parameter 或 header

### Phase 6: Claim API 改造

**文件**: `packages/protocol/src/claim.ts`, `apps/server/backend/src/controllers/claim.ts`, `packages/client/src/api/claim.ts`

1. **protocol schema**：
   - 新增 `BatchClaimRequestSchema`：
     ```typescript
     const PopClaimSchema = z.object({ key: z.string(), pop: z.string() })
     const PathClaimSchema = z.object({ key: z.string(), from: z.string(), path: z.string() })
     const ClaimEntrySchema = z.union([PopClaimSchema, PathClaimSchema])
     const BatchClaimRequestSchema = z.object({ claims: z.array(ClaimEntrySchema) })
     ```
   - 新增 `BatchClaimResponseSchema`
2. **路由**：新增 `POST /:realmId/nodes/claim`（保留旧路由兼容）
3. **controller**：
   - 遍历 claims 数组，对每个 entry：
     - PoP claim：现有 `verifyPoP()` 逻辑
     - Path claim：Direct Authorization Check on `from` → `walkPath(from, path)` → 验证终点 == `key` → 写 ownership
   - 收集 results 数组返回
4. **client**：新增 `batchClaim(baseUrl, realm, token, claims)` 函数

### Phase 7: 客户端改造

**文件**: `packages/client/src/api/nodes.ts`, `packages/client/src/client/nodes.ts`

1. **`getNode(nodeKey, proof?)`** → **`getNode(nodeKey)`**
   - 不再接受 proof 参数
   - 如需导航：`getNode(scopeRoot, indexPath)` → URL `/nodes/raw/{scopeRoot}/{~path}`
2. **`getNodeMetadata`** — URL 改为 `/nodes/metadata/:key`（及 `/nodes/metadata/:key/~N/...`）
3. **FS 操作** — URL 从 `/nodes/:key/fs/*` 改为 `/nodes/fs/:key/*`
4. **移除所有 `X-CAS-Proof` header 设置**

**文件**: `apps/cli/src/commands/node.ts`

5. **CLI** — 移除 `-P, --proof` 选项，改为位置参数或 `--from` 指定起始节点 + path

### Phase 8: `@casfa/proof` 包精简

**文件**: `packages/proof/src/`

1. **移除项**：
   - `parseProofHeader` / `formatProofHeader` — 不再需要 header 解析
   - `ProofMap` 类型 — 不再需要 nodeHash→ProofWord 映射
   - `verifyNodeAccess` / `verifyMultiNodeAccess` — 被 Direct Authorization Check 替代

2. **保留项**：
   - `walkPath(startHash, indices, resolveNode)` — 仍用于 path-based claim 验证和 raw node 导航
   - PoP 相关函数（`computePoP`, `verifyPoP`）— 用于 PoP claim

### Phase 9: 旧系统清理

1. **移除 `X-CAS-Proof` 相关代码**：
   - `proof-validation.ts` 中 `parseProofHeader` 调用
   - `router.ts` CORS `allowHeaders` 中的 `X-CAS-Proof`
   - `template.yaml` CORS 配置

2. **移除 `scope-proof.ts`**：
   - `validateProofAgainstScope` — 被 Direct Authorization + ownership check 替代
   - `parseChildProofsHeader` — 不再需要

3. **protocol schema**：
   - `FsRewriteEntrySchema` 中移除 `link.proof` 字段 — 改为 ownership 检查

### Phase 10: 测试更新

1. 更新 e2e 测试：移除所有 `X-CAS-Proof` / `X-CAS-Child-Proofs` header 使用
2. 更新 e2e 测试：所有 `/nodes/:key/fs/*` → `/nodes/fs/:key/*`，`/nodes/:key/metadata` → `/nodes/metadata/:key`，`/nodes/:key` → `/nodes/raw/:key`
3. proof-validation 单元测试 → nodeAuth 中间件测试
4. 新增：raw node 导航路由测试（`/nodes/raw/:key/~0/~1`）
5. 新增：metadata 导航路由测试（`/nodes/metadata/:key/~0/~1`）
6. 新增：FS path 中 `~N` 导航集成测试（新路径 `/nodes/fs/:key/read`）
7. 新增：batch claim API 测试（PoP + path-based + 混合）
8. 新增：PUT 只检查 ownership 的测试（不传 childProofs）

---

## 8. 影响范围

| 层级 | 变化 | 行数 |
|------|------|------|
| 中间件 | `proofValidationMiddleware` → `nodeAuthMiddleware`（大幅简化） | -100, +30 |
| 路由 | `nodes/raw/:key`, `nodes/metadata/:key`, `nodes/fs/:key/*`, `nodes/claim`, `nodes/check` 统一在 `/nodes/` 下 | +30, -15 |
| controller | `chunks.ts` 简化（移除 childProofs）+ 导航 handler | +20, -40 |
| claim | 新增 batch claim controller（PoP + path-based） | +120 |
| protocol | `BatchClaimRequestSchema` / `BatchClaimResponseSchema` | +30 |
| `@casfa/proof` | 移除 header 解析/验证，保留 `walkPath` + PoP | -150, +0 |
| `scope-proof.ts` | 移除整个文件 | -160 |
| 客户端 | 移除 proof 参数 + 新增 `batchClaim` | -30, +30 |
| CLI | 移除 `--proof` 选项 | -15, +5 |
| 测试 | 大量更新 + 新增 claim 测试 | ~150 行变更 |
| CORS/config | 移除 `X-CAS-Proof` | -5 |
| **净变化** | | **约 -200 行** |

> 这是一个**减法改造** — 移除的代码多于新增的。

---

## 9. 不变的部分

- **CAS URI `~N` 格式** — 直接复用，无需变动
- **FS path 解析** — `parsePathSegments()` 已支持 `~N`，无需改动
- **DAG 导航逻辑** — `walkPath(startHash, indices, resolveNode)` 不变
- **Ownership 系统** — `hasOwnership()` 不变
- **PoP (Proof of Possession)** — 机制和代码不变
- **delegate/scope root 数据模型** — 不变（`scopeNodeHash`, `scopeSetNodeId`）
- **root delegate 快速路径** — `depth === 0` → 全部放行
