# CASFA 认证与权限体系

> 最后更新: 2026-02-24

本文档是 CASFA 认证（Authentication）与权限（Authorization）体系的综合概览。详细设计见同目录下的子文档。

---

## 目录

1. [整体架构](#1-整体架构)
2. [认证方式](#2-认证方式)
3. [Delegate 模型](#3-delegate-模型)
4. [权限维度](#4-权限维度)
5. [授权判定](#5-授权判定)
6. [Ownership 模型](#6-ownership-模型)
7. [Claim 与 Proof-of-Possession](#7-claim-与-proof-of-possession)
8. [OAuth 2.1 第三方授权](#8-oauth-21-第三方授权)
9. [端到端流程](#9-端到端流程)
10. [安全设计要点](#10-安全设计要点)

---

## 1. 整体架构

```
User (OAuth/Local Login)
  │
  │  JWT
  ▼
┌──────────────────────────────────────────────────────┐
│  统一鉴权中间件 (accessTokenMiddleware)                │
│                                                      │
│  Bearer Token 包含 "." → JWT 路径                     │
│  Bearer Token 不含 "." → AT 路径                      │
│                                                      │
│  两条路径均产生 AccessTokenAuthContext                  │
└──────────────────────────┬───────────────────────────┘
                           │
                           ▼
              ┌── Delegate Tree ──┐
              │                   │
              │  Root (depth=0)   │ ← User JWT 直接使用
              │    ├── Child A    │ ← AT/RT（MCP、CLI、IDE 等）
              │    │   └── A1     │ ← 再转签发
              │    └── Child B    │
              │                   │
              └───────────────────┘
                           │
                           ▼
              ┌── 授权判定 ──┐
              │              │
              │  nodeAuth    │ ← O(1) Direct Authorization Check
              │  canUpload   │
              │  canManage   │
              │  Depot       │
              │              │
              └──────────────┘
```

**核心原则**：

- Delegate 是一等业务实体，不是 Token
- Token 仅是 Delegate 的临时凭证
- Root Delegate 使用 JWT 直接鉴权，无需 AT/RT
- 所有授权判定均为 O(1)，无需自定义 HTTP Header

---

## 2. 认证方式

### 2.1 三种 Bearer Token

系统通过 `Authorization: Bearer` 头接受三种凭证：

| 凭证 | 大小 | 格式判断 | 用途 |
|------|------|----------|------|
| **User JWT** | 可变 | 包含 `.` 分隔符 | 所有操作（Root Delegate 身份） |
| **Access Token (AT)** | 32 字节 | base64，无 `.` | 数据操作（Child Delegate 身份） |
| **Refresh Token (RT)** | 24 字节 | base64，无 `.` | 仅用于旋转获取新 RT + AT |

### 2.2 Token 二进制格式

| Token | 布局 |
|-------|------|
| AT (32B) | `[delegateId 16B][expiresAt 8B LE][nonce 8B]` |
| RT (24B) | `[delegateId 16B][nonce 8B]` |

- 服务端仅保存 Token 的 **Blake3-128 hash**（`currentRtHash` / `currentAtHash`），不保存原文
- Token 仅在创建时返回一次
- 无独立 `TokenRecord` 表 — hash 直接存储在 Delegate 实体上

### 2.3 统一鉴权中间件

`accessTokenMiddleware` 是所有 Realm 路由的入口鉴权层，**同时支持 JWT 和 AT**：

- **JWT 路径**：验证 JWT → 查 User → `getOrCreateRoot()` 获取 Root Delegate → 构造 `AccessTokenAuthContext`
- **AT 路径**：base64 解码 → 提取 delegateId → 查 Delegate → Blake3 hash 比对 → 构造 `AccessTokenAuthContext`

两条路径产生**完全相同**的 `AccessTokenAuthContext`，下游所有中间件和 controller 无需区分。

### 2.4 Token 旋转

- `POST /api/auth/refresh`：用 RT 原子旋转获取新 RT + AT（一次性使用，DynamoDB conditional update 防重放）
- Root Delegate **不支持** refresh（使用 JWT 直通，OAuth JWT 2由 provider 管理续期）
- 每个 Delegate 同一时刻只有一对有效 RT/AT — 旋转后旧 Token 立即失效

---

## 3. Delegate 模型

### 3.1 Delegate 是一等业务实体

Delegate 不是 Token，而是一个**持久化的业务实体**：

| 特性 | Delegate（实体） | Token（凭证） |
|------|------------------|---------------|
| 生命周期 | 永久存储，不可删除 | 有过期时间 |
| 身份 | Ownership 的主体 | Delegate 的"代言人" |
| 关系 | 组成 immutable 树 | 绑定到某个 Delegate |
| 状态 | 可被 revoke 或过期 | 有效或无效 |

### 3.2 Delegate 树

```
User (usr_abc)
  └── Root Delegate (dlt_root)           ← depth=0, 自动创建
        ├── Delegate-A (dlt_aaa)         ← depth=1, MCP Client
        │     └── Delegate-A1 (dlt_a1)   ← depth=2, 子工具
        └── Delegate-B (dlt_bbb)         ← depth=1, CLI
```

- **Immutable**：创建后父子关系不可修改
- **不可删除**：与 Ownership 关联，删除会破坏追溯
- **可设有效期**：`expiresAt` 过期后视为自动 revoke
- **可吊销**：任何祖先可 revoke 子孙（级联生效）
- **深度限制**：最多 16 层（depth 0–15）

### 3.3 Root Delegate 特殊性

- 使用 **JWT 直通**鉴权，不持有 AT/RT
- 中间件首次 JWT 请求时自动创建（`getOrCreateRoot()`）
- 拥有 Realm 内全部权限，无 scope 限制
- 跳过 PoP 验证（因为使用 JWT，无 token bytes）
- 多设备并发无冲突（JWT 无状态）

---

## 4. 权限维度

每个 Delegate 在创建时由父 Delegate 分配不可变的权限：

| 维度 | 类型 | 说明 |
|------|------|------|
| `canUpload` | `boolean` | 上传 CAS 节点的权限 |
| `canManageDepot` | `boolean` | 创建/修改/删除 Depot 的权限 |
| `scopeNodeHash` | `string?` | 单 scope：CAS 节点 hash 作为 scope root |
| `scopeSetNodeId` | `string?` | 多 scope：引用包含多个 scope root 的 ScopeSetNode |
| `delegatedDepots` | `string[]?` | 显式可管理的 Depot ID 列表 |
| `expiresAt` | `number?` | 有效期（毫秒时间戳） |
| `depth` | `0–15` | 在 delegate 树中的深度 |
| `chain` | `string[]` | 从 root 到自身的完整路径 |

**单调非升级规则**：子 Delegate 的权限 ≤ 父 Delegate — `canUpload`、`canManageDepot` 只能从 `true` 降为 `false`，scope 只能收缩，depot 列表只能是父集的子集。

---

## 5. 授权判定

### 5.1 Node 访问 — Direct Authorization Check

所有节点访问操作（读、metadata、fs）通过 `nodeAuthMiddleware` 执行 O(1) 判定：

```
授权判定流程：
  1. 是 well-known 节点（EMPTY_DICT 等）→ ✅ 放行
  2. 是 Root Delegate（depth=0）→ ✅ 任意节点放行
  3. hasOwnership(nodeKey, delegateChain 中任一 ID) → ✅ 放行
  4. nodeKey ∈ delegate 的 scope roots → ✅ 放行
  5. 否则 → ❌ 403 NODE_NOT_AUTHORIZED
```

### 5.2 Path-as-Proof（路径即证明）

URL 中的 `~N` 导航段提供**隐式授权**：

```
GET /api/realm/{realmId}/nodes/raw/{nodeKey}/~0/~1
```

- `{nodeKey}` 必须通过上述 Direct Authorization Check
- `~0`、`~1` 沿 DAG 向下导航到子节点
- 能从 `{nodeKey}` 到达的节点，天然在 delegate 的授权范围内

FS 操作的 `?path=` 中也可包含 `~N` 段：

```
GET /api/realm/{realmId}/nodes/fs/{nodeKey}/read?path=~1/~2/src/main.ts
```

**无需自定义 HTTP Header**（`X-CAS-Proof` / `X-CAS-Child-Proofs` 已废弃），URL 结构自然承载授权信息。

### 5.3 写操作授权

| 操作 | 额外要求 |
|------|----------|
| PUT node | `canUpload` 权限 |
| FS 写操作 | `nodeAuthMiddleware` + `canUpload` |
| Depot commit | `canUpload` 权限 |
| Depot 创建/修改/删除 | `canManageDepot` 权限 |
| 创建子 Delegate | 仅可授出 ≤ 自身的权限 |

### 5.4 PUT 子节点引用验证

上传 d-node 时，服务端验证所有子节点引用的合法性：

- 每个被引用的子节点 hash 必须在 Ownership 表中被 delegate chain 中的某个 ID 拥有
- 或该子节点是 well-known 节点
- 否则返回 `CHILD_NOT_AUTHORIZED`

这确保 delegate 只能引用自己（或祖先）上传的节点，防止构造非法 DAG。

---

## 6. Ownership 模型

### 6.1 核心设计

- **Multi-owner（多所有者）**：同一节点可被多个 Delegate 拥有（CAS 中内容相同 → hash 相同 → 天然去重）
- **Append-only（只增不删）**：Ownership 记录只追加，不删除、不覆盖
- **Full-chain write（全链写入）**：上传节点时，执行 Delegate 的整条 chain（root → ... → self）都写入 Ownership
- **O(1) 查询**：`DelegateOwnership` 表以 `(realmId, nodeKey, delegateId)` 为主键，查询是否拥有某节点 = 一次 DynamoDB Get

### 6.2 为什么全链写入

Child Delegate A1 上传节点时，写入 `[root, A, A1]` 三条 Ownership 记录。好处：

- Root Delegate 自动拥有所有下辖节点（无需递归查询）
- 任意中间层 Delegate 也自动拥有（如 A 自动拥有 A1 上传的节点）
- 授权判定变为简单的 `hasOwnership(nodeKey, delegateId)` — 对 chain 中任一 ID 查一次

### 6.3 Revoke 与 Ownership

Delegate 被 revoke 后：

- 不再能通过 Token 访问数据
- Ownership 记录**不删除**（保留审计追踪）
- 其他 Delegate（如祖先）对同一节点的 Ownership 不受影响

---

## 7. Claim 与 Proof-of-Possession

### 7.1 Claim 的用途

当 Delegate B 需要引用 Delegate A 已上传的节点时（例如同一文件的不同 DAG 路径），不需要重传：

```
POST /api/realm/{realmId}/nodes/claim
Body: { claims: [{ key: "nod_xxx", pop: "pop:XXXXXX" }] }
```

### 7.2 Proof-of-Possession (PoP)

证明"我确实持有节点内容"而无需重传：

```
popKey = blake3_256(tokenBytes)        // 32B 密钥，源自 AT 原始字节
popHash = blake3_128_keyed(content, popKey)  // 带密钥的内容 hash
pop = "pop:" + crockfordBase32(popHash)
```

- Root Delegate（JWT 模式）跳过 PoP 验证
- 批量 Claim 也支持 path-based reachability：从已拥有的节点沿 DAG 可达 → 无需 PoP

---

## 8. OAuth 2.1 第三方授权

外部客户端（MCP Server、VS Code 插件、CLI）通过标准 OAuth 2.1 Authorization Code + PKCE 获取 Delegate Token：

1. 客户端注册（`POST /api/auth/register`，可选）
2. 生成 PKCE `code_verifier` + `code_challenge`
3. 引导用户授权（浏览器 consent 页面）
4. 授权码换 Token（`POST /api/auth/token`）
5. 服务端创建 depth=1 的 Child Delegate + 返回 AT/RT

OAuth Scopes 映射：

| Scope | 映射 |
|-------|------|
| `cas:read` | 始终授予 |
| `cas:write` | `canUpload: true` |
| `depot:manage` | `canManageDepot: true` |

---

## 9. 端到端流程

### 9.1 用户直接操作（JWT Root）

```
1. 用户 OAuth 登录 → 获取 JWT
2. 请求 /api/realm/usr_xxx/nodes/fs/nod_ROOT/ls
3. 中间件检测 JWT → getOrCreateRoot() → AccessTokenAuthContext
4. nodeAuthMiddleware: root delegate → 全部放行
5. Controller 执行 FS ls 操作
```

### 9.2 MCP Client 操作（AT Child）

```
1. MCP 用 OAuth 2.1 获取 AT（depth=1 child delegate）
2. 请求 /api/realm/usr_xxx/nodes/raw/nod_ABC
3. 中间件检测 AT → 解码 → 查 delegate → hash 验证 → AccessTokenAuthContext
4. nodeAuthMiddleware: 检查 ownership 或 scope
5. Controller 返回节点数据
```

### 9.3 上传并引用节点

```
1. PUT /nodes/raw/nod_LEAF (上传叶节点)
   → Ownership 全链写入 [root, childA, childA1]
2. PUT /nodes/raw/nod_DIR (上传目录，引用 nod_LEAF)
   → 子节点引用验证：nod_LEAF 的 ownership 包含 chain 中的 ID → ✅
   → Ownership 全链写入
3. POST /depots/:depotId/commit { root: "nod_DIR" }
   → 验证 nod_DIR ownership → 提交
```

---

## 10. 安全设计要点

| 机制 | 设计 |
|------|------|
| Token 存储 | 仅保存 Blake3 hash，原文不持久化 |
| RT 旋转 | 一次性使用，DynamoDB conditional update 防止并发重放 |
| 权限非升级 | 子 delegate 权限 ≤ 父，建模时静态校验 |
| Revoke 级联 | revoke 任意节点，所有后代立即失效 |
| 全链写入 | Ownership 写入整条 chain，提供 O(1) 查询和自然继承 |
| PoP | 上传者证明持有内容，防止 ownership 伪造 |
| 子引用验证 | PUT d-node 验证所有 child hash 的 ownership |
| JWT 无状态 | Root Delegate 使用 JWT，多设备并发无冲突 |
| PKCE | OAuth 2.1 强制 S256 PKCE，防授权码拦截 |

---

## 详细文档

| 文档 | 内容 |
|------|------|
| [ownership-and-permissions.md](./ownership-and-permissions.md) | 权限体系完整规格（v3.5，权威文档） |
| [put-node-children-auth.md](./put-node-children-auth.md) | PUT 子节点引用授权的设计 |
| [root-delegate-jwt-auth.md](./root-delegate-jwt-auth.md) | Root Delegate JWT 直通方案 |
| [permissions-review.md](./permissions-review.md) | 权限体系 peer review |

### 相关规划文档（在 `docs/plan/`）

| 文档 | 内容 |
|------|------|
| [proof-inline-migration](../plan/proof-inline-migration/README.md) | Path-as-Proof 迁移设计 |
| [token-simplification](../plan/token-simplification/README.md) | Token 简化（消除 TokenRecord 表） |
| [delegate-token-refactor](../plan/delegate-token-refactor/README.md) | Delegate 体系原始设计（v1.0，已被 v3.5 取代） |
