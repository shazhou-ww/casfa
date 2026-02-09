# CASFA 数据所有权与权限体系

> 版本: 3.4
> 日期: 2026-02-09
> 基于: Delegate 实体化 + ownership 全链写入 + Keyed Blake3 PoP + Node-based FS auth

---

## 目录

1. [概述](#1-概述)
2. [Delegate 模型](#2-delegate-模型)
3. [Token 与认证](#3-token-与认证)
4. [Ownership 模型](#4-ownership-模型)
5. [认证与授权模型](#5-认证与授权模型)
6. [Claim API](#6-claim-api)
7. [资源操作权限矩阵](#7-资源操作权限矩阵)
8. [端到端流程示例](#8-端到端流程示例)
9. [安全性设计小结](#9-安全性设计小结)
10. [错误码定义](#10-错误码定义)

---

## 1. 概述

CASFA（Content-Addressable Storage for Agents）是一个内容寻址存储系统。数据以 **CAS 节点**（Node）的形式存储，每个节点通过其内容的 Blake3 哈希值唯一标识。节点之间通过 hash 引用形成 DAG（有向无环图）结构。

系统面临的核心安全问题：

> **谁拥有这个节点？谁被允许引用它？谁可以读取它？**

本文档完整描述 CASFA 的 **数据所有权**（Ownership）和 **权限体系**（Permissions），涵盖 Delegate 树、双 Token 认证、Ownership 向下继承、Claim 机制四大模块。

### 1.1 核心原语

| 概念 | 说明 |
|------|------|
| **User** | 系统中的人类用户，通过 OAuth 登录获取 JWT |
| **Delegate** | 一等业务实体，权限分发的最小单位，组成 immutable 的委托树；可设有效期 |
| **Delegate Chain** | 从 root delegate 到某个 delegate 的完整路径，用于 revoke 验证和 ownership 继承 |
| **Refresh Token** | Delegate 的一次性凭证，永久有效，用于**同时**换取新 Access Token + 新 Refresh Token |
| **Access Token** | 统一访问凭证，短期有效，用于所有数据操作**和**分配子 delegate |
| **Realm** | 数据隔离域，当前等价于 User ID |
| **Node** | CAS 中的最小存储单元，通过内容 hash 标识 |
| **Ownership** | 记录"谁上传了这个 Node"，写入执行 delegate 的整条 chain（全链写入），查询 O(1) |
| **Scope** | 一棵 CAS 子树，定义 Delegate 可访问的数据范围；Root Delegate 无 scope 限制 |
| **Proof** | 证明某节点在 scope 内的 index-path 路径，也可以 depot 的特定版本为根 |
| **Claim** | 通过 proof-of-possession 获取已有节点的 ownership，无需重传 |
| **Depot** | 带版本历史的根引用，类似 Git 分支 |

---

## 2. Delegate 模型

### 2.1 Delegate 是一等业务实体

**Delegate 不是 Token，而是一个持久化的业务实体**。它代表一个授权节点——可以是一个 Agent、一个工具、一个子任务——拥有明确的权限边界和数据所有权。

Delegate 与 Token 的本质区别：

| | Delegate（实体） | Token（凭证） |
|---|---|---|
| **生命周期** | 永久存储，不可删除；可设有效期（过期视为自动 revoke） | 有过期时间，用后即弃 |
| **身份** | 是 ownership 的主体 | 是 delegate 的"代言人" |
| **关系** | 组成 immutable 的树结构 | 绑定到某个 delegate |
| **状态** | 可被 revoke 或过期（吊销权限） | 无状态（有效或无效） |

### 2.2 Delegate Tree

每个用户账号绑定一个固定的 **Root Delegate**，作为整个 delegate tree 的起点。用户可通过 `/api/me` 接口查询自己的 root delegate。

```
User (usr_abc)
  │
  └── Root Delegate (dlg_root)           ← 用户固定绑定，不可更改
        │
        ├── Delegate-A (dlg_aaa)         ← 分配给 Agent-A
        │     ├── Delegate-A1 (dlg_a1)   ← Agent-A 分配给子工具
        │     └── Delegate-A2 (dlg_a2)   ← Agent-A 分配给另一个子工具
        │
        └── Delegate-B (dlg_bbb)         ← 分配给 Agent-B
              └── Delegate-B1 (dlg_b1)   ← Agent-B 分配给子任务
```

**关键特性**：

- **Immutable**：delegate 一旦创建，其位置、父子关系不可修改
- **不可删除**：delegate 与 ownership 深度关联，删除会破坏 ownership 追溯
- **可设有效期**：delegate 可以设置 `expiresAt`，过期后视为自动 revoke
- **可吊销**：任何祖先 delegate 都可以 revoke 子孙 delegate 的权限（参见 §2.5）
- **深度限制**：最多 16 层（depth 0–15），通常 2–4 层

### 2.3 Delegate 的权限维度

每个 delegate 在创建时由父 delegate 分配权限，**一次分配不可修改**：

| 维度 | 说明 | 规则 |
|------|------|------|
| **name** | 可选的显示名称 | 任意字符串，用于标识用途（如 "Agent-A"） |
| **Realm** | 数据隔离域 | 继承父 delegate |
| **canUpload** | 是否可写入新 Node | ≤ 父 delegate |
| **canManageDepot** | 是否可管理 Depot（详见下方） | ≤ 父 delegate |
| **Scope** | 可访问的 CAS 子树范围 | ⊆ 父 delegate |
| **expiresAt** | 可选的有效期（epoch ms） | ≤ 父 delegate 的剩余有效期 |
| **delegatedDepots** | 父 delegate 显式委派的 Depot 列表（可选） | 创建时由父 delegate 指定，不可变 |
| **Depth** | 在 delegate tree 中的层级 | = 父 depth + 1 |

**Root Delegate 的特殊地位**：Root delegate **无 scope 限制**，拥有用户 realm 下的一切权限——所有 Depot、所有节点、所有操作。Root delegate 不设有效期，其生命周期与用户账号一致。

#### canManageDepot 的作用范围

`canManageDepot` 权限不是全局的，每个 delegate 只能管理以下范围内的 Depot：

1. **自己创建的 Depot**（隐式权限，无需显式指定）
2. **自己的子孙 delegate 创建的 Depot**（隐式权限，无需显式指定）
3. **父 delegate 显式委派的 Depot**（`delegatedDepots` 列表）

> **`delegatedDepots` vs 自建 Depot 的区别**：`delegatedDepots` 是父 delegate 在创建子 delegate 时显式委派的列表，代表“父节点授权你管理这些 Depot”。它是 immutable 的——创建后不可修改，也不会因为后续创建新 Depot 而自动扩展。自己和子孙创建的 Depot 则是动态的、隐式获得的权限，不存储在 delegate 记录中。

管理 Depot 的权限**包括访问该 Depot 所有历史版本数据的权限**——不仅是当前版本，也包括任何历史提交的 root 节点及其子树。

### 2.4 Delegate Chain

Delegate Chain 是从 root delegate 到某个 delegate 的完整路径，是 ownership 体系的核心：

```
Root (dlg_root)
  └── Delegate-A (dlg_aaa)
        └── Delegate-B (dlg_bbb)

Delegate-B 的 delegate chain = [dlg_root, dlg_aaa, dlg_bbb]
```

Delegate chain 存储在 delegate 记录的 `chain` 字段中，创建时预计算：

```
child.chain = [...parent.chain, child.delegateId]
```

Delegate chain 被用于：

- **Revoke 验证**：验证 delegate 有效性时，检查 chain 上**每个节点**都未被 revoke 或过期
- **Ownership 继承**：子孙 delegate own 的节点，祖先 delegate 也视为 own（向上继承）
- **权限溯源**：追溯 delegate 的完整授权路径

### 2.5 Delegate 的 Revoke（吊销）与过期

任何**祖先 delegate** 都可以 **revoke** 子孙 delegate 的权限（不限于直接父级）。Revoke 是不可逆的——被 revoke 的 delegate 不能恢复，只能重新分配新的 delegate。

Delegate 也可以设置有效期（`expiresAt`）。**过期等同于自动 revoke**——过期的 delegate 在验证时与被 revoke 的 delegate 行为完全一致。

```
Delegate-A (dlg_aaa)
  ├── Delegate-A1 (dlg_a1)  ── 被 revoke ✗
  │     └── Delegate-A1a (dlg_a1a)  ── 祖先被 revoke，隐式失效 ✗
  └── Delegate-A2 (dlg_a2)  ── 正常 ✓
```

**Revoke 规则**：

1. **祖先 delegate 均可 revoke**：通过祖先 delegate 的 access token 操作，不限于直接父级
2. **无级联写入**：revoke 只标记目标 delegate 自身，**不递归展开子树做级联标记**
3. **验证时级联生效**：API 调用时检查 delegate chain 上的**每个节点**——任一节点被 revoke 或过期，则整条 chain 失效
4. **不可撤销**：revoke 是永久的，被 revoke 的 delegate 无法恢复
5. **不删除实体**：revoke 只是标记状态，delegate 记录永久保留（因为 ownership 依赖它）
6. **新替代旧**：如需恢复能力，在同一父 delegate 下创建新的子 delegate

**Revoke / 过期不影响已有 ownership**——被 revoke 或过期的 delegate 过去上传的节点，其 ownership 记录仍然有效。Revoke 只阻止该 delegate 执行新的操作。

**过期 vs Revoke 的区别**：

| | 过期 | Revoke |
|---|---|---|
| **触发方式** | 自动（到达 expiresAt） | 手动（祖先 delegate 调 API） |
| **可预知性** | 创建时已确定 | 随时可能发生 |
| **效果** | 等同 revoke | 标记 isRevoked |
| **可逆性** | 不可逆 | 不可逆 |

### 2.6 Delegate 的数据模型

```
DynamoDB:

Delegate 记录:
  PK = REALM#{realm}          SK = DLG#{delegateId}
  字段:
    delegateId: string        // dlg_xxx 格式
    name?: string             // 可选的显示名称
    realm: string
    parentId: string          // 父 delegate ID
    chain: string[]           // 完整 delegate chain（含自身）
    depth: number             // 0–15
    canUpload: boolean
    canManageDepot: boolean
    managedDepots?: string[]  // 父 delegate 显式委派的 Depot ID 列表（可选，immutable）
    scopeNodeHash?: string    // Root Delegate 此字段为空（无 scope 限制）
    scopeSetNodeId?: string
    expiresAt?: number        // 可选的有效期（epoch ms），过期视为自动 revoke
    isRevoked: boolean
    revokedAt?: number
    revokedBy?: string        // 执行 revoke 的 delegate ID（可以是任意祖先）
    createdAt: number

  GSI: PARENT#{parentId} → DLG#{delegateId}  // 查询子 delegate
```

### 2.7 Delegate 的 API

| 端点 | 认证 | 说明 |
|------|------|------|
| `GET /api/me` | JWT | 返回用户信息及 root delegate |
| `POST /api/realm/{realmId}/delegates` | Access Token | 在当前 delegate 下创建子 delegate，返回子 delegate 的 refresh token + access token |
| `GET /api/realm/{realmId}/delegates` | Access Token | 列出当前 delegate 的**所有子孙** delegate |
| `GET /api/realm/{realmId}/delegates/{id}` | Access Token | 查看子孙 delegate 详情（目标必须在当前 delegate 的子树内） |
| `POST /api/realm/{realmId}/delegates/{id}/revoke` | Access Token | Revoke 子孙 delegate（目标必须在当前 delegate 的子树内） |

> 所有 delegate 管理 API 都使用 **Access Token** 认证——Access Token 是统一的 API 访问凭证，不仅用于数据操作，也用于分配和管理子 delegate。

---

## 3. Token 与认证

### 3.1 双 Token 架构

每个 Delegate 通过两种 Token 来使用：

```
Delegate (dlg_aaa)
  │
  ├── Refresh Token (永久有效，一次性使用)
  │     └── 使用一次 → 同时返回新 Refresh Token + 新 Access Token
  │
  └── 权限和 scope 与 Delegate 完全一致
```

| Token 类型 | 有效期 | 使用次数 | 用途 |
|-----------|--------|---------|------|
| **Refresh Token** | 永久 | **一次性** | 换取**新的 Access Token + 新的 Refresh Token**（同时返回，确保无限续期） |
| **Access Token** | 短期（如 1h） | 多次 | 调用所有数据 API + 分配子 delegate |

### 3.2 Refresh Token — 一次性凭证

Refresh Token 是 Delegate 的**持久凭证**，但设计为一次性使用：

- 每次使用 Refresh Token 换取 Access Token 时，同时返回一个**新的 Refresh Token**
- 旧 Refresh Token 立即失效
- 这实现了 **Token Rotation**——如果 Refresh Token 被窃取，合法使用者下次刷新时会发现 Token 已失效，从而检测到泄露

```
初始: Delegate 创建 → 返回 RT-1 + AT-1

使用: RT-1 → 换取 AT-2 + RT-2（RT-1 作废）
使用: RT-2 → 换取 AT-3 + RT-3（RT-2 作废）
...
```

### 3.3 Access Token — 统一执行凭证

Access Token 是 **所有 API 的统一访问凭证**——不仅用于数据操作，也用于 delegate 管理：

- **权限等于 Delegate**：scope、canUpload、canManageDepot 完全继承
- **短期有效**：通常 1 小时，最长不超过配置上限
- **绑定 Delegate**：每个 AT 关联到一个 delegate，API 调用时代表该 delegate 的身份

**AT 可以执行的操作**：
- 所有数据操作（Node 读写、FS 操作、Depot 管理）
- 创建子 delegate（分配权限给下级 Agent/工具）
- 查看和 revoke 子孙 delegate

### 3.4 Token 二进制格式

所有 Token 共享统一的 128 字节二进制格式：

| 偏移 | 大小 | 字段 | 说明 |
|------|------|------|------|
| 0 | 4B | Magic | `0x01544C44` ("DLT\x01") |
| 4 | 4B | Flags | 位标志（token 类型、权限等） |
| 8 | 8B | TTL | 过期时间（epoch ms），Refresh Token 为 0（永不过期） |
| 16 | 8B | Quota | 写入配额（保留字段） |
| 24 | 8B | Salt | 随机数 |
| 32 | 32B | Issuer | Delegate ID（left-padded to 32B） |
| 64 | 32B | Realm | Realm ID hash |
| 96 | 32B | Scope | Scope hash（left-padded to 32B） |

**Flags 位标志**：

| 位 | 名称 | 含义 |
|----|------|------|
| 0 | `is_refresh` | 1=Refresh Token, 0=Access Token |
| 1 | `can_upload` | 上传权限 |
| 2 | `can_manage_depot` | Depot 管理权限 |
| 3–6 | `depth` | delegate 深度 (0–15) |
| 7 | reserved | 保留 |

> **注意**：Token 中不包含 `is_root` 标志。Root delegate 的判断由服务端查询 delegate 记录决定（`depth == 0 && parentId == null`），不依赖 Token 中的任何标志位。这避免了客户端伪造 `is_root` 标志的安全风险。

**Token ID**: `dlt1_{crockford_base32(blake3_128(token_bytes))}`

#### Flags 组合示例

| 场景 | is_refresh | can_upload | can_manage_depot | depth | Flags (binary) | Flags (hex) |
|--------|:-:|:-:|:-:|:-:|:-:|:-:|
| Root delegate 的 AT | 0 | 1 | 1 | 0000 | `0b_0000_0110` | `0x06` |
| Root delegate 的 RT | 1 | 1 | 1 | 0000 | `0b_0000_0111` | `0x07` |
| 子 delegate AT（可上传，可管理 depot，depth=2） | 0 | 1 | 1 | 0010 | `0b_0010_0110` | `0x26` |
| 子 delegate AT（只读，depth=1） | 0 | 0 | 0 | 0001 | `0b_0001_0000` | `0x10` |
| 工具 AT（可上传，无 depot，depth=3） | 0 | 1 | 0 | 0011 | `0b_0011_0010` | `0x32` |

#### Issuer 字段编码

`Issuer` 字段为 32 字节，存储 delegate ID。编码规则：

- Delegate ID 格式为 UUID v7（16 字节原始值）
- **Left-padded to 32B**：前 16 字节填充 0x00，后 16 字节存储 UUID 原始字节
- Root delegate 和非 root delegate 编码方式相同（无特殊处理）

```
Issuer (32B):
  [00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00   <- padding (16B)
   xx xx xx xx xx xx xx xx xx xx xx xx xx xx xx xx]  <- UUID bytes (16B)
```

#### Scope 字段编码

- **Root Delegate**：全零（32 字节 0x00），表示无 scope 限制
- **单 Scope**：`blake3_256(scope_root_hash)` left-padded to 32B
- **多 Scope**：`blake3_256(scope_set_node_id)` left-padded to 32B

#### 编码/解码示例

```typescript
import { blake3_128, blake3_256 } from "@casfa/core";
import { crockfordBase32Encode } from "@casfa/core/encoding";

const TOKEN_SIZE = 128;
const MAGIC = 0x01544c44; // "DLT\x01"

interface TokenFields {
  isRefresh: boolean;
  canUpload: boolean;
  canManageDepot: boolean;
  depth: number;        // 0–15
  ttl: bigint;          // epoch ms, 0 for RT
  quota: bigint;        // reserved
  salt: bigint;         // random
  issuer: Uint8Array;   // 16B UUID
  realm: Uint8Array;    // 32B hash
  scope: Uint8Array;    // 32B hash (all zeros for root)
}

function encodeToken(fields: TokenFields): Uint8Array {
  const buf = new ArrayBuffer(TOKEN_SIZE);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  // Magic (4B)
  view.setUint32(0, MAGIC);

  // Flags (4B) — bit 0: is_refresh, bit 1: can_upload, bit 2: can_manage_depot, bits 3-6: depth
  let flags = 0;
  if (fields.isRefresh)    flags |= (1 << 0);
  if (fields.canUpload)    flags |= (1 << 1);
  if (fields.canManageDepot) flags |= (1 << 2);
  flags |= ((fields.depth & 0x0f) << 3);
  view.setUint32(4, flags);

  // TTL (8B)
  view.setBigUint64(8, fields.ttl);
  // Quota (8B)
  view.setBigUint64(16, fields.quota);
  // Salt (8B)
  view.setBigUint64(24, fields.salt);

  // Issuer (32B) — left-padded: 16B zeros + 16B UUID
  bytes.set(fields.issuer, 32 + 16);

  // Realm (32B)
  bytes.set(fields.realm, 64);

  // Scope (32B)
  bytes.set(fields.scope, 96);

  return bytes;
}

function decodeToken(bytes: Uint8Array): TokenFields {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const magic = view.getUint32(0);
  if (magic !== MAGIC) throw new Error("Invalid token magic");

  const flags = view.getUint32(4);

  return {
    isRefresh:      (flags & (1 << 0)) !== 0,
    canUpload:      (flags & (1 << 1)) !== 0,
    canManageDepot: (flags & (1 << 2)) !== 0,
    depth:          (flags >> 3) & 0x0f,
    ttl:   view.getBigUint64(8),
    quota: view.getBigUint64(16),
    salt:  view.getBigUint64(24),
    issuer: bytes.slice(32 + 16, 64),  // skip 16B padding
    realm:  bytes.slice(64, 96),
    scope:  bytes.slice(96, 128),
  };
}

function computeTokenId(tokenBytes: Uint8Array): string {
  const hash = blake3_128(tokenBytes);
  return `dlt1_${crockfordBase32Encode(hash)}`;
}
```

### 3.5 Token 刷新流程

```http
POST /api/tokens/refresh
Authorization: Bearer {refresh_token_base64}

Response:
{
  "accessToken": "base64...",    // 新的 Access Token
  "refreshToken": "base64...",   // 新的 Refresh Token（旧的已失效）
  "expiresAt": 1738000000000
}
```

### 3.6 Delegate 创建时的 Token 分发

父 delegate 通过 **Access Token** 创建子 delegate 时，同时返回子 delegate 的初始凭证：

```http
POST /api/realm/{realmId}/delegates
Authorization: Bearer {parent_access_token}

Body: {
  "name": "Agent-A",            // 可选的显示名称
  "canUpload": true,
  "canManageDepot": true,
  "delegatedDepots": ["depot_1"],  // 可选：父 delegate 委派的 Depot
  "scope": ".",                  // 继承父 delegate 的 scope
  "expiresAt": 1738100000000     // 可选：有效期
}

Response: {
  "delegate": { "id": "dlg_xxx", "name": "Agent-A", ... },
  "refreshToken": "base64...",  // 子 delegate 的 Refresh Token
  "accessToken": "base64..."    // 子 delegate 的 Access Token
}
```

> **典型场景**：给工具分配 delegate 时，通常只传递 Access Token（不传 Refresh Token），因为工具是短期任务，无需续期。给长期运行的 Agent 则传递 Refresh Token + Access Token，Agent 可自行续期。

### 3.7 Root Delegate 的 Token

Root delegate 的权限绑定用户登录态。用户通过 JWT 操作 root delegate：

```http
POST /api/tokens/root
Authorization: Bearer {jwt}

Response: {
  "delegate": { "id": "dlg_root_xxx", ... },
  "refreshToken": "base64...",
  "accessToken": "base64..."
}
```

首次调用时创建 root delegate；后续调用返回已有 root delegate 的新 token 对。

---

## 4. Ownership 模型

### 4.1 设计思想

CASFA 中，Node 的哈希是全局唯一的（内容寻址）。不同用户可能独立上传相同内容的 Node。Ownership 回答的问题是：

> **这个 Node 被谁上传过？**

这不是"谁拥有"（exclusive），而是"谁创建过"（inclusive）——一个 Node 可以有多个 owner。**Owner 的主体是 Delegate，不是 Token。**

### 4.2 Ownership 方向：子孙 own = 自己 own（全链写入）

Ownership 在写入时**展开整条 delegate chain**——上传 Node 时，为 chain 上的每个 delegate 都写入一条 ownership 记录。查询时直接 `GetItem`，**O(1) 命中**。

> **如果子孙 delegate own 了某个节点，则祖先 delegate 也视为 own 了该节点。**
> 
> **反之不成立：祖先 delegate own 了某个节点，不等于子孙 delegate own 了该节点。**

这是因为：子孙代表的是祖先分配出去执行的任务，子孙完成的工作自然属于祖先。但祖先拥有的数据不应自动对所有子孙可见——子孙需要通过 scope + proof 来访问。

```
Root (dlg_root)
  ├── Delegate-A (dlg_aaa)
  │     └── Delegate-A1 (dlg_a1) → 上传 Node X
  └── Delegate-B (dlg_bbb)

dlg_a1 的 chain = [dlg_root, dlg_aaa, dlg_a1]

写入 3 条 ownership 记录（全链写入）:
  PK=OWN#nodeX  SK=dlg_root   → { uploadedBy: "dlg_a1", ... }
  PK=OWN#nodeX  SK=dlg_aaa    → { uploadedBy: "dlg_a1", ... }
  PK=OWN#nodeX  SK=dlg_a1     → { uploadedBy: "dlg_a1", ... }

查询 ownership（O(1) GetItem）:
  dlg_a1   → GetItem(OWN#nodeX, dlg_a1)  → 命中 ✓
  dlg_aaa  → GetItem(OWN#nodeX, dlg_aaa) → 命中 ✓
  dlg_root → GetItem(OWN#nodeX, dlg_root) → 命中 ✓
  dlg_bbb  → GetItem(OWN#nodeX, dlg_bbb) → 未命中 ✗
```

### 4.3 存储结构

```
PK = OWN#{nodeHash}
SK = {delegateId}          ← chain 上的每个 delegate 各一条记录

字段:
  uploadedBy: string       ← 实际执行上传的 delegate ID（用于审计追溯）
  kind: string             ← 节点类型
  size: number             ← 节点大小
  contentType?: string
  createdAt: number

示例（dlg_a1 上传 Node abc123，chain=[dlg_root, dlg_aaa, dlg_a1]）:
  PK = OWN#abc123    SK = dlg_root  → { uploadedBy: "dlg_a1", kind: "file", size: 1024 }
  PK = OWN#abc123    SK = dlg_aaa   → { uploadedBy: "dlg_a1", kind: "file", size: 1024 }
  PK = OWN#abc123    SK = dlg_a1    → { uploadedBy: "dlg_a1", kind: "file", size: 1024 }
```

**写入规则**：

- **全链写入**：每次上传写入 N 条记录（N = chain 深度，通常 2–4 条）
- 使用 `BatchWriteItem` 一次写入全部记录（DynamoDB 限制 25 条/批，chain 最深 16 层，完全够用）
- 同一节点被不同 delegate 上传时，各自独立写入各自的 chain
- 同一 delegate 重复上传同一 Node → 幂等覆盖
- `uploadedBy` 字段记录实际执行者，用于审计（所有记录的 `uploadedBy` 相同）

### 4.4 Ownership 查询：O(1) GetItem

由于写入时已展开全链，查询变为简单的单条 `GetItem`：

```
hasOwnership(nodeHash, delegateId):
  result = GetItem(PK = OWN#{nodeHash}, SK = {delegateId})
  return result != null
```

| 操作 | 用途 | 实现 |
|------|------|------|
| `hasOwnership(nodeHash, delegateId)` | delegate 是否 own（含子孙上传） | `GetItem(PK=OWN#{nodeHash}, SK={delegateId})` — **O(1)** |
| `hasAnyOwnership(nodeHash)` | Node 是否存在任何 owner | `Query(PK=OWN#{nodeHash})` + Limit 1 |
| `addOwnership(nodeHash, chain, ...)` | 记录上传者（全链写入） | `BatchWriteItem` 为 chain 中每个 delegateId 写入一条记录 |

**查询是热路径，写入是冷路径**——每次 Node 读取、PUT children 验证、prepare-nodes 都要查 ownership，但上传只发生一次。用全链写入（多写几条）换取 O(1) 查询是正确的 trade-off。

### 4.5 Ownership 检查示例

**同一分支的子孙关系**：

```
Root (dlg_root)
  └── Delegate-A (dlg_aaa)
        └── Delegate-B (dlg_bbb) → 上传 Node X

dlg_bbb 的 chain = [dlg_root, dlg_aaa, dlg_bbb]

写入 3 条记录:
  OWN#nodeX / dlg_root  → { uploadedBy: "dlg_bbb" }
  OWN#nodeX / dlg_aaa   → { uploadedBy: "dlg_bbb" }
  OWN#nodeX / dlg_bbb   → { uploadedBy: "dlg_bbb" }

查 dlg_aaa 是否 own nodeX:
  → GetItem(OWN#nodeX, dlg_aaa) → 命中 ✓

查 dlg_root 是否 own nodeX:
  → GetItem(OWN#nodeX, dlg_root) → 命中 ✓
```

**跨分支不互通**：

```
Root (dlg_root)
  ├── Delegate-A (dlg_aaa) → 上传 Node X
  └── Delegate-B (dlg_bbb) → 想引用 Node X

dlg_aaa 的 chain = [dlg_root, dlg_aaa]

写入 2 条记录:
  OWN#nodeX / dlg_root  → { uploadedBy: "dlg_aaa" }
  OWN#nodeX / dlg_aaa   → { uploadedBy: "dlg_aaa" }

查 dlg_bbb 是否 own nodeX:
  → GetItem(OWN#nodeX, dlg_bbb) → 未命中 ✗

查 dlg_root 是否 own nodeX:
  → GetItem(OWN#nodeX, dlg_root) → 命中 ✓
```

> 注意：上例中 `dlg_root` 可以 own Node X（因为写入时已展开全链），但 `dlg_bbb` 不能——跨分支引用需要通过 scope + proof 验证。

---

## 5. 认证与授权模型

### 5.1 两阶段验证架构

所有数据 API 调用采用**两阶段验证**，在代码结构上建议提取为两个独立函数：

```
请求进入
  │
  ├── 阶段 1: validateToken()        ← Token 有效性验证
  │     ├── 解码 Authorization Header 中的 Access Token
  │     ├── 验证 Token 未过期
  │     ├── 查找关联的 Delegate
  │     ├── 验证 Delegate 未过期（expiresAt）
  │     ├── 验证 Delegate chain 上每个节点均未 revoke 且未过期
  │     ├── 验证 Realm 匹配
  │     └── 失败 → 401 Unauthorized
  │
  ├── 阶段 2: authorizeRequest()     ← 业务授权验证
  │     ├── 根据 API 语义检查权限标志（canUpload, canManageDepot）
  │     ├── Root Delegate → 跳过 proof 检查（通过 DB 记录判断，非 Token 标志）
  │     ├── 验证 Token + Proof 是否构成完整授权
  │     └── 失败 → 403 Forbidden
  │
  └── Handler                        ← 执行业务逻辑
```

**重要**：阶段 1 中必须**验证整条 delegate chain 没有被 revoke 或过期**。即使当前 delegate 本身未被 revoke，如果其任何祖先被 revoke 或过期，访问也应被拒绝。这就是为什么 revoke 不需要递归展开整棵子树做级联标记——验证时自然级联生效。

#### Chain 验证优化：Redis 缓存

为避免每次 API 请求都遍历查询 chain 上所有 delegate 的 DynamoDB 记录，采用 **Redis 缓存** 方案：

**缓存结构**：

```
Key:   dlg:revoked:{delegateId}
Value: "1"（被 revoke）| "0"（未被 revoke）
TTL:   与 Access Token 有效期对齐（如 1 小时）
```

**验证流程**：

```
validateChain(chain: string[]):
  for each delegateId in chain:
    cached = Redis.GET("dlg:revoked:" + delegateId)
    if cached == "1" → 401（已 revoke）
    if cached == null:
      delegate = DynamoDB.GetItem(delegateId)
      isInvalid = delegate.isRevoked || (delegate.expiresAt && delegate.expiresAt < now)
      Redis.SET("dlg:revoked:" + delegateId, isInvalid ? "1" : "0", EX=3600)
      if isInvalid → 401
  → chain 有效 ✓
```

**缓存失效**：

- **Revoke 时主动清除**：执行 `POST /delegates/{id}/revoke` 时，立即 `Redis.SET("dlg:revoked:{id}", "1")`
- **过期是自然失效**：delegate 过期后，下次缓存未命中时从 DB 读取最新状态
- **最坏情况延迟**：缓存 TTL 内的 revoke 可能有短暂延迟（≤ 缓存 TTL），可通过主动清除缓解
- **无 Redis 降级**：Redis 不可用时 fallback 到 DynamoDB `BatchGetItem` 批量查询 chain 上所有 delegate

### 5.2 双 Header 认证机制

数据 API 调用时需要提供两个 Header：

| Header | 用途 | 格式 |
|--------|------|------|
| `Authorization` | 证明调用方对某个 scope DAG 根有访问权限 | `Bearer {access_token_base64}` |
| `X-CAS-Proof` | 证明 scope 包含请求中涉及的具体节点 | JSON: `Record<nodeHash, proofWord>` |

**Proof 格式**：

```http
X-CAS-Proof: {"abc123":"ipath#0:1:2","def456":"ipath#0:3"}
```

其中 `proofWord` 格式为 `ipath#<index-path>`：
- `ipath#` 是固定前缀
- `0:1:2` 表示从 scope root 到目标节点的导航路径
  - `0` → 选择第几个 scope root（单 scope 时固定为 0）
  - `1` → scope root 的第 1 个 child
  - `2` → 上一步节点的第 2 个 child

**免 proof 规则**：对于当前 delegate 有 ownership 的节点（即该 delegate 或其子孙曾上传过），**无需提供 proof**。服务端先查 ownership，通过则跳过 proof 验证。

### 5.3 Scope 定义

Scope 定义了一个 Delegate 可访问的 CAS 子树。它是一个或多个 CAS 节点 hash，代表子树的根：

```
Scope Root: node A
              │
         ┌────┼────┐
         B    C    D         ← Delegate 可访问 A 以及 A 的所有后代
        / \   │
       E   F  G
```

**Root Delegate 无 scope 限制**——不存储 scope，可以访问 realm 下的任何节点。

非 root delegate 的 scope 有两种存储形式：

| 形式 | Delegate 记录字段 | 说明 |
|------|------------------|------|
| **单 Scope** | `scopeNodeHash` | 直接存储一个 CAS 节点 hash（最常见） |
| **多 Scope** | `scopeSetNodeId` | 引用 DynamoDB 中的 ScopeSetNode 记录 |

#### Depot 版本作为 Proof 根

提供 proof 时，除了使用 delegate 的 scope root 作为起点外，还可以**指定某个 Depot 的特定版本作为 proof 根**。这对于 `canManageDepot` 权限尤其重要——拥有 Depot 管理权限的 delegate 可以访问该 Depot 的所有历史版本数据。

```http
X-CAS-Proof: {"abc123":"depot:DEPOT_ID@VERSION#0:1:2"}
```

其中：
- `depot:DEPOT_ID@VERSION` 指定以该 Depot 的某个历史版本的 root 节点为起点
- `#0:1:2` 是从该 root 开始的 index-path
- 服务端验证：delegate 是否有该 Depot 的管理权限 → 解析该版本的 root hash → 沿 index-path 遍历

### 5.4 Proof 验证流程

服务端收到 `X-CAS-Proof` 后的验证流程：

```
对于请求中涉及的每个 nodeHash:
  │
  ├── 1. 检查 ownership（子孙 own = 自己 own）
  │     hasOwnership(nodeHash, currentDelegateId)
  │     → 通过: 该节点免 proof ✓
  │
  ├── 2. Root Delegate 特殊路径
  │     当前 delegate 是 root delegate（服务端通过 DB 记录判断）→ 免 proof ✓
  │
  └── 3. 检查 proof（仅当上述检查均未通过时）
        ├── 从 X-CAS-Proof 中取出该 nodeHash 的 proofWord
        ├── 解析 proofWord（两种格式）：
        │     ├── "ipath#0:1:2" → 从 delegate scope root 开始
        │     └── "depot:ID@VER#0:1:2" → 从 depot 版本 root 开始（需验证 depot 管理权限）
        ├── 沿 indices 逐层遍历 CAS DAG
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

### 5.5 在各 API 中的应用

#### 5.5.1 Node 读取 (GET /nodes/:key)

- **Token**: 验证 AT 有效性 + delegate chain 未 revoke/过期
- **Proof**: 必须提供目标节点的 proof（除非有 ownership）

```http
GET /api/realm/{realmId}/nodes/{key}
Authorization: Bearer {access_token_base64}
X-CAS-Proof: {"{key}":"ipath#0:1:2"}
```

#### 5.5.2 Node 上传 (PUT /nodes/:key)

- **Token**: 验证 AT 有效性 + `canUpload` + delegate chain 未 revoke/过期
- **Proof**: 需要为所有 children 提供 proof（除非有 ownership 的 children）
- 上传成功后：为**当前 delegate 的整条 chain** 写入 ownership 记录（§4.3，全链写入）

```http
PUT /api/realm/{realmId}/nodes/{key}
Authorization: Bearer {access_token_base64}
X-CAS-Proof: {"child1_hash":"ipath#0:1:2","child2_hash":"ipath#0:3"}
Content-Type: application/octet-stream

{node_binary_data}
```

#### 5.5.3 FS Rewrite (link 引用)

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

1. 先做 ownership 检查（当前 delegate 或其子孙是否 own 过目标节点）
2. 失败则用 Proof header 中的 proof 做 scope 验证
3. 都失败 → `403 LINK_NOT_AUTHORIZED`

#### 5.5.4 Depot Commit

```http
PATCH /api/realm/{realmId}/depots/{depotId}
Authorization: Bearer {access_token_base64}
X-CAS-Proof: {"abc123":"ipath#0:1:2"}   ← 可选，当无 ownership 时提供
Body: { "root": "node:abc123..." }
```

验证:
1. delegate 是否有该 Depot 的管理权限（自己/子孙创建的 Depot，或 `delegatedDepots` 列表中的 Depot） → 否则 403
2. `hasOwnership(root, delegateId)` → 通过则允许 commit
3. 无 ownership → 检查 `X-CAS-Proof` 中是否有 root 节点的 proof → 通过则允许 commit
4. 都没有 → `403 ROOT_NOT_AUTHORIZED`

支持 proof 作为 ownership 的 fallback，使得 delegate 可以 commit 通过 scope 可见但没有 ownership 的 root 节点——例如由其他分支的 delegate 上传的节点。

#### 5.5.5 prepare-nodes 三分类

客户端上传前调用 `POST /nodes/prepare` 确定哪些节点需要上传：

| 分类 | 含义 | 客户端行为 |
|------|------|-----------|
| `missing` | 节点不存在于 CAS 中 | 必须上传 |
| `owned` | 节点存在，且当前 delegate（或其子孙）有 ownership | 不需要上传，可直接引用 |
| `unowned` | 节点存在，但当前 delegate 无 ownership | 需要上传或 claim |

### 5.6 Scope 在 Delegate 创建时的收缩

用户创建 root delegate 下的子 delegate 时，scope 通过 CAS URI 指定：
- `cas://depot:DEPOT_ID` → 解析为该 Depot 当前的 root hash
- `cas://*` → 该 Realm 下所有 Depot 的 root（通配符）
- `cas://node:HASH` → 直接指定节点 hash

Delegate 创建子 delegate 时，子 scope 必须是父 scope 的子集。用相对路径表示：
- `"."` → 继承父 scope 全部
- `"0:1:2"` → 从父 scope root 沿 index 导航到的子树

这确保了 **scope 只能单调收缩**——子 delegate 永远不可能访问父 delegate 看不到的数据。

---

## 6. Claim API

### 6.1 动机

当 `prepare-nodes` 返回 `unowned` 节点时，客户端可以选择重新上传（PUT）或使用 Claim API 获取 ownership。Claim 通过 **proof-of-possession** 证明客户端持有节点的完整内容，无需重新传输数据。

### 6.2 端点

```http
POST /api/realm/{realmId}/nodes/{key}/claim
Authorization: Bearer {access_token_base64}
Content-Type: application/json

{
  "pop": "pop:XXXXXXXXXXXXXXXXXXXXXXXX"
}
```

### 6.3 Proof-of-Possession 格式（Keyed Blake3）

```
pop_key  = blake3_256(token_bytes)                    // 128B token → 32B key
pop_hash = blake3_128(key = pop_key, msg = content)   // keyed hash over full content
pop      = "pop:" + crockford_base32(pop_hash)         // 编码为字符串
```

| 步骤 | 输入 | 输出 | 说明 |
|------|------|------|------|
| 1. 派生 key | 128 字节 Access Token 原始字节 | 32 字节 key | Blake3-256 哈希，适配 keyed mode 的 32 字节 key 要求 |
| 2. Keyed hash | key + 节点完整内容 | 16 字节 hash | Blake3-128 keyed mode，流式处理任意大小内容 |
| 3. 编码 | 16 字节 hash | 26 字符字符串 | Crockford Base32 编码 |
| 4. 格式化 | 编码结果 | `pop:XXXXX...` | 添加固定前缀 |

**示例**：

```typescript
import { blake3 } from "@casfa/core";

function computePoP(tokenBytes: Uint8Array, content: Uint8Array): string {
  // 1. 派生 32 字节 key（Blake3 keyed mode 要求 32B key）
  const popKey = blake3_256(tokenBytes);

  // 2. Keyed Blake3-128 over full content（流式，不需要全部加载到内存）
  const popHash = blake3_128(content, { key: popKey });

  // 3. 编码
  return "pop:" + crockfordBase32Encode(popHash);
}
```

**安全性**：

- **防重放**：PoP 绑定了具体的 Token 字节——不同 Token 派生不同 key，算出不同的 hash
- **防伪造**：Keyed Blake3 对完整内容计算哈希，仅知道 node hash 无法反推 PoP
- **确定性**：相同 token + 相同 content → 相同 PoP，服务端可重新计算验证
- **流式处理**：Blake3 是流式哈希，1GB 文件也只需一次遍历，无需全部加载到内存
- **无采样风险**：不依赖采样策略，避免了采样碰撞的可能性

**为什么选择 Keyed Blake3 而非 sampling**：

服务端验证 Claim 时无论如何都需要从 CAS 读取节点完整内容（无论是采样还是全量哈希）。既然如此，直接用 keyed hash 处理全量内容，实现最简单、安全性最强。

### 6.4 服务端验证流程

```
1. 验证 Token 有效性 + delegate chain 未 revoke/过期（失败 → 401）
2. 验证 canUpload 权限（失败 → 403）
3. 检查节点是否存在于 CAS 中（不存在 → 404）
4. 检查当前 delegate 是否已有 ownership（已有 → 200 幂等返回）
5. 从 CAS 读取节点内容（流式）
6. 服务端计算 pop_key = blake3_256(token_bytes)
7. 服务端计算 pop_hash = blake3_128(key=pop_key, msg=content)
8. 与请求中的 PoP 值比较（不匹配 → 403 INVALID_POP）
9. 为当前 delegate 的整条 chain 写入 ownership 记录（全链写入）
10. 返回 200 OK
```

### 6.5 与 PUT 的对比

| | PUT（重传） | Claim |
|---|---|---|
| **数据传输** | 需要传输完整节点数据 | 仅传输 PoP 值（~40 字节） |
| **适用场景** | 节点不存在（`missing`） | 节点已存在但无 ownership（`unowned`） |
| **验证方式** | hash 校验（内容 = 声明的 key） | Keyed Blake3 PoP 校验（证明持有完整内容） |
| **Ownership 写入** | 当前 delegate 整条 chain（全链写入） | 当前 delegate 整条 chain（全链写入，相同） |
| **对 `missing` 节点** | ✓ 有效 | ✗ 不可用（404） |

> **TODO**: Claim API 的频率限制和防滥用策略待定义。

---

## 7. 资源操作权限矩阵

### 7.1 认证类型

| 操作类型 | 需要的认证 |
|---------|-----------|
| OAuth 登录/注册 | 无 |
| 管理员操作 | JWT + Admin 角色 |
| 获取 root delegate token | JWT |
| 刷新 Token | Refresh Token |
| 创建/列表/revoke delegate | **Access Token** |
| 所有 Realm 数据操作 | **Access Token** |

### 7.2 Access Token 操作权限

| 操作 | `canUpload` | `canManageDepot` | 需要 Proof | 其他检查 |
|------|:-:|:-:|:-:|------|
| **Delegate 创建** | | | | 子权限 ≤ 当前；需要 AT |
| **Delegate 列表/详情** | | | | 限当前 delegate 的子孙 |
| **Delegate Revoke** | | | | 限当前 delegate 的子孙 |
| **Node 读取** (`GET /nodes/:key`) | | | ✓ | root delegate 免 proof |
| **Node 元数据** (`GET /nodes/:key/metadata`) | | | ✓ | root delegate 免 proof |
| **Node 上传** (`PUT /nodes/:key`) | ✓ | | children proof | hash 校验 |
| **Node Claim** (`POST /nodes/:key/claim`) | ✓ | | | PoP 校验 |
| **Node 准备** (`POST /nodes/prepare`) | | | | 返回三分类 |
| **FS 读** (stat, read, ls) | | | | 基于 Node 鉴权，见下方说明 |
| **FS 写** (write) | ✓ | | | 生成新 Node，基于 Node 鉴权 |
| **FS mkdir** | ✓ | | | 生成新 Node |
| **FS rm/mv/cp** | ✓ | | | 生成新 Node |
| **FS rewrite** (link) | ✓ | | 引入节点 proof | 引入外部节点需 PoP 或 ipath |
| **FS mount** | ✓ | | 引入节点 proof | 引入外部节点需 PoP 或 ipath |
| **Depot 列表/查看** | | | | |
| **Depot 创建/删除** | | ✓ | | 限可管理范围 |
| **Depot Commit** | | ✓ | root proof | 限可管理范围 + root ownership 或 proof |
| **Depot 历史版本访问** | | ✓ | | 限可管理范围 |

#### FS 操作的鉴权模型：基于 Node

FS 操作的鉴权**基于 Node 节点**，不是基于 Depot。所有 FS 写操作的本质是：对现有 Node 进行变换，生成新的 Node。新生成的 Node 由执行操作的 delegate 上传并获得 ownership，因此**常规 FS 写操作不需要额外的 proof**。

**只有引入外部节点的操作需要 proof**：

| 操作 | 是否需要 proof | 原因 |
|------|:-:|------|
| write（写入新内容） | ✗ | 内容由调用方提供，生成新 Node 并获得 ownership |
| mkdir, rm, mv, cp | ✗ | 操作已有子树中的节点，生成新 Node |
| rewrite（link 引用） | ✓ | `link` 引入外部 Node，需证明有权引用该节点 |
| mount | ✓ | 引入外部子树，需证明有权引用该子树根节点 |

对于 rewrite 和 mount 中引入的外部节点，验证顺序为：
1. **Ownership 检查**：当前 delegate 是否 own 该节点 → 通过则免 proof
2. **Proof 验证**：`X-CAS-Proof` 中是否包含该节点的 ipath 或 PoP → 通过则允许
3. **都没有** → `403 LINK_NOT_AUTHORIZED`

**FS 读操作**（stat, read, ls）在 Depot 上下文中执行时，通过 Depot 管理权限隐式授权——拥有 Depot 管理权限意味着可以访问该 Depot 所有历史版本数据，因此不需要逐节点 proof。对于非 Depot 上下文的节点读取，使用标准的 `GET /nodes/:key` API，需要 ownership 或 proof。

### 7.3 鉴权中间件栈

```
请求进入
  │
  ├─── validateToken() [阶段 1 → 401]
  │      ├── 提取 Authorization Header
  │      ├── 解码 Access Token（128 字节二进制）
  │      ├── 计算 tokenId，查找关联 Delegate
  │      ├── 检查: Token 未过期
  │      ├── 检查: Delegate 未过期（expiresAt）
  │      ├── 检查: Delegate chain 上无任何节点被 revoke 或过期
  │      ├── 检查: Realm 匹配
  │      └── 设置 AuthContext（含 delegate, delegateChain）
  │
  ├─── authorizeRequest() [阶段 2 → 403]
  │      ├── 检查权限标志（canUpload / canManageDepot）
  │      ├── Root Delegate → 跳过 proof 检查（来自 AuthContext.delegate 记录，非 Token 标志）
  │      ├── 解析 X-CAS-Proof Header
  │      ├── 对请求涉及的每个节点:
  │      │     ├── ownership 检查（当前 delegate 或其子孙是否 own）
  │      │     └── 若无 ownership → proof 验证（ipath 或 depot:version 遍历 DAG）
  │      └── 所有节点验证通过 → 继续
  │
  ├─── zValidator         ← Zod schema 验证请求体
  │
  └─── Handler            ← 执行业务逻辑
```

---

## 8. 端到端流程示例

### 8.1 Agent 上传文件树

```
1. User 登录 → 获取 JWT

2. User 获取 root delegate 的 token
   POST /api/tokens/root  (JWT)
   → { delegate: dlg_root, refreshToken: RT-0, accessToken: AT-0 }

3. User 用 AT-0 创建子 delegate 给 Agent
   POST /api/realm/{realmId}/delegates  (AT-0)
   Body: { name: "Agent-A", canUpload: true, canManageDepot: true,
           delegatedDepots: ["Depot-1"], scope: "cas://depot:Depot-1" }
   → { delegate: dlg_aaa, refreshToken: RT-A, accessToken: AT-A }

4. User 将 AT-A 交给 Agent（短期工具只给 AT，不给 RT）
   或将 RT-A + AT-A 都交给长期运行的 Agent

5. Agent 准备上传，先调用 prepare-nodes
   POST /nodes/prepare (AT-A)  { keys: [A, B, C, D] }
   → { missing: [A, B], owned: [], unowned: [C, D] }

6. Agent 上传叶子节点（chain = [dlg_root, dlg_aaa]）
   PUT /nodes/A (AT-A)  → ownership 全链写入: dlg_root, dlg_aaa
   PUT /nodes/B (AT-A)  → ownership 全链写入: dlg_root, dlg_aaa

7. Agent 对 unowned 节点执行 claim
   POST /nodes/C/claim (AT-A) { pop: "pop:..." } → ownership 全链写入: dlg_root, dlg_aaa
   POST /nodes/D/claim (AT-A) { pop: "pop:..." } → ownership 全链写入: dlg_root, dlg_aaa

8. Agent 上传父节点（含 children = [A, B, C, D]）
   PUT /nodes/E (AT-A)
   → 检查每个 child: hasOwnership(child, dlg_aaa) → ✓（dlg_aaa 直接 own）
   → 上传成功

9. Agent 提交 Depot
   PATCH /depots/Depot-1 (AT-A) { root: "node:E..." }
   → depot 管理权限检查 ✓ + hasOwnership(E, dlg_aaa) → ✓ → commit 成功

10. AT-A 过期后，Agent 用 RT-A 刷新
    POST /api/tokens/refresh (RT-A)
    → { accessToken: AT-A2, refreshToken: RT-A2 }（RT-A 作废，RT-A2 可继续无限续期）
```

### 8.2 Ownership 方向：子孙 own = 自己 own（全链写入）

```
Root (dlg_root)
  └── Delegate-A (dlg_aaa)
        └── Delegate-A1 (dlg_a1) → AT 上传 Node X

全链写入 3 条记录:
  OWN#nodeX / dlg_root  → { uploadedBy: "dlg_a1" }
  OWN#nodeX / dlg_aaa   → { uploadedBy: "dlg_a1" }
  OWN#nodeX / dlg_a1    → { uploadedBy: "dlg_a1" }

查 dlg_aaa 是否 own nodeX:
  → GetItem(OWN#nodeX, dlg_aaa) → 命中 ✓

查 dlg_root 是否 own nodeX:
  → GetItem(OWN#nodeX, dlg_root) → 命中 ✓
```

### 8.3 跨分支引用（需要 Proof）

```
Root (dlg_root)
  ├── Delegate-A (dlg_aaa) → AT 上传 Node X
  └── Delegate-B (dlg_bbb) → AT 想引用 Node X

全链写入 2 条记录:
  OWN#nodeX / dlg_root  → { uploadedBy: "dlg_aaa" }
  OWN#nodeX / dlg_aaa   → { uploadedBy: "dlg_aaa" }

查 dlg_bbb 是否 own nodeX:
  → GetItem(OWN#nodeX, dlg_bbb) → 未命中 ✗

Delegate-B 需要提供 proof:
  X-CAS-Proof: {"nodeX_hash":"ipath#0:3:1"}
  → scope root → child[3] → child[1] → 结果 == Node X → ✓
  → 引用成功

注意: dlg_root CAN own nodeX（GetItem 直接命中），
      所以 root delegate 的 AT 可以直接引用，无需 proof。
```

### 8.4 跨用户引用（需要 Proof）

```
User-A → Root-A → Delegate-A → AT 上传 Node X
  全链写入: OWN#nodeX / dlg_root_a, OWN#nodeX / dlg_aaa

User-B → Root-B → Delegate-B → AT 想引用 Node X

ownership 检查: GetItem(OWN#nodeX, dlg_bbb) → 未命中 ✗

AT 提供 proof:
  X-CAS-Proof: {"nodeX_hash":"ipath#0:3:1"}

验证: scope root → child[3] → child[1] → 结果 == Node X → ✓

引用成功
```

### 8.5 Revoke 与权限回收

```
Root (dlg_root)
  ├── Delegate-A (dlg_aaa)
  │     ├── Delegate-A1 (dlg_a1)  ── 已上传 Node X, Y
  │     └── Delegate-A2 (dlg_a2)
  └── Delegate-B (dlg_bbb)

1. User 发现 Agent-A 行为异常，决定 revoke Delegate-A
   POST /delegates/dlg_aaa/revoke (AT-root)
   → 只标记 dlg_aaa.isRevoked = true（不递归展开子树）

2. Delegate-A 的 AT 立即无法访问
   validateToken 检查 chain [dlg_root, dlg_aaa] → dlg_aaa 被 revoke → 401

3. Delegate-A1, A2 的 AT 也无法访问（虽然自身未被标记 revoke）
   validateToken 检查 chain [dlg_root, dlg_aaa, dlg_a1] → dlg_aaa 被 revoke → 401

4. Node X, Y 的 ownership 记录不受影响（历史不可篡改）

5. 如需恢复能力，创建新的 Delegate-C
   POST /delegates (AT-root) { name: "Agent-A-v2", canUpload: true, scope: ... }
   → { delegate: dlg_ccc, ... }
```

### 8.6 Claim 流程

```
1. Agent 调用 prepare-nodes (AT)
   → { missing: [], owned: [X], unowned: [Y, Z] }

2. Agent 对 unowned 节点执行 claim（无需下载，Agent 本地已有内容）
   POST /nodes/Y/claim (AT)  { pop: "pop:5DWHV3KRMEZ9Y0NJ2BG1Q4AXPT" }
   → 服务端验证 Keyed Blake3 PoP → 全链写入 ownership → 200 OK

3. POST /nodes/Z/claim (AT)  { pop: "pop:..." } → 200 OK

4. 所有节点现在都有 ownership，可直接引用
```

### 8.7 工具调用流程（替代 Ticket）

```
1. Agent-A 收到用户任务，需要调用 Code Review 工具

2. Agent-A 用 AT-A 创建子 delegate 给工具
   POST /delegates (AT-A) { name: "code-review-tool", canUpload: true,
                            expiresAt: <30分钟后> }
   → { delegate: dlg_tool, accessToken: AT-tool }
   （只给工具 AT，不给 RT——工具是短期任务，30 分钟后自动过期）

3. 工具用 AT-tool 读取数据（通过 scope 或 proof）

4. 工具用 AT-tool 上传工作结果（chain = [dlg_root, dlg_aaa, dlg_tool]）
   PUT /nodes/result-hash (AT-tool)
   → ownership 全链写入: dlg_root, dlg_aaa, dlg_tool

5. Agent-A 用 AT-A 引用工具的结果
   → hasOwnership(result-hash, dlg_aaa)
   → GetItem(OWN#result-hash, dlg_aaa) → 命中 ✓（全链写入时已写入）
   → 直接引用，无需 proof

6. Agent-A commit 到 Depot
   → 成功（dlg_tool 的工作成果归属于 dlg_aaa）
```

---

## 9. 安全性设计小结

### 9.1 设计原则

| 原则 | 实现 |
|------|------|
| **Delegate 实体化** | Delegate 是持久业务实体，不是 Token；是 ownership 的主体；可设有效期 |
| **Immutable Tree** | Delegate tree 一旦创建不可修改，保障 ownership 追溯的完整性 |
| **能力衰减** | 子 delegate 权限 ≤ 父 delegate，scope 单调收缩 |
| **Root 全权** | Root Delegate 无 scope 限制，拥有 realm 下一切权限 |
| **Token 轮转** | Refresh Token 一次性使用，同时返回新 RT + AT，确保无限续期并检测泄露 |
| **AT 统一访问** | Access Token 是唯一 API 凭证，用于数据操作和 delegate 管理 |
| **FS 基于 Node** | FS 操作的鉴权基于 Node 节点；常规写操作生成新 Node 无需 proof；只有 rewrite/mount 引入外部节点需要 proof |
| **Ownership 全链写入** | 写入时展开整条 chain，查询 O(1)；子孙 own = 自己 own，祖先 own ≠ 自己 own |
| **Revoke 验证时级联** | revoke 只标记目标，验证时检查整条 chain——无需递归写入子树 |
| **双 Header 授权** | Token 证明 scope 访问权，Proof 证明具体节点的访问权 |
| **Depot 管理隔离** | 每个 delegate 只能管理自己/子孙创建的 Depot 和父 delegate 显式委派的 Depot（`delegatedDepots`） |
| **零信任引用** | 每个 child 引用都单独验证 ownership 或 proof |
| **PoP 防伪造** | Claim 要求证明持有完整内容，binding token 防重放 |

### 9.2 防御的攻击场景

| 攻击 | 防御 |
|------|------|
| **跨用户节点挂载** | ownership 检查 + proof 验证双重防线 |
| **proof 伪造** | proof 实际遍历 CAS DAG，伪造的 index-path 无法到达目标 |
| **hash 猜测** | claim 需要 PoP（完整内容），PUT 需要完整数据 |
| **Claim PoP 伪造** | Keyed Blake3 对完整内容计算哈希 + token 绑定，无法仅凭 hash 计算 |
| **Claim PoP 重放** | PoP 包含 token 字节的 hash，不同 Token 算出的值不同 |
| **Token 泄露** | Refresh Token 一次性使用，轮转检测泄露；Access Token 短期有效 |
| **revoked/过期 delegate 继续访问** | validateToken 检查整条 chain 的 revoke 和过期状态 |
| **scope 逃逸** | 子 delegate scope 单调收缩，proof 逐层验证，root delegate 无限制但不可再分配 |
| **Depot 根篡改** | commit 时验证 root 节点的 ownership + depot 管理权限 |
| **跨分支 ownership 窃取** | ownership 只向下继承（子孙→祖先），不横向传播 |

### 9.3 数据模型一览

```
DynamoDB 单表设计（主要实体）:

Delegate 记录:
  PK = REALM#{realm}          SK = DLG#{delegateId}
  字段: delegateId, name?, parentId, chain, depth,
        canUpload, canManageDepot, delegatedDepots?,
        scopeNodeHash?, scopeSetNodeId?,
        expiresAt?, isRevoked, revokedAt?, revokedBy?,
        createdAt
  GSI: PARENT#{parentId}      → DLG#{delegateId}

Token 记录:
  PK = TOKEN#{tokenId}        SK = METADATA
  字段: tokenType (refresh|access), delegateId, realm,
        expiresAt, isUsed (for refresh), createdAt
  GSI1: REALM#{realm}         → TOKEN#{tokenId}
  GSI2: DLG#{delegateId}      → TOKEN#{tokenId}

Ownership 记录:
  PK = OWN#{nodeHash}         SK = {delegateId}
  字段: uploadedBy, kind, size, contentType, createdAt
  注意: 全链写入——为 chain 上每个 delegate 各写入一条记录，查询 O(1)

Depot 记录:
  PK = REALM#{realm}          SK = DEPOT#{depotId}
  字段: createdBy (delegateId), ...

ScopeSetNode 记录:
  PK = SETNODE#{setNodeId}    SK = METADATA
  字段: children (有序 scope root hash 列表)
  注意: ScopeSetNode 本身不持有 refCount。
        创建 ScopeSetNode 时，会增加其 children（scope root hash）的 RefCount。
        Delegate 在有效期（TTL）内，其 scope 持有的引用计数有效；
        Delegate 过期或被 revoke 后，引用计数可安全回收。

RefCount 记录:
  PK = REALM#{realm}          SK = REF#{nodeHash}

User 记录:
  PK = USER#{userId}          SK = METADATA
  字段: rootDelegateId, ...
```

### 9.4 关键不变量

1. **Delegate 是实体，Token 是凭证**：Delegate 永久存储（可有有效期），Token 用后即弃
2. **Delegate Tree Immutable**：一旦创建不可修改、不可删除，只能 revoke 或过期
3. **Revoke 不可逆**：revoke 只标记目标 delegate，验证时检查 chain 级联生效
4. **过期等同 Revoke**：delegate 到达 expiresAt 后视为自动 revoke
5. **Revoke 不破坏历史**：被 revoke/过期的 delegate 的 ownership 记录仍然有效
6. **权限单调递减**：子 delegate 的权限/scope 只能 ≤ 父 delegate
7. **Root Delegate 全权**：无 scope 限制，拥有 realm 下一切权限。Root 身份由服务端查询 delegate 记录判断，Token 中不包含 `is_root` 标志
8. **Ownership 全链写入**：写入时展开 chain，查询 O(1)；子孙 own = 自己 own，祖先 own ≠ 自己 own
9. **Token 轮转**：Refresh Token 一次性使用，同时返回新 RT + AT；Access Token 短期有效
10. **AT 统一凭证**：所有 API 操作（数据操作 + delegate 管理）统一使用 Access Token
11. **Depot 管理隔离**：delegate 只能管理自己/子孙创建的 Depot + 父 delegate 显式委派的 Depot（`delegatedDepots`，immutable）
12. **引用必须授权**：PUT children、rewrite link、mount、depot commit 都必须通过 ownership 或 proof
13. **FS 基于 Node**：FS 写操作生成新 Node 无需 proof；rewrite/mount 引入外部节点需 ownership 或 proof
14. **PoP 不可伪造**：Claim 需要完整内容 + token 绑定，防伪造防重放

---

## 10. 错误码定义

### 10.1 HTTP 状态码约定

| HTTP 状态码 | 语义 | 触发场景 |
|-------------|------|----------|
| **200** | 成功 | 正常返回 |
| **201** | 创建成功 | Delegate 创建、Node 上传 |
| **400** | 请求无效 | 参数校验失败、格式错误 |
| **401** | 未认证 | Token 无效/过期、Delegate chain 失效 |
| **403** | 无权限 | 权限不足、Proof 验证失败 |
| **404** | 不存在 | 节点/Depot/Delegate 不存在 |
| **409** | 冲突 | Refresh Token 已使用（token rotation 冲突） |
| **429** | 过多请求 | 频率限制 |

### 10.2 业务错误码

所有错误响应都包含统一的 JSON 结构：

```json
{
  "error": {
    "code": "INVALID_TOKEN",
    "message": "Access token has expired"
  }
}
```

| 错误码 | HTTP | 说明 |
|--------|:----:|------|
| **INVALID_TOKEN** | 401 | Token 解码失败、magic 不匹配、格式错误 |
| **TOKEN_EXPIRED** | 401 | Access Token 已过期 |
| **TOKEN_USED** | 409 | Refresh Token 已被使用（token rotation 冲突） |
| **DELEGATE_REVOKED** | 401 | Delegate 已被 revoke |
| **DELEGATE_EXPIRED** | 401 | Delegate 已过期 |
| **CHAIN_INVALID** | 401 | Delegate chain 上存在已 revoke 或过期的祖先 |
| **REALM_MISMATCH** | 401 | Token 的 realm 与请求的 realm 不匹配 |
| **PERMISSION_DENIED** | 403 | 缺少所需权限（canUpload / canManageDepot） |
| **PROOF_REQUIRED** | 403 | 缺少节点的 proof，且无 ownership |
| **PROOF_INVALID** | 403 | Proof 的 index-path 未到达目标节点 |
| **LINK_NOT_AUTHORIZED** | 403 | Rewrite/mount 引入的外部节点未授权（无 ownership 且无 proof） |
| **ROOT_NOT_AUTHORIZED** | 403 | Depot commit 的 root 节点未授权（无 ownership 且无 proof） |
| **INVALID_POP** | 403 | Claim API 的 PoP 校验失败 |
| **DEPOT_NOT_FOUND** | 404 | Depot 不存在 |
| **NODE_NOT_FOUND** | 404 | 节点不存在于 CAS 中 |
| **DELEGATE_NOT_FOUND** | 404 | Delegate 不存在或不在当前 delegate 子树内 |
| **HASH_MISMATCH** | 400 | 上传的 Node 内容 hash 与声明的 key 不匹配 |
| **DEPTH_EXCEEDED** | 400 | Delegate 树深度超过 16 层限制 |
| **SCOPE_VIOLATION** | 400 | 子 delegate 的 scope 不是父 delegate scope 的子集 |
| **PERMISSION_ESCALATION** | 400 | 子 delegate 的权限超过父 delegate |
