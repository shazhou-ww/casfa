# CASFA 数据所有权与权限体系

> 版本: 1.0
> 日期: 2026-02-07
> 基于: delegate-token-refactor 设计 + put-node-children-auth 实施

---

## 目录

1. [概述](#1-概述)
2. [Token 层级与授权链](#2-token-层级与授权链)
3. [Ownership 模型](#3-ownership-模型)
4. [引用授权机制](#4-引用授权机制)
5. [Scope 与读权限](#5-scope-与读权限)
6. [资源操作权限矩阵](#6-资源操作权限矩阵)
7. [端到端流程示例](#7-端到端流程示例)
8. [安全性设计小结](#8-安全性设计小结)

---

## 1. 概述

CASFA（Content-Addressable Storage for Agents）是一个内容寻址存储系统。数据以 **CAS 节点**（Node）的形式存储，每个节点通过其内容的 Blake3 哈希值唯一标识。节点之间通过 hash 引用形成树状结构。

系统面临的核心安全问题：

> **谁拥有这个节点？谁被允许引用它？谁可以读取它？**

本文档完整描述 CASFA 的 **数据所有权**（Ownership）和 **权限体系**（Permissions），涵盖认证、授权、引用验证、作用域证明四大模块。

### 1.1 核心原语

| 概念 | 说明 |
|------|------|
| **User** | 系统中的人类用户，通过 OAuth 登录获取 JWT |
| **Delegate Token (DT)** | 再授权凭证，只能签发子 Token，不能直接操作数据 |
| **Access Token (AT)** | 数据访问凭证，可读写数据，不能签发 Token |
| **Realm** | 数据隔离域，当前等价于 User ID |
| **Node** | CAS 中的最小存储单元，通过内容 hash 标识 |
| **Ownership** | 记录"谁上传了这个 Node"，是引用授权的基础 |
| **Scope** | 一棵 CAS 子树，定义 Token 可访问的数据范围 |
| **Depot** | 带版本历史的根引用，类似 Git 分支 |
| **Ticket** | 临时工作空间，绑定到一个 AT，用于协作场景 |

---

## 2. Token 层级与授权链

### 2.1 两层 Token 架构

CASFA 使用统一的 128 字节二进制格式编码所有 Token。Token 分为两种角色：

```
User (通过 OAuth 登录)
  │
  ├── 签发 → Delegate Token (DT)    ← 只能签发子 Token，不能操作数据
  │             │
  │             ├── 签发 → Access Token (AT)  ← 只能操作数据，不能签发 Token
  │             │
  │             └── 签发 → Delegate Token (DT, 子代)
  │                          │
  │                          └── 签发 → Access Token (AT)
  │
  └── 签发 → Access Token (AT)      ← User 也可以直接签发 AT
```

**核心设计原则**：

- **职责分离**：DT 负责分发权限，AT 负责执行操作——二者不可兼任
- **权限单调递减**：子 Token 的权限只能 ≤ 父 Token，不能扩大
- **TTL 单调递减**：子 Token 的过期时间只能 ≤ 父 Token 的剩余有效时间
- **Scope 单调收缩**：子 Token 的可访问范围只能是父 Token scope 的子集

### 2.2 Token 的六个权限维度

| 维度 | 存储 | 含义 |
|------|------|------|
| **Realm** | 32B realm hash | 数据隔离域，所有操作必须匹配 |
| **类型** | `flags.is_delegate` | 再授权 or 访问 |
| **上传权限** | `flags.can_upload` | 是否可写入新 Node |
| **Depot 权限** | `flags.can_manage_depot` | 是否可创建/删除/提交 Depot |
| **Scope** | 32B scope hash | 可读取的 CAS 子树范围 |
| **TTL** | 8B epoch ms | 过期时间 |

### 2.3 issuerChain — 签发链

每个 Token 记录中存储一个 `issuerChain` 数组，这是该 Token 到根 User 的完整签发路径：

```
User (usr_abc)                     issuerChain = []
  └── DT-A (dlt1_aaa, depth=0)    issuerChain = [usr_abc]
        ├── AT-1 (dlt1_xxx)        issuerChain = [usr_abc, dlt1_aaa]
        └── DT-B (dlt1_bbb)        issuerChain = [usr_abc, dlt1_aaa]
              └── AT-2 (dlt1_yyy)  issuerChain = [usr_abc, dlt1_aaa, dlt1_bbb]
```

签发时预计算：`child.issuerChain = [...parent.issuerChain, parent.issuerId]`

`issuerChain` 是整个权限体系中最重要的数据结构之一，它被用于：

- **Ownership 验证**：判断某个 Node 是否被"家族"中的某个成员上传过
- **Ticket 可见性**：判断一个 Token 是否有权看到另一个 Token 创建的 Ticket
- **级联撤销**：从任意节点出发撤销所有后代 Token

### 2.4 issuerId — Owner 身份

当一个 AT 执行上传操作时，Node 的 Ownership 记录的是 **AT 的 issuerId**（即签发这个 AT 的 DT），而不是 AT 自身的 ID。

为什么？

```
DT-A (dlt1_aaa)
  ├── AT-1 (短期)  ── 上传 Node X ── ownership 记录在 dlt1_aaa
  ├── AT-2 (短期)  ── 想引用 Node X
  └── AT-3 (短期)  ── 想引用 Node X
```

如果 ownership 记录在 AT-1 上，AT-2 和 AT-3 无法通过 uploader 验证引用 Node X（它们是不同的 AT）。但如果 ownership 记录在 DT-A 上，三个 AT 的 `issuerChain` 都包含 `dlt1_aaa`，uploader 验证自然通过。

**规则**：`ownerId = auth.tokenRecord.issuerId`

### 2.5 Delegate Token 永久保留

DT 记录在 DynamoDB 中 **不设置 TTL**，即使过期也不会被自动删除。

原因：Ownership 记录引用的是 DT ID。如果 DT 被自动删除，将无法追溯 "这个 owner 属于哪个用户"，破坏整个 ownership 验证链。

DT 仍有 `expiresAt` 字段用于鉴权，过期的 DT 不能再签发子 Token 或用于认证，但作为历史记录永久存在。DT 的签发频率远低于 AT（一个 DT 可签发成百上千个 AT），全量保留的存储开销极小。

---

## 3. Ownership 模型

### 3.1 设计思想

CASFA 中，Node 的哈希是全局唯一的（内容寻址）。不同用户可能独立上传相同内容的 Node。Ownership 回答的问题是：

> **这个 Node 被谁上传过？**

这不是"谁拥有"（exclusive），而是"谁创建过"（inclusive）——一个 Node 可以有多个 owner。

### 3.2 多 Owner 模型

```
           Node X (hash: abc123)
           ┌──────────────────────┐
           │ Owner 1: dlt1_aaa    │  ← DT-A 的 AT 上传过
           │ Owner 2: dlt1_bbb    │  ← DT-B 的 AT 也上传过
           │ Owner 3: usr_ccc     │  ← User C 直接签发的 AT 上传过
           └──────────────────────┘
```

每次上传（PUT）都会产生一条 ownership 记录，不覆盖已有记录。在 DynamoDB 中：

```
PK = REALM#my-realm
SK = OWN#abc123##dlt1_aaa     → { ownerId: dlt1_aaa, kind: "file", ... }
SK = OWN#abc123##dlt1_bbb     → { ownerId: dlt1_bbb, kind: "file", ... }
SK = OWN#abc123##usr_ccc      → { ownerId: usr_ccc,  kind: "file", ... }
```

Sort Key 的设计 `OWN#{nodeHash}##{ownerId}` 使得：
- 同一 owner 重复上传同一 Node → 幂等覆盖（SK 相同）
- 不同 owner 上传同一 Node → 各自独立（SK 不同）
- 查询某 Node 的所有 owner → `begins_with(SK, "OWN#abc123##")` 前缀查询

### 3.3 关键查询

| 操作 | 用途 | 实现 |
|------|------|------|
| `hasAnyOwnership(realm, key)` | Node 是否存在任何 owner | Query + Limit 1 |
| `hasOwnershipByToken(realm, key, ownerId)` | 某个特定 ID 是否 own 过 | GetItem（精确查询） |
| `listOwners(realm, key)` | 列出所有 owner ID | Query 前缀扫描 |
| `addOwnership(realm, key, ownerId, ...)` | 记录上传 | PutItem（幂等） |

### 3.4 "Family" 检查

当需要验证一个 Token 是否有权引用某个 Node 时，不只是检查该 Token 本身，而是检查整个"家族"：

```
myFamily = [...issuerChain, issuerId]
```

含义：从根 User 到当前 Token 的直接签发者，链条上的每一个 ID 都算"家人"。只要家族中任意一个成员 own 过这个 Node，当前 Token 就有引用权。

```
例：AT-2 的 family = [usr_abc, dlt1_aaa, dlt1_bbb]

Node X 的 owners = [dlt1_aaa]

检查: dlt1_aaa ∈ family → ✓ 授权通过
```

这意味着：**一个 Token 上传的 Node，其所有"子孙" Token 都可以引用。** 这是因为 ownership 记录在 DT 上（而非 AT 上），而所有由该 DT 签发的 AT，以及该 DT 的子代 DT 签发的 AT，`issuerChain` 中都包含该 DT ID。

---

## 4. 引用授权机制

### 4.1 问题场景

CAS 中的 dict/file/successor 节点可以引用（包含）其他节点作为 children。如果不验证 children 的归属，攻击者可以构造一个 dict 节点，将他人上传的节点作为 children，从而在自己的树中"挂载"他人数据。

### 4.2 两步验证

对于每一个被引用的 child，按以下顺序验证：

```
Step 1: Uploader 验证
  ├── child 的 owner 列表中是否包含 myFamily 中的任何 ID？
  └── 是 → ✓ 通过

Step 2: Scope 证明（仅当 Step 1 失败时）
  ├── 请求中是否提供了该 child 的 proof（index-path）？
  ├── proof 是否能从 Token 的 scope root 正确导航到该 child？
  └── 都是 → ✓ 通过

两步都失败 → ✗ 拒绝 (403 CHILD_NOT_AUTHORIZED)
```

### 4.3 在 PUT Node 中的应用

上传一个含 children 的节点时，服务端解码节点二进制数据，提取所有 child hash，对每个 child 执行两步验证。

Scope proof 通过 HTTP Header 提供：

```http
PUT /api/realm/{realmId}/nodes/{key}
Authorization: Bearer {access_token_base64}
X-CAS-Child-Proofs: child1_hex=0:1:2,child2_hex=0:3
```

Header 格式：逗号分隔的 `childHex=indexPath` 对。只有 uploader 验证失败的 child 才需要 proof，大多数 children 通常能直接通过 uploader 验证。

### 4.4 在 fs/rewrite link 中的应用

文件系统 rewrite 操作的 `link` 条目允许引用已有节点。验证逻辑相同：

```json
{
  "entries": {
    "path/to/file": {
      "link": "node:abc123...",
      "proof": "0:1:2"
    }
  }
}
```

1. 先做 uploader 验证（检查 myFamily 中是否有人 own 过目标节点）
2. 失败则用 `proof` 字段做 scope 验证
3. 都失败 → `403 LINK_NOT_AUTHORIZED`

### 4.5 在 Depot Commit 中的应用

更新 Depot 的 root 时，也必须验证新 root 节点的 ownership：

```
PATCH /api/realm/{realmId}/depots/{depotId}
Body: { root: "node:abc123..." }

验证: myFamily 中是否有人 own 过 abc123 → 是 → 允许 commit
```

### 4.6 prepare-nodes 三分类

客户端上传前通常先调用 `POST /nodes/prepare` 确定哪些节点需要上传。响应采用三分类：

| 分类 | 含义 | 客户端行为 |
|------|------|-----------|
| `missing` | 节点不存在于 CAS 中 | 必须上传 |
| `owned` | 节点存在，且被 myFamily 中的人 own 过 | 不需要上传，可直接引用 |
| `unowned` | 节点存在，但不被 myFamily own | 需要重新上传以获取 ownership |

客户端需要上传 `missing` + `unowned` 中的所有节点。重新上传 `unowned` 节点不会增加存储空间（PUT 幂等），但会创建新的 ownership 记录。

---

## 5. Scope 与读权限

### 5.1 Scope 是什么

Scope 定义了一个 Token 可以读取的 CAS 子树。它是一个或多个 CAS 节点 hash，代表子树的根。

```
Scope Root: node A
              │
         ┌────┼────┐
         B    C    D         ← Token 可读取 A 以及 A 的所有后代
        / \   │
       E   F  G
```

Token 读取任何节点时，必须证明该节点是 scope root 的后代。

### 5.2 两种 Scope 存储形式

| 形式 | Token 记录字段 | 说明 |
|------|---------------|------|
| **单 Scope** | `scopeNodeHash` | 直接存储一个 CAS 节点 hash（最常见） |
| **多 Scope** | `scopeSetNodeId` | 引用 DynamoDB 中的 ScopeSetNode 记录 |

ScopeSetNode 是数据库中的记录（不是 CAS 节点），包含多个 scope root hash 的有序列表，带引用计数用于垃圾回收。

### 5.3 Index-Path 证明

读取节点时，客户端必须在 `X-CAS-Index-Path` Header 中提供 **index-path**——一条从 scope root 到目标节点的导航路径。

```
X-CAS-Index-Path: 0:1:2
```

含义：
- `0` → 选择第几个 scope root（单 scope 时固定为 0）
- `1` → scope root 节点的第 1 个 child
- `2` → 上一步节点的第 2 个 child

服务端验证：沿 index-path 逐层遍历 CAS 树，检查最终到达的节点是否就是请求的目标节点。

```
Scope Root (hash=AAA)
  ├── [0] child (hash=BBB)
  │     ├── [0] child (hash=DDD)
  │     └── [1] child (hash=EEE)  ← index-path "0:0:1" 到达 EEE
  └── [1] child (hash=CCC)
```

### 5.4 Scope 在 Token 签发时的收缩

User 签发 DT 时，scope 通过 CAS URI 指定：
- `cas://depot:DEPOT_ID` → 解析为该 Depot 当前的 root hash
- `cas://*` → 该 Realm 下所有 Depot 的 root（通配符）
- `cas://node:HASH` → 直接指定节点 hash

DT 签发子 Token 时，子 scope 必须是父 scope 的子集。用相对路径表示：
- `"."` → 继承父 scope 全部
- `"0:1:2"` → 从父 scope root 的第 0 个 root，沿 index 1、2 导航到的子树

这确保了 **scope 只能单调收缩**——子 Token 永远不可能访问父 Token 看不到的数据。

### 5.5 Scope 证明在写入中的作用

Scope 不仅用于读取验证，也用于**引用授权**（§4）。当 Token 需要引用一个自己 family 没有 own 过的节点时，可以通过 scope 证明（proof）证明该节点在自己的 scope 树内，从而获得引用权。

这解决了以下场景：

```
User (usr_abc)
  ├── DT-A (scope: Depot-1)
  │     └── AT-1  ── 上传 Node X
  └── DT-B (scope: Depot-1)
        └── AT-2  ── 想引用 Node X

AT-2 的 family = [usr_abc, dlt1_bbb]
Node X 的 owner = dlt1_aaa  ← 不在 AT-2 的 family 中
```

此时 AT-2 无法通过 uploader 验证，但 Node X 在 AT-2 的 scope（Depot-1）中，AT-2 提供 proof 即可通过 scope 验证。

---

## 6. 资源操作权限矩阵

### 6.1 认证类型

| 操作类型 | 需要的认证 |
|---------|-----------|
| OAuth 登录/注册 | 无 |
| 管理员操作 | JWT + Admin 角色 |
| Token 管理（创建/列表/撤销） | JWT（User 登录态） |
| Token 转签发 | Delegate Token |
| 所有 Realm 数据操作 | Access Token |

### 6.2 Access Token 操作权限

| 操作 | 需要 `canUpload` | 需要 `canManageDepot` | 需要 Scope 证明 | 其他检查 |
|------|:-:|:-:|:-:|------|
| **Node 读取** (`GET /nodes/:key`) | | | ✓ | index-path 验证 |
| **Node 元数据** (`GET /nodes/:key/metadata`) | | | ✓ | index-path 验证 |
| **Node 上传** (`PUT /nodes/:key`) | ✓ | | | children 引用验证 |
| **Node 准备** (`POST /nodes/prepare`) | | | | 返回三分类 |
| **FS 读** (stat, read, ls) | | | | |
| **FS 写** (write) | ✓ | | | Scope 验证（中间件） |
| **FS mkdir** | ✓ | | | |
| **FS rm/mv/cp** | ✓ | | | |
| **FS rewrite** | ✓ | | | link 引用验证 |
| **Depot 列表/查看** | | | | |
| **Depot 创建/删除** | | ✓ | | |
| **Depot Commit** | | ✓ | | root ownership 验证 |
| **Ticket 创建** | ✓ | | | 绑定当前 AT |
| **Ticket 提交** | | | | root hash |
| **Ticket 查看/撤销** | | | | issuerChain 可见性 |

### 6.3 鉴权中间件栈

```
请求进入
  │
  ├── authMiddleware          ← 提取 JWT 或 Token，验证有效性
  │     ├── JWT → JwtAuthContext
  │     ├── DT  → DelegateTokenAuthContext
  │     └── AT  → AccessTokenAuthContext
  │
  ├── realmAccessMiddleware   ← 验证 Token 的 realm 匹配请求路径
  │
  ├── canUploadMiddleware     ← 检查 flags.can_upload（仅写入路由）
  │
  ├── canManageDepotMiddleware ← 检查 flags.can_manage_depot（仅 Depot 管理路由）
  │
  ├── scopeValidationMiddleware ← 验证 X-CAS-Index-Path（仅 Node 读取路由）
  │
  ├── zValidator              ← Zod schema 验证请求体
  │
  └── Handler                 ← 业务逻辑（含内联的 ownership/proof 验证）
```

---

## 7. 端到端流程示例

### 7.1 Agent 上传文件树

```
1. User 登录 → 获取 JWT

2. User 用 JWT 签发 DT-A (canUpload=true, scope=Depot-1)
   → 将 DT-A 的 128 字节 base64 交给 Agent

3. Agent 用 DT-A 签发 AT-1 (canUpload=true, scope=继承)
   → 获得 AT-1 的 128 字节 base64

4. Agent 准备上传，先调用 prepare-nodes
   POST /nodes/prepare { keys: [A, B, C, D] }
   → { missing: [A, B], owned: [], unowned: [C, D] }

5. Agent 上传叶子节点（无 children）
   PUT /nodes/A  → ownership 记录在 DT-A (AT-1 的 issuerId)
   PUT /nodes/B  → ownership 记录在 DT-A
   PUT /nodes/C  → 重传获取 ownership（C 已存在但未被 family own）
   PUT /nodes/D  → 重传获取 ownership

6. Agent 上传父节点（含 children = [A, B]）
   PUT /nodes/E  (children: [A, B])
   → 服务端检查: A 的 owner 含 DT-A? ✓   B 的 owner 含 DT-A? ✓
   → 上传成功，ownership 记录在 DT-A

7. Agent 提交 Depot
   PATCH /depots/Depot-1 { root: "node:E..." }
   → 服务端检查: E 的 owner 含 DT-A? ✓  → commit 成功
```

### 7.2 跨 DT 分支引用（需要 Scope 证明）

```
User (usr_abc)
  ├── DT-A → AT-1 上传了 Node X (owner: DT-A)
  └── DT-B → AT-2 想在 rewrite 中 link Node X

AT-2 的 myFamily = [usr_abc, DT-B]
Node X 的 owners = [DT-A]

Step 1: uploader 验证 → DT-A ∉ myFamily → 失败
Step 2: AT-2 提供 proof "0:3:1"
  → 验证: AT-2 的 scope root → child[3] → child[1] → 结果 == Node X → ✓

rewrite 成功
```

### 7.3 Ticket 协作流程

```
1. Agent 用 AT-1 (canUpload) 创建 Ticket
   POST /tickets { title: "Code Review Task" }
   → 服务端自动绑定 AT-1 的 tokenId

2. Tool 用 AT-1 上传工作结果到 CAS

3. Tool 用 AT-1 提交 Ticket
   POST /tickets/{id}/submit { root: "node:abc..." }

4. 上游 Agent 用 AT-0 (issuerChain 包含 AT-1 的 issuerId) 查看 Ticket
   → issuerChain 可见性检查 ✓

5. Agent 用 AT-0 commit 到 Depot
```

---

## 8. 安全性设计小结

### 8.1 设计原则

| 原则 | 实现 |
|------|------|
| **最小权限** | 权限六维度，每维度签发时只减不增 |
| **能力衰减** | 每一层 delegation 都只能缩小权限、scope、TTL |
| **所有权追溯** | Ownership 记录在 DT 上而非 AT 上，DT 永久保留 |
| **双重验证** | 引用授权 = uploader 验证 + scope 证明，缺一不可 |
| **零信任引用** | 每个 child 引用都单独验证，不信任"节点存在即可引用" |
| **内容证明** | hash 泄漏 ≠ 内容泄漏。重传需要完整数据，proof 需要合法 scope |

### 8.2 防御的攻击场景

| 攻击 | 防御 |
|------|------|
| **跨用户节点挂载**：构造 dict 引用他人节点 | children 引用验证：uploader + scope 双重检查 |
| **proof 伪造**：随意填写 proof 绕过验证 | proof 实际遍历 CAS 树验证，伪造的 index-path 无法到达目标 |
| **hash 猜测**：知道 hash 就引用 | prepare-nodes 返回 `unowned`，重传需要完整数据 |
| **过期 Token 残留访问** | 鉴权检查 expiresAt + isRevoked，级联撤销所有后代 |
| **scope 逃逸** | scope 单调收缩 + index-path 逐层验证 |
| **Depot 根篡改** | commit 时验证 root 节点的 family ownership |

### 8.3 数据模型一览

```
DynamoDB 单表设计（主要实体）:

Token 记录:
  PK = TOKEN#{tokenId}    SK = METADATA
  GSI1: REALM#{realm} → TOKEN#{tokenId}
  GSI2: ISSUER#{issuerId} → TOKEN#{tokenId}

Ownership 记录:
  PK = REALM#{realm}      SK = OWN#{nodeHash}##{ownerId}

Depot 记录:
  PK = REALM#{realm}      SK = DEPOT#{depotId}

Ticket 记录:
  PK = REALM#{realm}      SK = TICKET#{ticketId}

ScopeSetNode 记录:
  PK = SETNODE#{setNodeId} SK = METADATA
  children: string[]  (有序 scope root hash 列表)
  refCount: number    (引用计数)

RefCount 记录:
  PK = REALM#{realm}      SK = REF#{nodeHash}
```

### 8.4 关键不变量

1. **Token 链不可逆**：子 Token 永远无法获得比父 Token 更多的权限
2. **Ownership 不可伪造**：只有真正上传过数据的 Token（通过其 issuerId）才有 ownership
3. **Scope 不可扩展**：delegation 只能收缩 scope，永远不可能读到 scope 外的节点
4. **引用必须授权**：无论是 PUT children、rewrite link 还是 depot commit，都必须通过 uploader 或 scope 证明
5. **DT 永久存在**：Ownership 追溯链永远不会断裂
