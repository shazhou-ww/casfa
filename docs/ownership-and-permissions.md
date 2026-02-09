# CASFA 数据所有权与权限体系

> 版本: 2.0
> 日期: 2026-02-09
> 基于: delegate-token-refactor 设计 + ownership 正规化

---

## 目录

1. [概述](#1-概述)
2. [Token 层级与授权链](#2-token-层级与授权链)
3. [Ownership 模型](#3-ownership-模型)
4. [认证与授权模型](#4-认证与授权模型)
5. [Claim API](#5-claim-api)
6. [资源操作权限矩阵](#6-资源操作权限矩阵)
7. [端到端流程示例](#7-端到端流程示例)
8. [安全性设计小结](#8-安全性设计小结)

---

## 1. 概述

CASFA（Content-Addressable Storage for Agents）是一个内容寻址存储系统。数据以 **CAS 节点**（Node）的形式存储，每个节点通过其内容的 Blake3 哈希值唯一标识。节点之间通过 hash 引用形成 DAG（有向无环图）结构。

系统面临的核心安全问题：

> **谁拥有这个节点？谁被允许引用它？谁可以读取它？**

本文档完整描述 CASFA 的 **数据所有权**（Ownership）和 **权限体系**（Permissions），涵盖三层 Token 认证、双 Header 授权验证、Ownership 全链写入、Claim 机制四大模块。

### 1.1 核心原语

| 概念 | 说明 |
|------|------|
| **User** | 系统中的人类用户，通过 OAuth 登录获取 JWT（User Token） |
| **Delegate Token (DT)** | 再授权凭证，只能签发子 Token，不能直接操作数据 |
| **Access Token (AT)** | DT 的执行代理，完全继承 DT 的 scope 和 quota，收紧 TTL，不能转签 |
| **Realm** | 数据隔离域，当前等价于 User ID |
| **Node** | CAS 中的最小存储单元，通过内容 hash 标识 |
| **Ownership** | 记录"谁上传了这个 Node"，按 delegate chain 全链写入 |
| **Scope** | 一棵 CAS 子树，定义 Token 可访问的数据范围 |
| **Proof** | 证明某节点在 Token scope 内的 index-path 路径 |
| **Claim** | 通过 proof-of-possession 获取已有节点的 ownership，无需重传 |
| **Depot** | 带版本历史的根引用，类似 Git 分支 |
| **Ticket** | 临时工作空间，绑定到一个 AT，用于协作场景 |

---

## 2. Token 层级与授权链

### 2.1 三层 Token 架构

CASFA 使用严格的三层 Token 体系。所有 Token 共享统一的 128 字节二进制格式，通过 `flags.is_delegate` 位区分角色：

```
User (通过 OAuth 登录，持有 JWT)
  │
  ├── 签发 → Delegate Token (DT-A, depth=0)     ← 授权分发，不能操作数据
  │             │
  │             ├── 签发 → Access Token (AT-1)   ← DT-A 的执行代理
  │             ├── 签发 → Access Token (AT-2)   ← DT-A 的另一个执行代理
  │             │
  │             └── 签发 → Delegate Token (DT-B, depth=1)  ← 子代 DT
  │                          │
  │                          ├── 签发 → Access Token (AT-3) ← DT-B 的执行代理
  │                          └── ...
  │
  └── (User 不能直接签发 AT，必须先创建 DT)
```

**三层职责**：

| 层级 | 角色 | 能力 |
|------|------|------|
| **User Token (JWT)** | 身份认证 | 管理 Token（创建/列表/撤销 DT），不操作数据 |
| **Delegate Token (DT)** | 授权分发 | 签发子 DT 或 AT，不操作数据 |
| **Access Token (AT)** | 执行代理 | 读写数据，不能签发任何 Token |

### 2.2 Access Token 是 Delegate Token 的执行代理

AT 与其父 DT 之间是严格的**代理关系**：

- **Scope 相同**：AT 的 scope 必须与父 DT 完全一致，签发时强制继承，不可修改
- **Quota 相同**：AT 的 quota 必须与父 DT 完全一致，签发时强制继承，不可修改
- **TTL 收紧**：AT 的过期时间 ≤ 父 DT 的剩余有效时间（通常远短于 DT）
- **无转签权限**：AT 不能签发任何子 Token

可以理解为：**AT 是 DT 的短期一次性"执行手柄"**。一个 DT 可以签发多个 AT 用于不同任务，每个 AT 完全代理该 DT 的数据访问能力。

```
DT-A (scope=Depot-1, quota=100MB, TTL=30d)
  ├── AT-1 (scope=Depot-1, quota=100MB, TTL=1h)   ← 完全代理 DT-A
  ├── AT-2 (scope=Depot-1, quota=100MB, TTL=1h)   ← 完全代理 DT-A
  └── AT-3 (scope=Depot-1, quota=100MB, TTL=15min) ← 完全代理 DT-A，更短 TTL
```

### 2.3 DT 签发子 DT 的权限收缩

DT 签发子 DT 时（非 AT），遵循**单调递减原则**：

- **权限只减不增**：子 DT 的 `canUpload`、`canManageDepot` 只能 ≤ 父 DT
- **Scope 只缩不扩**：子 DT 的 scope 只能是父 DT scope 的子集
- **TTL 只短不长**：子 DT 的过期时间 ≤ 父 DT 的剩余有效时间
- **Depth 递增**：子 DT 的 depth = 父 DT 的 depth + 1（最大 15）

### 2.4 Token 的六个权限维度

| 维度 | 存储 | 含义 | AT 规则 |
|------|------|------|---------|
| **Realm** | 32B realm hash | 数据隔离域，所有操作必须匹配 | 继承 DT |
| **类型** | `flags.is_delegate` | 再授权(DT) or 执行(AT) | 固定为 AT |
| **上传权限** | `flags.can_upload` | 是否可写入新 Node | 继承 DT |
| **Depot 权限** | `flags.can_manage_depot` | 是否可创建/删除/提交 Depot | 继承 DT |
| **Scope** | 32B scope hash | 可读取的 CAS 子树范围 | **强制等于 DT** |
| **TTL** | 8B epoch ms | 过期时间 | ≤ DT 剩余时间 |

### 2.5 Delegate Chain 与 issuerChain

每个 Token 记录中存储一个 `issuerChain` 数组——该 Token 到根 User 的完整签发路径：

```
User (usr_abc)                     issuerChain = []
  └── DT-A (dlt1_aaa, depth=0)    issuerChain = [usr_abc]
        ├── AT-1 (dlt1_xxx)        issuerChain = [usr_abc, dlt1_aaa]
        └── DT-B (dlt1_bbb)        issuerChain = [usr_abc, dlt1_aaa]
              ├── AT-2 (dlt1_yyy)  issuerChain = [usr_abc, dlt1_aaa, dlt1_bbb]
              └── DT-C (dlt1_ccc)  issuerChain = [usr_abc, dlt1_aaa, dlt1_bbb]
```

签发时预计算：`child.issuerChain = [...parent.issuerChain, parent.issuerId]`

**Delegate Chain**（委托链）指的是从根 User 到某个 DT 的完整路径，例如 DT-B 的 delegate chain 为 `[usr_abc, dlt1_aaa, dlt1_bbb]`。AT 的 delegate chain 等于其父 DT 的 delegate chain。

`issuerChain` 被用于：

- **Ownership 写入**：节点创建时为 delegate chain 上每一层都写入 ownership
- **Ownership 查询**：验证当前 DT 是否 own 过某节点
- **Ticket 可见性**：判断一个 Token 是否有权看到另一个 Token 创建的 Ticket
- **级联撤销**：从任意节点出发撤销所有后代 Token

### 2.6 issuerId — Owner 身份

AT 执行数据操作时，其身份等同于签发它的 DT。所有 ownership 记录的 ownerId 是 **AT 的 issuerId**（即父 DT 的 tokenId），而不是 AT 自身的 ID：

```
DT-A (dlt1_aaa)
  ├── AT-1 (短期)  ── 上传 Node X ── ownership 记录在 dlt1_aaa
  ├── AT-2 (短期)  ── 可直接引用 Node X（因为 dlt1_aaa 是 owner）
  └── AT-3 (短期)  ── 可直接引用 Node X（因为 dlt1_aaa 是 owner）
```

**规则**：`ownerId = auth.tokenRecord.issuerId`（即父 DT 的 tokenId）

### 2.7 Delegate Token 永久保留

DT 记录在 DynamoDB 中 **不设置 TTL**，即使过期也不会被自动删除。

原因：Ownership 记录以 DT ID 作为 key。如果 DT 被自动删除，将无法追溯"这个 owner 属于哪个用户"，破坏整个 ownership 验证链。

DT 仍有 `expiresAt` 字段用于鉴权——过期的 DT 不能再签发子 Token 或用于认证，但作为历史记录永久存在。DT 的签发频率远低于 AT（一个 DT 可签发成百上千个 AT），全量保留的存储开销极小。

---

## 3. Ownership 模型

### 3.1 设计思想

CASFA 中，Node 的哈希是全局唯一的（内容寻址）。不同用户可能独立上传相同内容的 Node。Ownership 回答的问题是：

> **这个 Node 被谁上传过？**

这不是"谁拥有"（exclusive），而是"谁创建过"（inclusive）——一个 Node 可以有多个 owner。

### 3.2 多 Owner 模型与存储结构

```
           Node X (hash: abc123)
           ┌──────────────────────┐
           │ Owner: dlt1_aaa      │  ← DT-A 的 delegate chain 写入
           │ Owner: usr_abc       │  ← DT-A 的上级 User 也获得 ownership
           │ Owner: dlt1_bbb      │  ← DT-B 的 AT 也上传过
           └──────────────────────┘
```

DynamoDB 存储格式：

```
PK = OWN#{nodeHash}
SK = {delegateTokenId}

示例：
PK = OWN#abc123    SK = dlt1_aaa   → { kind: "file", size: 1024, ... }
PK = OWN#abc123    SK = usr_abc    → { kind: "file", size: 1024, ... }
PK = OWN#abc123    SK = dlt1_bbb   → { kind: "file", size: 1024, ... }
```

这一设计使得：
- **按节点查询所有 owner** → `Query(PK = OWN#{nodeHash})`
- **精确查询某 DT 是否 own** → `GetItem(PK = OWN#{nodeHash}, SK = {dtId})`
- **同一 DT 重复上传同一 Node** → 幂等覆盖（PK + SK 相同）
- **不同 DT 上传同一 Node** → 各自独立记录

### 3.3 Delegate Chain 全链写入

**核心变更**：节点成功创建时，不仅为直接 issuer（父 DT）写入 ownership，而是为 **delegate chain 上的每一个 DT/User** 都写入 ownership 记录。

```
User (usr_abc)
  └── DT-A (dlt1_aaa)
        └── DT-B (dlt1_bbb)
              └── AT-1 上传 Node X

AT-1 的 delegate chain = [usr_abc, dlt1_aaa, dlt1_bbb]

写入 3 条 ownership 记录：
  PK = OWN#{nodeX}  SK = usr_abc    ← User 层
  PK = OWN#{nodeX}  SK = dlt1_aaa   ← DT-A 层
  PK = OWN#{nodeX}  SK = dlt1_bbb   ← DT-B 层（直接 issuer）
```

**为什么全链写入？**

1. **简化查询**：验证 ownership 时只需一次 `GetItem(PK=OWN#{nodeHash}, SK={currentDT})`，无需遍历 family 列表
2. **跨分支引用**：DT-A 的另一个子 DT-C 的 AT 想引用 Node X，因为 `dlt1_aaa` 有 ownership，DT-C 的 delegate chain 中也包含 `dlt1_aaa`，直接通过
3. **成本可控**：delegate chain 最深 16 层（通常 2–4 层），每次上传额外写入几条记录，开销极小

### 3.4 关键查询

| 操作 | 用途 | 实现 |
|------|------|------|
| `hasOwnership(nodeHash, dtId)` | 某个 DT 是否 own 过 | `GetItem(PK=OWN#{nodeHash}, SK={dtId})` |
| `hasAnyOwnership(nodeHash)` | Node 是否存在任何 owner | `Query(PK=OWN#{nodeHash})` + Limit 1 |
| `hasOwnershipByChain(nodeHash, chain)` | delegate chain 中是否任一 own 过 | 对 chain 中每个 ID 执行 `GetItem`（通常 2–4 次） |
| `addOwnershipForChain(nodeHash, chain, ...)` | 为整条 chain 写入 ownership | `BatchWriteItem`（2–4 条 PutItem） |

### 3.5 Ownership 检查简化

旧设计中，验证 ownership 需要构建 `myFamily` 列表并逐一查询。新设计中，因为全链写入，任何一层 DT 都可以直接查自己的 ID：

```
旧: myFamily = [...issuerChain, issuerId]
    for id in myFamily: if hasOwnership(node, id) → pass

新: hasOwnership(nodeHash, currentDT)
    → 一次 GetItem 即可，因为上传时已为整条 chain 写入
```

但跨分支引用场景仍需查询 chain：

```
DT-A (dlt1_aaa) → AT-1 上传 Node X → ownership 写入 [usr_abc, dlt1_aaa]
DT-B (dlt1_bbb) → AT-2 想引用 Node X

AT-2 的 delegate chain = [usr_abc, dlt1_bbb]
查询: hasOwnership(nodeX, usr_abc) → ✓（因为上传时为 usr_abc 也写入了）
```

---

## 4. 认证与授权模型

### 4.1 两阶段验证架构

所有数据 API 调用采用**两阶段验证**，在代码结构上建议提取为两个独立函数：

```
请求进入
  │
  ├── 阶段 1: validateToken()        ← Token 有效性验证
  │     ├── 解码 Authorization Header 中的 Token
  │     ├── 验证 Token 未过期、未撤销
  │     ├── 验证 Realm 匹配
  │     ├── 验证 Token 类型匹配（AT for 数据操作，DT for 转签）
  │     └── 失败 → 401 Unauthorized
  │
  ├── 阶段 2: authorizeRequest()     ← 业务授权验证
  │     ├── 根据 API 语义检查权限标志（canUpload, canManageDepot）
  │     ├── 验证 Token + Proof 是否构成完整授权
  │     └── 失败 → 403 Forbidden
  │
  └── Handler                        ← 执行业务逻辑
```

### 4.2 双 Header 认证机制

数据 API 调用时需要提供两个 Header：

| Header | 用途 | 格式 |
|--------|------|------|
| `Authorization` | 证明调用方对某个 scope DAG 根有访问权限 | `Bearer {access_token_base64}` |
| `X-CAS-Proof` | 证明 Token 的 scope 包含请求中涉及的具体节点 | JSON: `Record<nodeHash, proofWord>` |

**Proof 格式**：

```http
X-CAS-Proof: {"abc123":"ipath#0:1:2","def456":"ipath#0:3"}
```

其中 `proofWord` 格式为 `ipath#<index-path>`：
- `ipath#` 是固定前缀
- `0:1:2` 表示从 Token 的 scope root 到目标节点的导航路径
  - `0` → 选择第几个 scope root（单 scope 时固定为 0）
  - `1` → scope root 的第 1 个 child
  - `2` → 上一步节点的第 2 个 child

**免 proof 规则**：对于当前 Token 的 delegate chain 有 ownership 的节点，**无需提供 proof**。服务端先查 ownership，通过则跳过 proof 验证。

### 4.3 Scope 定义

Scope 定义了一个 Token 可访问的 CAS 子树。它是一个或多个 CAS 节点 hash，代表子树的根：

```
Scope Root: node A
              │
         ┌────┼────┐
         B    C    D         ← Token 可访问 A 以及 A 的所有后代
        / \   │
       E   F  G
```

两种存储形式：

| 形式 | Token 记录字段 | 说明 |
|------|---------------|------|
| **单 Scope** | `scopeNodeHash` | 直接存储一个 CAS 节点 hash（最常见） |
| **多 Scope** | `scopeSetNodeId` | 引用 DynamoDB 中的 ScopeSetNode 记录 |

### 4.4 Proof 验证流程

服务端收到 `X-CAS-Proof` 后的验证流程：

```
对于请求中涉及的每个 nodeHash:
  │
  ├── 1. 检查 ownership
  │     hasOwnershipByChain(nodeHash, delegateChain)
  │     → 通过: 该节点免 proof ✓
  │
  └── 2. 检查 proof（仅当 ownership 检查未通过时）
        ├── 从 X-CAS-Proof 中取出该 nodeHash 的 proofWord
        ├── 解析 "ipath#0:1:2" → indices = [0, 1, 2]
        ├── 从 Token 的 scope root 开始，沿 indices 逐层遍历 CAS DAG
        ├── 检查最终到达的节点 hash 是否 == nodeHash
        └── 匹配 → ✓ 通过 | 不匹配或缺少 proof → ✗ 403
```

示例：

```
Scope Root (hash=AAA)
  ├── [0] child (hash=BBB)
  │     ├── [0] child (hash=DDD)
  │     └── [1] child (hash=EEE)  ← proof "ipath#0:0:1" 到达 EEE
  └── [1] child (hash=CCC)        ← proof "ipath#0:1" 到达 CCC
```

### 4.5 在各 API 中的应用

#### 4.5.1 Node 读取 (GET /nodes/:key)

- **Token**: 验证 AT 有效性
- **Proof**: 必须提供目标节点的 proof（除非有 ownership）
- 失败: 401（Token 无效）或 403（无权访问该节点）

```http
GET /api/realm/{realmId}/nodes/{key}
Authorization: Bearer {access_token_base64}
X-CAS-Proof: {"{key}":"ipath#0:1:2"}
```

#### 4.5.2 Node 上传 (PUT /nodes/:key)

- **Token**: 验证 AT 有效性 + `canUpload`
- **Proof**: 需要为所有 children 提供 proof（除非有 ownership 的 children）
- 上传成功后：为 delegate chain 全链写入 ownership（§3.3）

```http
PUT /api/realm/{realmId}/nodes/{key}
Authorization: Bearer {access_token_base64}
X-CAS-Proof: {"child1_hash":"ipath#0:1:2","child2_hash":"ipath#0:3"}
Content-Type: application/octet-stream

{node_binary_data}
```

服务端解码节点二进制数据，提取所有 child hash，对每个 child 执行 ownership 检查 + proof 验证。只有 ownership 检查未通过的 child 才需要 proof。

#### 4.5.3 FS Rewrite (link 引用)

文件系统 rewrite 操作的 `link` 条目允许引用已有节点。验证逻辑相同：

```json
{
  "entries": {
    "path/to/file": {
      "link": "node:abc123..."
    }
  }
}
```

```http
X-CAS-Proof: {"abc123":"ipath#0:3:1"}
```

1. 先做 ownership 检查（delegate chain 中是否有人 own 过目标节点）
2. 失败则用 Proof header 中的 proof 做 scope 验证
3. 都失败 → `403 LINK_NOT_AUTHORIZED`

#### 4.5.4 Depot Commit

更新 Depot 的 root 时，必须验证新 root 节点的 ownership：

```http
PATCH /api/realm/{realmId}/depots/{depotId}
Authorization: Bearer {access_token_base64}

Body: { "root": "node:abc123..." }
```

验证: delegate chain 中是否有人 own 过 root 节点 → 是 → 允许 commit

> **TODO**: Depot commit 是否也应支持 proof 验证（当 root 节点无 ownership 时）？当前仅要求 ownership。

#### 4.5.5 prepare-nodes 三分类

客户端上传前调用 `POST /nodes/prepare` 确定哪些节点需要上传：

| 分类 | 含义 | 客户端行为 |
|------|------|-----------|
| `missing` | 节点不存在于 CAS 中 | 必须上传 |
| `owned` | 节点存在，且 delegate chain 中的人 own 过 | 不需要上传，可直接引用 |
| `unowned` | 节点存在，但 delegate chain 无 ownership | 需要上传或 claim 以获取 ownership |

客户端需要上传 `missing` 中的节点。对于 `unowned` 节点，可以选择：
- **重新上传**（PUT）—— 获取 ownership，不增加存储空间（幂等）
- **使用 Claim API**（§5）—— 通过 proof-of-possession 获取 ownership，无需传输数据

### 4.6 Scope 在 Token 签发时的收缩

User 签发 DT 时，scope 通过 CAS URI 指定：
- `cas://depot:DEPOT_ID` → 解析为该 Depot 当前的 root hash
- `cas://*` → 该 Realm 下所有 Depot 的 root（通配符）
- `cas://node:HASH` → 直接指定节点 hash

DT 签发子 DT 时，子 scope 必须是父 scope 的子集。用相对路径表示：
- `"."` → 继承父 scope 全部
- `"0:1:2"` → 从父 scope root 的第 0 个 root，沿 index 1、2 导航到的子树

AT 签发时 scope **强制继承**父 DT 的全部 scope，不允许收缩。

这确保了 **scope 只能单调收缩**——子 DT 永远不可能访问父 DT 看不到的数据，AT 完全代理其父 DT 的 scope。

---

## 5. Claim API

### 5.1 动机

当 `prepare-nodes` 返回 `unowned` 节点时，旧方案要求客户端重新上传完整数据以获取 ownership。对于大文件，这浪费带宽。

Claim API 允许客户端通过 **proof-of-possession**（持有证明）获取已有节点的 ownership，证明"我确实拥有这个节点的完整内容"，无需重新传输数据。

### 5.2 端点

```http
POST /api/realm/{realmId}/nodes/{key}/claim
Authorization: Bearer {access_token_base64}
Content-Type: application/json

{
  "pop": "pop:crockford_base32(blake3_128(token | sampling(tokenId, content)))"
}
```

### 5.3 Proof-of-Possession 格式

```
pop:crockford_base32(blake3_128(token | sampling(tokenId, content)))
```

各部分含义：

| 组成 | 说明 |
|------|------|
| `pop:` | 固定前缀，标识 proof-of-possession |
| `token` | 当前使用的 128 字节 Access Token 原始字节 |
| `sampling(tokenId, content)` | 以 `tokenId` 为随机种子，对节点 content 进行 128 字节（1024 位）确定性采样 |
| `blake3_128(...)` | 对 `token \| sampling_result` 计算 Blake3-128 哈希 |
| `crockford_base32(...)` | 将 16 字节哈希编码为 Crockford Base32 |

**安全性**：

- **防重放**：PoP 绑定了具体的 Token 字节，不同 Token 算出的值不同
- **防伪造**：`sampling` 要求持有节点的完整内容，仅知道 hash 无法计算
- **确定性**：相同 token + 相同 content → 相同 PoP，服务端可重新计算验证

> **TODO**: `sampling(tokenId, content)` 函数的精确规范待定义。需要确定：
> - 采样策略（均匀采样、分块采样、或其他）
> - 对小文件（< 128 字节）的处理方式
> - tokenId 作为种子的伪随机数生成算法

### 5.4 服务端验证流程

```
1. 验证 Token 有效性（阶段 1, 失败 → 401）
2. 验证 canUpload 权限（失败 → 403）
3. 检查节点是否存在于 CAS 中（不存在 → 404）
4. 检查 delegate chain 是否已有 ownership（已有 → 200 幂等返回）
5. 从 CAS 读取节点内容
6. 服务端重新计算 sampling(tokenId, content)
7. 服务端计算 blake3_128(token | sampling_result)
8. 与请求中的 PoP 值比较（不匹配 → 403 INVALID_POP）
9. 为 delegate chain 全链写入 ownership 记录（同 §3.3）
10. 返回 200 OK
```

### 5.5 Ownership 写入

Claim 成功后，与 PUT node 一样，为 **delegate chain 上的每一层** 写入 ownership 记录：

```
AT-2 的 delegate chain = [usr_abc, dlt1_aaa, dlt1_bbb]

Claim Node X 成功 → 写入：
  PK = OWN#{nodeX}  SK = usr_abc
  PK = OWN#{nodeX}  SK = dlt1_aaa
  PK = OWN#{nodeX}  SK = dlt1_bbb
```

### 5.6 与 PUT 的对比

| | PUT（重传） | Claim |
|---|---|---|
| **数据传输** | 需要传输完整节点数据 | 仅传输 PoP 值（~40 字节） |
| **适用场景** | 节点不存在（`missing`） | 节点已存在但无 ownership（`unowned`） |
| **验证方式** | hash 校验（内容 = 声明的 key） | PoP 校验（证明持有完整内容） |
| **Ownership 写入** | 全链写入 | 全链写入（相同） |
| **对 `missing` 节点** | ✓ 有效 | ✗ 不可用（404） |

> **TODO**: Claim API 的频率限制和防滥用策略待定义。考虑：
> - 单 Token 的 claim 频率上限
> - 单节点被 claim 的频率上限
> - 是否需要增加延迟或工作量证明（PoW）

---

## 6. 资源操作权限矩阵

### 6.1 认证类型

| 操作类型 | 需要的认证 |
|---------|-----------|
| OAuth 登录/注册 | 无 |
| 管理员操作 | JWT + Admin 角色 |
| Token 管理（创建/列表/撤销 DT） | JWT（User Token） |
| Token 转签发（DT → 子 DT/AT） | Delegate Token |
| 所有 Realm 数据操作 | Access Token |

### 6.2 Access Token 操作权限

| 操作 | `canUpload` | `canManageDepot` | 需要 Proof | 其他检查 |
|------|:-:|:-:|:-:|------|
| **Node 读取** (`GET /nodes/:key`) | | | ✓ | |
| **Node 元数据** (`GET /nodes/:key/metadata`) | | | ✓ | |
| **Node 上传** (`PUT /nodes/:key`) | ✓ | | children proof | hash 校验 |
| **Node Claim** (`POST /nodes/:key/claim`) | ✓ | | | PoP 校验 |
| **Node 准备** (`POST /nodes/prepare`) | | | | 返回三分类 |
| **FS 读** (stat, read, ls) | | | ✓ | |
| **FS 写** (write) | ✓ | | | |
| **FS mkdir** | ✓ | | | |
| **FS rm/mv/cp** | ✓ | | | |
| **FS rewrite** | ✓ | | link proof | |
| **Depot 列表/查看** | | | | |
| **Depot 创建/删除** | | ✓ | | |
| **Depot Commit** | | ✓ | | root ownership |
| **Ticket 创建** | ✓ | | | 绑定当前 AT |
| **Ticket 提交** | | | | root hash |
| **Ticket 查看/撤销** | | | | issuerChain 可见性 |

> **TODO**: FS 读操作的 proof 验证细节待确认。当前 FS 操作通过 depot 上下文隐式验证 scope，是否需要显式 proof？

### 6.3 鉴权中间件栈

```
请求进入
  │
  ├─── validateToken() [阶段 1 → 401]
  │      ├── 提取 Authorization Header
  │      ├── 解码 Token（128 字节二进制）
  │      ├── 计算 tokenId，查 DynamoDB 记录
  │      ├── 检查: 未过期、未撤销、realm 匹配
  │      ├── 检查: Token 类型匹配（AT for 数据操作）
  │      └── 设置 AuthContext（含 tokenRecord, delegateChain）
  │
  ├─── authorizeRequest() [阶段 2 → 403]
  │      ├── 检查权限标志（canUpload / canManageDepot）
  │      ├── 解析 X-CAS-Proof Header
  │      ├── 对请求涉及的每个节点:
  │      │     ├── ownership 检查（delegateChain 中任一 ID）
  │      │     └── 若无 ownership → proof 验证（ipath 遍历 DAG）
  │      └── 所有节点验证通过 → 继续
  │
  ├─── zValidator         ← Zod schema 验证请求体
  │
  └─── Handler            ← 执行业务逻辑
```

---

## 7. 端到端流程示例

### 7.1 Agent 上传文件树

```
1. User 登录 → 获取 JWT (User Token)

2. User 用 JWT 签发 DT-A (canUpload=true, scope=Depot-1)
   → 将 DT-A 的 128 字节 base64 交给 Agent

3. Agent 用 DT-A 签发 AT-1 (scope=Depot-1, quota=继承, TTL=1h)
   → AT-1 完全代理 DT-A 的数据访问能力

4. Agent 准备上传，先调用 prepare-nodes
   POST /nodes/prepare { keys: [A, B, C, D] }
   → { missing: [A, B], owned: [], unowned: [C, D] }

5. Agent 上传叶子节点（无 children）
   PUT /nodes/A  → ownership 写入 delegate chain: [usr_abc, dlt1_aaa]
   PUT /nodes/B  → ownership 写入 delegate chain: [usr_abc, dlt1_aaa]

6. Agent 对 unowned 节点选择 claim 或重传
   POST /nodes/C/claim { pop: "pop:..." }  → ownership 写入 [usr_abc, dlt1_aaa]
   POST /nodes/D/claim { pop: "pop:..." }  → ownership 写入 [usr_abc, dlt1_aaa]

7. Agent 上传父节点（含 children = [A, B, C, D]）
   PUT /nodes/E  (children: [A, B, C, D])
   → 服务端检查每个 child:
     A → hasOwnership(A, dlt1_aaa) → ✓ (免 proof)
     B → hasOwnership(B, dlt1_aaa) → ✓ (免 proof)
     C → hasOwnership(C, dlt1_aaa) → ✓ (免 proof, claim 后有 ownership)
     D → hasOwnership(D, dlt1_aaa) → ✓ (免 proof)
   → 上传成功，ownership 写入 [usr_abc, dlt1_aaa]

8. Agent 提交 Depot
   PATCH /depots/Depot-1 { root: "node:E..." }
   → 检查: hasOwnership(E, dlt1_aaa) → ✓ → commit 成功
```

### 7.2 跨 DT 分支引用（自动通过 ownership）

```
User (usr_abc)
  ├── DT-A (dlt1_aaa) → AT-1 上传了 Node X
  │     ownership 写入: [usr_abc, dlt1_aaa]
  └── DT-B (dlt1_bbb) → AT-2 想引用 Node X

AT-2 的 delegate chain = [usr_abc, dlt1_bbb]

检查: hasOwnership(nodeX, usr_abc) → ✓
    （因为上传时为 usr_abc 也写入了 ownership）

→ 无需 proof，直接引用成功
```

### 7.3 跨用户引用（需要 Proof）

```
User-A (usr_aaa) → DT-A → AT-1 上传了 Node X
  ownership: [usr_aaa, dlt1_aaa]

User-B (usr_bbb) → DT-B → AT-2 想引用 Node X
  delegate chain: [usr_bbb, dlt1_bbb]

检查: hasOwnershipByChain(nodeX, [usr_bbb, dlt1_bbb])
  → usr_bbb? ✗  dlt1_bbb? ✗  → ownership 检查失败

AT-2 提供 proof:
  X-CAS-Proof: {"nodeX_hash":"ipath#0:3:1"}

验证: AT-2 的 scope root → child[3] → child[1] → 结果 == Node X → ✓

引用成功
```

### 7.4 Claim 流程

```
1. Agent 调用 prepare-nodes
   POST /nodes/prepare { keys: [X, Y, Z] }
   → { missing: [], owned: [X], unowned: [Y, Z] }

2. Agent 对 unowned 节点执行 claim（无需下载内容，Agent 本地已有）
   POST /nodes/Y/claim
   Body: { pop: "pop:5DWHV3KRMEZ9Y0NJ2BG1Q4AXPT" }
   → 服务端:
     a. 从 CAS 读取 Y 的内容
     b. 计算 sampling(tokenId, content)
     c. 计算 blake3_128(token | sampling_result)
     d. 与提交的 PoP 比较 → 匹配 ✓
     e. 写入 ownership: [usr_abc, dlt1_aaa]
   → 200 OK

3. POST /nodes/Z/claim { pop: "pop:..." } → 200 OK

4. 所有节点现在都有 ownership，可直接引用
```

### 7.5 Ticket 协作流程

```
1. Agent 用 AT-1 (canUpload) 创建 Ticket
   POST /tickets { title: "Code Review Task" }
   → 服务端自动绑定 AT-1 的 tokenId

2. Tool 用 AT-1 上传工作结果到 CAS

3. Tool 用 AT-1 提交 Ticket
   POST /tickets/{id}/submit { root: "node:abc..." }

4. 上游 Agent 用 AT-0 (delegate chain 包含 AT-1 的 issuer DT) 查看 Ticket
   → issuerChain 可见性检查 ✓

5. Agent 用 AT-0 commit 到 Depot
```

---

## 8. 安全性设计小结

### 8.1 设计原则

| 原则 | 实现 |
|------|------|
| **三层分离** | User 管身份，DT 管授权，AT 管执行——职责不可兼任 |
| **AT 完全代理** | AT 的 scope/quota 与 DT 强制一致，是 DT 的短期执行手柄 |
| **能力衰减** | DT → 子 DT 权限单调递减；DT → AT 仅收紧 TTL |
| **全链 Ownership** | 上传时为 delegate chain 每一层写入，简化跨分支查询 |
| **双 Header 授权** | Token 证明 scope 访问权，Proof 证明具体节点的访问权 |
| **零信任引用** | 每个 child 引用都单独验证 ownership 或 proof |
| **PoP 防伪造** | Claim 要求证明持有完整内容，binding token 防重放 |

### 8.2 防御的攻击场景

| 攻击 | 防御 |
|------|------|
| **跨用户节点挂载**：构造 dict 引用他人节点 | ownership 检查 + proof 验证双重防线 |
| **proof 伪造**：随意填写 proof 绕过验证 | proof 实际遍历 CAS DAG，伪造的 index-path 无法到达目标 |
| **hash 猜测**：知道 hash 就引用 | prepare-nodes 返回 `unowned`，claim 需要 PoP（完整内容），PUT 需要完整数据 |
| **Claim PoP 伪造**：不持有内容尝试 claim | sampling 要求完整内容 + token 绑定，无法仅凭 hash 计算 |
| **Claim PoP 重放**：截获 PoP 在其他 Token 上使用 | PoP 包含 token 字节的 hash，不同 Token 算出的值不同 |
| **过期 Token 残留访问** | validateToken 检查 expiresAt + isRevoked，级联撤销所有后代 |
| **scope 逃逸** | DT→子DT scope 单调收缩，AT scope 强制继承，proof 逐层验证 |
| **Depot 根篡改** | commit 时验证 root 节点的 ownership |

### 8.3 数据模型一览

```
DynamoDB 单表设计（主要实体）:

Token 记录:
  PK = TOKEN#{tokenId}        SK = METADATA
  字段: tokenType, realm, expiresAt, depth, issuerId, issuerChain,
        canUpload, canManageDepot, scopeNodeHash, isRevoked, ...
  GSI1: REALM#{realm}         → TOKEN#{tokenId}
  GSI2: ISSUER#{issuerId}     → TOKEN#{tokenId}

Ownership 记录:
  PK = OWN#{nodeHash}         SK = {delegateTokenId}
  字段: kind, size, contentType, createdAt

Depot 记录:
  PK = REALM#{realm}          SK = DEPOT#{depotId}

Ticket 记录:
  PK = REALM#{realm}          SK = TICKET#{ticketId}

ScopeSetNode 记录:
  PK = SETNODE#{setNodeId}    SK = METADATA
  字段: children (有序 scope root hash 列表), refCount

RefCount 记录:
  PK = REALM#{realm}          SK = REF#{nodeHash}
```

### 8.4 关键不变量

1. **三层不可越级**：User 不能直接签发 AT，AT 不能签发任何 Token
2. **AT ≡ DT (scope/quota)**：AT 的 scope 和 quota 与父 DT 完全一致，签发时强制保证
3. **Token 链不可逆**：子 Token 永远无法获得比父 Token 更多的权限
4. **全链 Ownership**：上传/claim 时为 delegate chain 每一层写入 ownership，不可伪造
5. **Scope 不可扩展**：delegation 只能收缩 scope，AT 强制继承 DT scope
6. **引用必须授权**：PUT children、rewrite link、depot commit 都必须通过 ownership 或 proof
7. **DT 永久存在**：Ownership 追溯链永远不会断裂
8. **PoP 不可伪造**：Claim 需要完整内容 + token 绑定，防伪造防重放
