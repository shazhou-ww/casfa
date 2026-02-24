# Node 引用安全：Ownership 模型重设计

> 日期: 2026-02-07（v3，基于评审反馈订正）

---

## 目录

1. [问题描述](#1-问题描述)
2. [设计决策总结](#2-设计决策总结)
3. [Ownership 模型重设计](#3-ownership-模型重设计)
4. [引用验证机制](#4-引用验证机制)
5. [prepare-nodes 流程变更](#5-prepare-nodes-流程变更)
6. [方案设计](#6-方案设计)
7. [影响范围](#7-影响范围)
8. [攻击场景与防御](#8-攻击场景与防御)

---

## 1. 问题描述

### 1.1 漏洞

PUT Node（`PUT /api/realm/{realmId}/nodes/{key}`）在上传包含 children 的节点（dict / file / successor）时，**不验证 children 的归属关系**。攻击者可构造一个节点，将其他用户创建的节点作为 children 引用，从而在自己的树结构中"挂载"他人的数据。

同样地，`fs/rewrite` 的 `link` 条目中 `proof` 字段被接受但从未实际验证，等价于一个绕过开关。

### 1.2 期望行为

对于上传节点的每一个 child，满足以下条件之一：
1. **uploader 验证**：child 被当前 Token own 过（该 Token 曾上传过该节点）
2. **scope 验证（proof）**：客户端提供 proof（index-path），证明 child 在 Token 的 scope 树内

> 这与 API 文档 `03-nodes.md` 和 `05-filesystem.md` 中描述的引用验证机制一致。

---

## 2. 设计决策总结

以下是经讨论确定的关键设计决策：

| # | 决策 | 理由 |
|---|------|------|
| D1 | **Owner 是 Delegate Token（或 User），不是 Access Token** | Access Token 是临时的一次性使用凭证。产出 node 时，用 Access Token 的 issuer（即签发它的 Delegate Token）作为 owner，这样 ownership 在 token 体系中更稳定 |
| D2 | **永不删除 Delegate Token 记录** | 即使 DT 过期也保留，作为历史持有记录。DT 签发频率低，全量保留无压力。同时解决了"Token 被 TTL 删除后无法验证归属"的问题 |
| D3 | **Ownership 是 PUT 记录（多重 own）** | 任何 Token 上传过某 node 就产生对该 node 的 ownership。同一 node 可被多个 Token own。不再是后写覆盖，而是追加式记录 |
| D4 | **prepare-nodes 区分"已存在但未 own"** | 如果一个 node 已存在于 CAS 中但未被当前 Token own 过，仍需重新上传（当前阶段牺牲效率换安全性）。未来可通过 challenge 机制优化 |
| D5 | **授权优先看 proof** | proof（scope 验证）是 Token 访问非自己 own 的节点的唯一方式。与 `03-nodes.md` 和 `05-filesystem.md` 中的引用验证设计一致 |
| D6 | **Depot 的 owner 逻辑也改为 DT** | Depot 的 creatorIssuerId 已经是 DT 概念，与此一致 |

---

## 3. Ownership 模型重设计

### 3.1 从"单一 Owner"到"PUT 记录"

**旧模型**：

```typescript
// 每个节点只有一条 ownership 记录，后写覆盖
type CasOwnership = {
  realm: string;
  key: string;           // node storage key (CB32)
  createdBy: string;     // 最后一个上传者的 tokenId（Access Token ID）
  createdAt: number;
  kind?: NodeKind;
  size: number;
};
```

**新模型**：

```typescript
// 每次 PUT 产生一条记录，同一 node 可有多条
type CasOwnership = {
  realm: string;
  key: string;           // node storage key (CB32)
  ownerId: string;       // Delegate Token ID 或 User ID（不再是 Access Token ID）
  createdAt: number;     // 本次 PUT 的时间
  kind?: NodeKind;
  size: number;
};
```

**关键变化**：

| 方面 | 旧 | 新 |
|------|----|----|
| 记录者 | Access Token ID | Delegate Token ID（AT 的 issuer） |
| 记录数 | 1 per node per realm（覆盖写） | N per node per realm（追加写） |
| DDB Sort Key | `OWN#{cb32_key}` | `OWN#{cb32_key}##{ownerId}` |
| 含义 | "谁最后上传了这个节点" | "哪些 Token（的 issuer）上传过这个节点" |

### 3.2 为什么用 Delegate Token 而非 Access Token

```
User (usr_abc)
  └── DT-A (dlt1_aaa)              ← depth 0, 长期存在（再授权 Token）
      ├── AT-1 (dlt1_xxx)          ← 短期 Access Token → 上传 node X
      ├── AT-2 (dlt1_yyy)          ← 短期 Access Token → 上传 node Y
      └── DT-B (dlt1_bbb)          ← depth 1 再授权
          └── AT-3 (dlt1_zzz)      ← 短期 Access Token → 想引用 X
```

> **注**：`dlt1_` 前缀是所有 Delegate Token（包括再授权 Token 和 Access Token）的统一前缀，通过 Token 记录的 `tokenType` 字段区分类型。

- 如果 owner 是 AT-1（`dlt1_xxx`），AT-3 无法证明自己有权引用 X——它们是不同的 Access Token
- 如果 owner 是 DT-A（`dlt1_aaa`），AT-3 的 issuerChain 包含 `dlt1_aaa`，可以通过 uploader 验证
- DT 是持久的（D2: 永不删除），AT 是临时的——用 DT 做 owner 更稳定

**推导公式**：`ownerId = auth.tokenRecord.issuerId`（Access Token 的 issuer 字段，即签发它的 DT 或 User ID）

### 3.3 Delegate Token 永不删除

**当前**：DelegateTokenRecord 有 DynamoDB TTL（`ttl` 字段 = `expiresAt` 秒），过期后被 DynamoDB 自动删除。

**改为**：
- DT 记录创建时**不设置 `ttl` 属性**（DynamoDB TTL 只删除有 `ttl` 属性且值已过去的 item，没有该属性的 item 不受影响）
- DDB 表级的 `TimeToLiveSpecification` 保持不变（其他记录如 Ticket、Audit 仍依赖 TTL 自动清理）
- DT 仍然有 `expiresAt` 和 `revokedAt`，用于鉴权时判断是否有效
- 过期/撤销的 DT 不再能签发子 Token 或用于认证，但作为历史记录存在
- 对于 uploader 验证，我们只需知道"这个 ownerId 对应的 Token 属于哪个用户"，过期与否不影响

**空间影响**：DT 签发频率远低于 AT（一个 DT 可签发成百上千个 AT），全量保留 DT 记录的存储开销极小。

### 3.4 DDB Schema 变更

```
旧 Sort Key: OWN#{cb32_key}
新 Sort Key: OWN#{cb32_key}##{ownerId}

旧查询: getOwnership(realm, cb32Key) → 一条记录
新查询:
  - hasOwnershipByToken(realm, cb32Key, ownerId) → boolean
  - listOwners(realm, cb32Key) → ownerId[]
  - hasAnyOwnership(realm, cb32Key) → boolean （用于 prepare-nodes）
```

`addOwnership` 使用简单 `PutItem`（无 ConditionExpression）：因为 SK 已包含 ownerId，同一 owner 重复 PUT 同一 node 会覆盖自己的记录（`createdAt` 更新为最新时间），不影响其他 owner 的记录。如果需要保留首次 PUT 时间，可改用 `ConditionExpression: attribute_not_exists(sk)` 来防止覆盖——但对于 ownership 验证场景，只需判断记录是否存在，`createdAt` 精确值不重要，简单 Put 即可。

---

## 4. 引用验证机制

### 4.1 验证流程

与 API 文档（`03-nodes.md` §子节点引用验证 和 `05-filesystem.md` §引用验证）保持一致：

```
对于每个 child 引用:
  1. uploader 验证：child 的 ownerId 列表中是否包含当前 Token 的 issuer chain 中的任意一个？
     - 令 uploaderIds = ownership records for this child
     - 令 myFamily = [...auth.issuerChain, auth.tokenRecord.issuerId]
       （注：issuerChain 是从 root user 到父 Token 的链，再加上当前 AT 的 issuerId（即签发它的 DT 或 User），
        这就是所有可能作为 ownerId 出现的 ID 集合）
     - 如果 uploaderIds ∩ myFamily ≠ ∅ → ✓ 通过
  2. scope 验证（仅在 uploader 验证失败时）：
     - 客户端是否提供了 proof（index-path）？
     - proof 是否有效（child 确实在 Token scope 树内）？
     - 如果是 → ✓ 通过
  3. 都不满足 → ✗ 拒绝（CHILD_NOT_AUTHORIZED）
```

### 4.2 uploader 验证的高效实现

由于 ownerId 就是 DT ID 或 User ID，而当前 Token 的 `issuerChain` 也是 DT ID 和 User ID 的列表，判定逻辑简化为：

```typescript
async function isUploaderAuthorized(
  realm: string,
  childKey: string,
  issuerChain: string[], // 当前 AT 的 issuerChain（包含 userId 和所有祖先 DT）
  issuerId: string,      // 当前 AT 的 issuerId（签发它的 DT ID 或 User ID）
  ownershipDb: OwnershipDb,
): Promise<boolean> {
  // 快速路径：检查 issuerChain + issuerId 中的每个 ID 是否 own 过此 child
  // myFamily 的典型长度 2~4，非常短
  const myFamily = [...issuerChain, issuerId];
  for (const id of myFamily) {
    if (await ownershipDb.hasOwnershipByToken(realm, childKey, id)) {
      return true;
    }
  }
  return false;
}
```

> **性能优化**：`hasOwnershipByToken` 是一次 DDB GetItem（精确查询 PK=realm, SK=`OWN#{key}##{ownerId}`），成本极低。myFamily 通常 2~4 个 ID，最差情况 5 次 GetItem。
>
> **替代方案**：也可以用一次 DDB Query（`begins_with(SK, "OWN#{key}##")`）取出该 child 的所有 owner，然后在内存中与 myFamily 做交集。由于每个节点的 owner 数量通常很少（1~5），一次 Query 的总开销可能低于多次 GetItem。在 children 数量较多时尤其推荐此方案。

### 4.3 scope 验证（proof）

Proof 机制是 Token 访问非自己 own 的节点的**唯一**方式。

**在 PUT Node 中**：通过 request header 提供 proof：

```http
PUT /api/realm/{realmId}/nodes/node:abc123...
Authorization: Bearer {access_token}
Content-Type: application/octet-stream
X-CAS-Child-Proofs: nod_XXXXXX=0:1:2,nod_YYYYYY=0:3

(二进制数据)
```

`X-CAS-Child-Proofs` Header 格式：逗号分隔的 `nod_key=indexPath` 对（key 使用 `nod_` 前缀的 CB32 格式）。服务端对每个需要 proof 的 child，验证 index-path 指向的节点确实是该 child。

> **Header 大小限制**：HTTP Header 通常受 server/proxy 限制（8KB~16KB）。实践中，绝大多数 children 应通过 uploader 验证通过，需要 proof 的应该极少。如果某个场景下需要大量 proof，客户端应优先通过重新 PUT 获取 ownership，而非全部走 proof。

**在 rewrite link 中**：已有 `proof` 字段，但当前未验证。改为实际执行 scope 验证：

```typescript
// 旧：proof 存在即跳过检查（不安全）
if (!entry.proof) {
  return fsError("LINK_NOT_AUTHORIZED", 403, ...);
}
// TODO: validate proof against scope

// 新：proof 必须实际验证
if (!entry.proof) {
  return fsError("LINK_NOT_AUTHORIZED", 403, ...);
}
const isInScope = await validateProofAgainstScope(entry.proof, linkStorageKey, auth, deps);
if (!isInScope) {
  return fsError("LINK_NOT_AUTHORIZED", 403, "Invalid proof: node is not at the specified index-path");
}
```

### 4.4 Proof 验证的实现

Proof 是一个 index-path（如 `0:1:2`），含义是：从 Token 的 scope 根开始，按索引依次访问子节点，最终到达目标节点。

**Scope 的两种形态**（参见 `delegate-token-refactor/05-data-model.md` §2.2）：

| Token 记录字段 | 含义 | proof 格式 |
|---|---|---|
| `scopeNodeHash` 有值 | 单 scope，直接指向一个 CAS 节点 hash | `0:1:2`（第一个 index 是该节点的 child index） |
| `scopeSetNodeId` 有值 | 多 scope，指向 DB 中的 ScopeSetNode 记录 | `0:1:2`（第一个 index 选择 set-node 的第几个 child，后续 index 在 CAS 中遍历） |

```typescript
async function validateProofAgainstScope(
  proof: string,              // "0:1:2" 格式
  targetStorageKey: string,   // 要验证的目标节点 storage key (CB32)
  auth: AccessTokenAuthContext,
  deps: { storage: StorageProvider, scopeSetNodesDb: ScopeSetNodesDb },
): Promise<boolean> {
  // 1. 解析 proof 为 index 数组
  const indices = proof.split(":").map(Number);
  if (indices.length === 0 || indices.some(i => !Number.isInteger(i) || i < 0)) {
    return false;
  }
  
  // 2. 根据 scope 形态获取起始节点
  let currentHash: string;
  let pathStart: number;
  
  const tokenRecord = auth.tokenRecord;
  
  if (tokenRecord.scopeNodeHash) {
    // 单 scope：直接是 CAS 节点 hash，proof 从该节点的 children 开始遍历
    currentHash = tokenRecord.scopeNodeHash;
    pathStart = 0;
  } else if (tokenRecord.scopeSetNodeId) {
    // 多 scope：从 DB 中的 ScopeSetNode 获取 children 列表
    const setNode = await deps.scopeSetNodesDb.get(tokenRecord.scopeSetNodeId);
    if (!setNode) return false;
    
    // indices[0] 选择 set-node 的第几个 child（即哪个 scope root）
    if (indices[0] >= setNode.children.length) return false;
    currentHash = setNode.children[indices[0]];
    pathStart = 1;
  } else {
    return false; // 无 scope（只写 Token），不支持 proof
  }
  
  // 3. 按 index-path 逐层在 CAS 中遍历
  for (let i = pathStart; i < indices.length; i++) {
    const nodeData = await deps.storage.get(currentHash);
    if (!nodeData) return false;
    const node = decodeNode(nodeData);
    if (!node.children || indices[i] >= node.children.length) return false;
    currentHash = hashToStorageKey(node.children[indices[i]]);
  }
  
  // 4. 最终节点是否等于目标
  return currentHash === targetStorageKey;
}
```

---

## 5. prepare-nodes 流程变更

### 5.1 问题

当前 `prepare-nodes` 只检查节点是否存在于 CAS 中：

```
客户端: POST /nodes/prepare { keys: [A, B, C] }
服务端: { missing: [A], exists: [B, C] }   // B, C 已存在，不用上传
客户端: PUT A                                // 只上传 A
```

但 B 和 C 虽然存在，可能**不被当前 Token own**。在新模型下，如果当前 Token 从未上传过 B，它就没有 B 的 ownership，无法在后续 PUT parent-node 时通过 uploader 验证。

### 5.2 方案：三分类返回

```typescript
// 新的 prepare-nodes 响应
type PrepareNodesResponse = {
  missing: string[];     // 不存在，需要上传
  owned: string[];       // 存在且被当前 Token（的 issuer chain）own → 无需上传
  unowned: string[];     // 存在但未被当前 Token own → 需要重新上传以获取 ownership
};
```

**判定逻辑**：

```
对于每个 key:
  如果 node 不存在 → missing
  如果 node 存在:
    检查 ownership 列表中是否有当前 Token 的 issuer chain 中的 ID
    如果有 → owned（已 own，无需上传）
    如果没有 → unowned（存在但未 own）
```

客户端需要上传 `missing` 和 `unowned` 中的所有节点。

### 5.3 当前阶段：简单做法

客户端重新上传 `unowned` 节点。虽然服务端已有该节点数据（存储上不会增加空间），但 PUT 操作会创建新的 ownership 记录。

**开销分析**：
- 网络：需要重新传输节点二进制数据（大多是 d-node 和 s-node，通常较小）
- 存储：PUT 操作中 `storage.put` 是幂等覆盖，不增加空间
- 计算：hash 验证、格式校验的 CPU 开销
- DDB：新增 ownership 记录写入

### 5.4 未来优化：Challenge 机制

为避免重传大节点（尤其是 f-node/s-node 数据块），可引入 challenge：

```
1. 客户端: POST /nodes/prepare { keys: [A, B, C] }
2. 服务端: { missing: [A], owned: [B], unowned: [C], challenge: "random_256bit" }
3. 客户端: 对于 unowned 的 C:
   - 读取 C 的原始节点数据
   - 计算 challenge_hash = blake3(challenge_bytes + node_bytes)
   - POST /nodes/claim { key: C, proof: challenge_hash }
4. 服务端: 
   - 取出 C 的存储数据
   - 验证 blake3(challenge_bytes + stored_data) === challenge_hash
   - 如果一致 → 说明客户端确实持有 C 的完整数据 → 添加 ownership
```

这证明了客户端确实拥有节点内容（而非只知道 hash），从而在不重传数据的前提下安全地授予 ownership。

> **注**：此优化非当前阶段必须，可在后续版本实现。

---

## 6. 方案设计

### 6.1 涉及变更

| # | 位置 | 变更 | 优先级 |
|---|------|------|--------|
| A | `db/ownership.ts` | Schema 改为多 owner（Sort Key 变更），新增 `hasOwnershipByToken`、`listOwners` 方法 | P0 |
| B | `db/delegate-tokens.ts` | 移除 DDB TTL，DT 记录永久保留 | P0 |
| C | `controllers/chunks.ts` (PUT handler) | owner 改为 `auth.tokenRecord.issuerId`；添加 children 引用验证 | P0 |
| D | `controllers/chunks.ts` (prepare handler) | 返回 `missing` / `owned` / `unowned` 三分类 | P0 |
| E | `services/fs/write-ops.ts` (rewrite link) | uploader 验证改用新 ownership 模型 + 实现 proof 验证 | P1 |
| F | `controllers/depots.ts` (PATCH root) | root 引用验证对齐新 ownership 模型 | P1 |
| G | `util/scope-proof.ts` (新) | scope proof 验证工具函数 | P1 |
| H | `@casfa/protocol` | `PrepareNodesResponse` schema 新增 `owned` / `unowned` 字段 | P0 |

### 6.2 A: Ownership DB 改造

```typescript
// db/ownership.ts

// DDB Schema 变更
// 旧 SK: OWN#{cb32_key}
// 新 SK: OWN#{cb32_key}##{ownerId}

// 新增方法
async hasOwnershipByToken(realm: string, key: string, ownerId: string): Promise<boolean>;
async listOwners(realm: string, key: string): Promise<string[]>;

// 改造方法
// addOwnership: 
//   参数 createdBy → ownerId
//   ownerId = auth.tokenRecord.issuerId（DT ID 或 User ID）
//   SK 改为 OWN#{key}##{ownerId}
//   同一 ownerId 重复 PUT 同一 node 幂等覆盖（自然行为，SK 相同）

// hasOwnership(realm, cb32Key): 
//   改为 begins_with(SK, "OWN#{cb32_key}##") query limit 1
//   含义从"有没有 owner"不变

// getOwnership(realm, key):
//   可能返回多条，改为 getFirstOwnership 或 listOwners
```

### 6.3 B: Delegate Token 永久保留

```typescript
// db/delegate-tokens.ts

// create 方法：DT 记录不再设置 ttl 属性
// （DynamoDB TTL 只删除有 ttl 属性且值已过去的 item，不设置则不会被自动删除）
// 其他鉴权逻辑（isValid check）仍看 expiresAt 和 revokedAt，不受影响

// 注意：已有的带 ttl 属性的记录，DynamoDB 仍会在过期后删除
// 由于系统尚未正式上线，可直接清空重建（参见 §7.3 数据迁移）
```

### 6.4 C: PUT Node 引用验证

在 `can_upload` 权限检查和 `validateNode` 成功后、quota 检查前插入：

> **执行顺序**：引用验证应在 `can_upload` 检查**之后**——如果 Token 没有上传权限，根本不需要做引用验证。

```typescript
// controllers/chunks.ts, put handler

const childKeys = validationResult.childKeys ?? [];
const ownerId = auth.tokenRecord.issuerId; // DT ID 或 User ID

if (childKeys.length > 0) {
  const myFamily = [...auth.issuerChain, auth.tokenRecord.issuerId];
  const unauthorized: string[] = [];
  
  for (const childKey of childKeys) {
    // Step 1: uploader 验证
    let authorized = false;
    for (const id of myFamily) {
      if (await ownershipDb.hasOwnershipByToken(realm, childKey, id)) {
        authorized = true;
        break;
      }
    }
    
    if (!authorized) {
      // Step 2: scope 验证（proof）
      // 从 X-CAS-Child-Proofs header 中查找该 child 的 proof
      const proof = childProofs.get(childKey);
      if (proof) {
        authorized = await validateProofAgainstScope(proof, childKey, auth, deps);
      }
    }
    
    if (!authorized) {
      unauthorized.push(childKey);
    }
  }
  
  if (unauthorized.length > 0) {
    return c.json({
      error: "CHILD_NOT_AUTHORIZED",
      message: "Not authorized to reference these child nodes",
      unauthorized,
    }, 403);
  }
}

// 记录 ownership（用 DT ID，不是 AT ID）
await ownershipDb.addOwnership(
  realm, storageKey, ownerId, "application/octet-stream",
  validationResult.size ?? bytes.length, validationResult.kind
);
```

### 6.5 D: prepare-nodes 三分类

```typescript
// controllers/chunks.ts, prepareNodes handler

const missing: string[] = [];
const owned: string[] = [];
const unowned: string[] = [];
const myFamily = [...auth.issuerChain, auth.tokenRecord.issuerId];

for (const key of keys) {
  const storageKey = toStorageKey(key);
  
  // 先检查节点是否物理存在于存储中
  // （不能只靠 ownership 记录判断——节点可能存在但无 ownership 记录，如系统内部节点或迁移遗留）
  const exists = await storage.has(storageKey);
  if (!exists) {
    missing.push(key);
    continue;
  }
  
  // 节点存在，检查是否被当前 Token 的 family own 过
  let isOwned = false;
  for (const id of myFamily) {
    if (await ownershipDb.hasOwnershipByToken(realm, storageKey, id)) {
      isOwned = true;
      break;
    }
  }
  if (isOwned) {
    owned.push(key);
  } else {
    unowned.push(key);
  }
}

return c.json<PrepareNodesResponse>({ missing, owned, unowned });
```

### 6.6 E: Rewrite Link 引用验证

```typescript
// services/fs/write-ops.ts, rewrite 的 link 处理

} else if ("link" in entry) {
  const linkStorageKey = /* ... */;
  
  // Step 1: uploader 验证
  let authorized = false;
  const myFamily = [...issuerChain, issuerId]; // issuerId = auth.tokenRecord.issuerId
  for (const id of myFamily) {
    if (await ownershipDb.hasOwnershipByToken(realm, linkStorageKey, id)) {
      authorized = true;
      break;
    }
  }
  
  // Step 2: scope 验证（proof）
  if (!authorized && entry.proof) {
    authorized = await validateProofAgainstScope(entry.proof, linkStorageKey, auth, deps);
  }
  
  if (!authorized) {
    return fsError("LINK_NOT_AUTHORIZED", 403,
      "Not authorized to reference node. Upload the node first or provide a valid proof (index-path).",
    );
  }
}
```

**依赖变更**（同旧方案）：
- `FsServiceDeps` 新增 `scopeSetNodesDb`（用于 scope proof 中解析 set-node scope roots）
- rewrite 函数签名新增 `issuerChain: string[]` 和 `issuerId: string` 参数
- `controllers/filesystem.ts` 传递 `auth.issuerChain` 和 `auth.tokenRecord.issuerId`

### 6.7 F: Depot PATCH Root 引用验证

当前 `PATCH /depots/:depotId` 更新 root 时只检查节点存在性，不检查引用权限。按照 `04-depots.md` 文档的设计，应执行同样的引用验证：

```typescript
// controllers/depots.ts, PATCH handler

if (root) {
  // 引用验证
  const myFamily = [...auth.issuerChain, auth.tokenRecord.issuerId];
  let authorized = false;
  for (const id of myFamily) {
    if (await ownershipDb.hasOwnershipByToken(realm, rootStorageKey, id)) {
      authorized = true;
      break;
    }
  }
  // 也可以做 scope 验证（root 节点在 scope 内）
  if (!authorized) {
    return c.json({ error: "ROOT_NOT_AUTHORIZED", message: "..." }, 403);
  }
}
```

---

## 7. 影响范围

### 7.1 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `db/ownership.ts` | **重构** | Sort Key 改为 `OWN#{key}##{ownerId}`，新增 `hasOwnershipByToken`、`listOwners` |
| `db/delegate-tokens.ts` | 修改 | 移除 TTL 设置，DT 永久保留 |
| `util/scope-proof.ts` | **新增** | scope proof 验证工具函数 |
| `util/index.ts` | 修改 | 导出新模块 |
| `controllers/chunks.ts` | 修改 | PUT: ownerId 改用 DT ID + 引用验证；prepare: 三分类 |
| `controllers/depots.ts` | 修改 | PATCH root 添加引用验证 |
| `controllers/filesystem.ts` | 修改 | rewrite 传递 `issuerChain` |
| `services/fs/write-ops.ts` | 修改 | rewrite link 改用新 ownership 模型 + 实现 proof 验证 |
| `services/fs/types.ts` | 修改 | `FsServiceDeps` 可能新增 `delegateTokensDb` |
| `app.ts` | 修改 | 传递 `delegateTokensDb` 给需要的 controller/service |
| `@casfa/protocol` | 修改 | `PrepareNodesResponse` 新增 `owned` / `unowned` |

### 7.2 API 行为变化

| 端点 | 变化 |
|------|------|
| `PUT /nodes/:key` | 新增 `CHILD_NOT_AUTHORIZED` 403 错误；ownership 以 DT ID 记录；接受 `X-CAS-Child-Proofs` header |
| `POST /nodes/prepare` | 响应从 `{ missing, exists }` 改为 `{ missing, owned, unowned }` |
| `POST /nodes/:key/fs/rewrite` | link 引用验证改用新 ownership + 实际验证 proof |
| `PATCH /depots/:depotId` | root 更新添加引用验证（新增 `ROOT_NOT_AUTHORIZED` 403） |

### 7.3 数据迁移

> **系统尚未正式上线**（参见 `delegate-token-refactor/05-data-model.md` §6.1），采用**直接替换**策略，无需复杂迁移。

| 项目 | 方案 |
|------|------|
| 已有 ownership 记录 | Sort Key 格式不兼容（旧 `OWN#{key}` vs 新 `OWN#{key}##{ownerId}`），且旧 `createdBy` 是 AT ID（短期 Token，可能已被 TTL 删除，无法反查 issuer）。**直接清空重建**。 |
| 已有 DT 记录的 TTL | 旧 DT 记录带 `ttl` 属性，DynamoDB 会继续删除它们。**直接清空重建**——部署新版本后所有 DT 记录不再设置 `ttl` 属性。 |

### 7.4 性能影响

| 场景 | 额外开销 |
|------|----------|
| 上传叶子节点（无 children） | 无 |
| 上传有 N 个 children，全部自己 own | N × 1 次 `hasOwnershipByToken`（GetItem）；或 N 次 Query（取出 owners 后内存比对） |
| children 由同用户 family 其他 DT own | N × D 次 `hasOwnershipByToken`（D = myFamily 长度，通常 2~4）；或 N 次 Query |
| 需要 scope 验证（proof） | 每个 proof 需要按 index-path 遍历树（每层 1 次 storage.get） |
| prepare-nodes | 每个 key 额外 1 次 `storage.has` + D 次 `hasOwnershipByToken`（或 1 次 Query）来区分 owned/unowned |

### 7.5 客户端影响

| 变化 | 客户端需要做的 |
|------|---------------|
| prepare-nodes 返回 `unowned` | 上传 `missing` + `unowned` 中的所有节点 |
| PUT Node 子节点验证 | 如需引用非自己 own 的 scope 内节点，在 `X-CAS-Child-Proofs` 中提供 proof |
| rewrite link proof | proof 必须是有效的 index-path（不再能随意填写） |

---

## 8. 攻击场景与防御

### 8.1 跨用户节点引用

```
User A 的 Token 上传了 node X (高价值数据)
User B 的 Token 构造 dict-node，children 包含 X 的 hash
PUT /api/realm/{B的realm}/nodes/{dict-hash}
→ uploader 验证：X 的 owner 列表中没有 B 的 family → 失败
→ scope 验证：B 没有 X 的 proof（X 不在 B 的 scope 内） → 失败
→ 结果：✗ 拒绝（CHILD_NOT_AUTHORIZED）
```

### 8.2 同用户跨 Token 引用（合法）

**场景 A：不同 DT 分支**

```
User U (usr_abc)
  ├── DT-A (dlt1_aaa) → AT-1 上传 node X
  │     ownerId = DT-A（因为 AT-1 的 issuerId 是 DT-A）
  └── DT-B (dlt1_bbb) → AT-2 构造引用 X 的 dict-node
        AT-2 的 myFamily = [...issuerChain, issuerId] = [usr_abc, dlt1_bbb]
→ uploader 验证：X 的 ownerId=DT-A，myFamily=[usr_abc, dlt1_bbb] → 不含 DT-A → 失败
→ 回退到 scope 验证 → 如果 X 在 AT-2 的 scope 内 → 客户端提供 proof → ✓ 通过
```

**场景 B：User 直接签发 AT**

```
User U (usr_abc)
  └── AT-direct 上传 node Y
        ownerId = usr_abc（因为 AT-direct 的 issuerId 是 usr_abc）

任何同用户的 Token，其 issuerChain[0] 都是 usr_abc
→ myFamily 必定包含 usr_abc → uploader 验证直接通过 ✓
```

> **注意**：同用户不同 DT 分支下（场景 A），如果不在 scope 内，只能通过 proof。这是**正确的**——scope 本身就是权限边界，不同 DT 的 scope 可能不同。

### 8.3 Rewrite link proof 绕过（已修复）

```
Token A 尝试 rewrite，link 到 Token B 创建的节点
提供 proof: "anything" (任意字符串)
→ 旧：✓ 通过（proof 存在即跳过，不安全）
→ 新：proof 被实际验证 → 如果 index-path 无效 → ✗ 拒绝
```

### 8.4 prepare-nodes 绕过尝试

```
攻击者知道 node X 的 hash（通过某种途径泄漏）
POST /nodes/prepare { keys: ["node:X_hash"] }
→ 响应：{ missing: [], owned: [], unowned: ["node:X_hash"] }
→ 攻击者需要重新 PUT 来获取 ownership
→ 但 PUT 需要完整的节点二进制数据（必须持有内容才能构造正确 hash）
→ hash 泄漏 ≠ 内容泄漏 ✓
```
