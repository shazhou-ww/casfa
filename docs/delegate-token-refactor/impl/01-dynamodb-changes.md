# DynamoDB 修改实现规划

> 版本: 1.0  
> 日期: 2026-02-05  
> 基于: [05-data-model.md](../05-data-model.md)

---

## 目录

1. [概述](#1-概述)
2. [表结构变更总览](#2-表结构变更总览)
3. [主键与 GSI 设计](#3-主键与-gsi-设计)
4. [记录类型详细定义](#4-记录类型详细定义)
5. [数据库操作层实现](#5-数据库操作层实现)
6. [事务处理要求](#6-事务处理要求)
7. [迁移与清理脚本](#7-迁移与清理脚本)
8. [实现步骤](#8-实现步骤)

---

## 1. 概述

### 1.1 变更背景

根据 Delegate Token 重构设计，需要对 DynamoDB 表结构进行以下变更：

| 类型 | 变更 | 说明 |
|------|------|------|
| **重构** | Token 表 | 统一为 DelegateToken 格式，移除 UserToken/AgentToken/Ticket Token |
| **扩展** | Depot 表 | 增加 `creatorIssuerId`、`creatorTokenId` 字段 |
| **重构** | Ticket 表 | 独立存储，简化为工作空间状态，增加 `root` 字段 |
| **新增** | ScopeSetNode 表 | 存储 Token scope 的 set-node，带引用计数 |
| **新增** | TokenAudit 表 | Token 操作审计日志 |
| **新增** | UserQuota 表 | 用户级别配额和使用量 |
| **保留** | TokenUsage 表 | Token 级别配额（Reserved，当前版本不启用） |
| **废弃** | AWP/Client 相关表 | AwpPending、AwpPubkeys、ClientPending、ClientPubkeys |

### 1.2 当前表结构

现有的 `db/` 目录文件：

```
db/
├── awp-pending.ts      # 废弃
├── awp-pubkeys.ts      # 废弃
├── client-pending.ts   # 废弃 → 重构为 TokenRequest
├── client-pubkeys.ts   # 废弃
├── client.ts           # 保留（DynamoDB 客户端）
├── depots.ts           # 扩展
├── index.ts            # 更新导出
├── ownership.ts        # 保留（CAS 节点归属）
├── refcount.ts         # 保留（CAS 节点引用计数）
├── tokens.ts           # 重构
├── usage.ts            # 扩展
└── user-roles.ts       # 保留
```

---

## 2. 表结构变更总览

### 2.1 单表设计

继续采用 DynamoDB 单表设计，通过 PK/SK 前缀区分不同实体类型。

```
表名: casfa-main

主键设计:
  - pk: Partition Key (String)
  - sk: Sort Key (String)
```

### 2.2 实体类型与主键格式

| 实体类型 | PK 格式 | SK 格式 | 说明 |
|----------|---------|---------|------|
| DelegateToken | `TOKEN#{tokenId}` | `METADATA` | Token 元数据 |
| Depot | `REALM#{realm}` | `DEPOT#{depotId}` | Depot 元数据 |
| Ticket | `REALM#{realm}` | `TICKET#{ticketId}` | Ticket 工作空间 |
| ScopeSetNode | `SETNODE#{setNodeId}` | `METADATA` | Scope set-node |
| TokenUsage | `USAGE#{tokenId}` | `AGGREGATE` | Token 使用量（Reserved） |
| UserQuota | `QUOTA#{realm}` | `USER` | 用户配额 |
| TokenAudit | `AUDIT#{tokenId}` | `{timestamp}#{action}` | 审计日志 |
| TokenRequest | `TOKENREQ#{requestId}` | `METADATA` | 客户端授权申请 |

> **说明**：Depot 和 Ticket 使用 `REALM#{realm}` 作为分区键，可直接通过主表按 realm 查询，无需走 GSI。

### 2.3 与现有结构对比

| 现有实体 | PK 格式（旧） | 新实体 | PK + SK 格式（新） |
|----------|---------------|--------|-------------------|
| UserToken | `TOKEN#{id}` + `sk=TOKEN` | - | 废弃 |
| AgentToken | `TOKEN#{id}` + `sk=TOKEN` | DelegateToken | `TOKEN#{id}` + `METADATA` |
| Ticket (Token) | `TOKEN#{id}` + `sk=TOKEN` | Ticket (独立) | `REALM#{realm}` + `TICKET#{id}` |
| - | - | DelegateToken (Access) | `TOKEN#{id}` + `METADATA` |
| Depot | `{realm}` + `key=DEPOT#{id}` | Depot | `REALM#{realm}` + `DEPOT#{id}` |

> **说明**：Depot 和 Ticket 统一使用 `REALM#{realm}` 作为分区键，与 Token/Ticket 查询模式保持一致，可直接通过主表按 realm 查询。

---

## 3. 主键与 GSI 设计

### 3.1 主表键设计

```typescript
// 主表属性
interface TableItem {
  pk: string;   // Partition Key
  sk: string;   // Sort Key
  
  // GSI 键（按需设置）
  gsi1pk?: string;
  gsi1sk?: string;
  gsi2pk?: string;
  gsi2sk?: string;
  gsi3pk?: string;
  gsi3sk?: string;
  gsi4pk?: string;
  gsi4sk?: string;
}
```

### 3.2 GSI 设计

| GSI | 名称 | PK | SK | 投影 | 用途 |
|-----|------|-----|-----|------|------|
| gsi1 | realm-index | `gsi1pk` | `gsi1sk` | ALL* | 按 realm 查询 Token/Ticket |
| gsi2 | issuer-index | `gsi2pk` | `gsi2sk` | ALL* | 按 issuer 查询子 Token（级联撤销） |
| gsi3 | creator-index | `gsi3pk` | `gsi3sk` | ALL* | 按创建者查询 Depot |
| gsi4 | audit-index | `gsi4pk` | `gsi4sk` | KEYS_ONLY | 按日期查询审计日志 |

> *ALL 投影可在后续优化中改为 INCLUDE，参见 [08-remaining-issues.md](../08-remaining-issues.md) R5。

### 3.3 GSI 键值格式

| GSI | 实体类型 | gsiNpk 值 | gsiNsk 值 | 说明 |
|-----|----------|-----------|-----------|------|
| gsi1 | DelegateToken | `REALM#{realm}` | `TOKEN#{tokenId}` | 按 realm 查询 Token |
| gsi2 | DelegateToken | `ISSUER#{issuerId}` | `TOKEN#{tokenId}` | 按签发者查询子 Token（级联撤销） |
| gsi3 | Depot | `CREATOR#{creatorIssuerId}` | `DEPOT#{depotId}` | 按创建者查询 Depot |
| gsi4 | TokenAudit | `AUDIT_DATE#{date}` | `{timestamp}#{tokenId}` | 按日期查询审计日志 |

> **说明**：
> - Depot 和 Ticket 使用主表 `REALM#{realm}` 分区键，可直接查询，不需要 gsi1
> - TokenAudit 的 `{timestamp}` 使用零填充的 13 位数字字符串，确保正确排序

### 3.4 现有 GSI 对比

| 现有 GSI | 用途 | 保留/修改 |
|----------|------|-----------|
| `gsi1` | REALM#realm → TICKET# | 简化：仅用于 Token，Depot/Ticket 直接使用主表 |
| `userId-index` | 按 userId 查询 AgentToken | 废弃，改用 gsi2 (ISSUER#) |

---

## 4. 记录类型详细定义

### 4.1 DelegateTokenRecord

```typescript
/**
 * Delegate Token 数据库记录
 * 
 * 注意：不存储完整 tokenBytes，只存储元数据
 * Token 通过 HTTPS 返回给客户端保管
 */
export type DelegateTokenRecord = {
  // 主键
  pk: string;           // TOKEN#{tokenId}
  sk: string;           // METADATA

  // Token 基本信息
  tokenId: string;      // dlt1_xxx 格式
  tokenType: "delegate" | "access";
  realm: string;        // 32 bytes hash 的 hex 表示
  expiresAt: number;    // Unix epoch ms
  depth: number;        // Token 深度 (0-15)

  // Token 标识信息
  name?: string;              // Token 名称
  description?: string;       // Token 描述

  // 签发信息
  issuerId: string;           // 签发者 ID (hex)
  issuerType: "user" | "token";
  parentTokenId?: string;     // 转签发时的父 Token ID
  issuerChain: string[];      // 预计算的签发链

  // 权限标志
  canUpload: boolean;
  canManageDepot: boolean;
  isUserIssued: boolean;

  // Scope 信息（二选一，互斥）
  // 不变式：必须且仅有一个非空
  scopeNodeHash?: string;     // 单 scope 时的节点 hash (hex)，直接指向单个 CAS 节点
  scopeSetNodeId?: string;    // 多 scope 或 empty-set 时的 set-node ID，指向 ScopeSetNode 记录

  // 状态
  isRevoked: boolean;
  revokedAt?: number;
  revokedBy?: string;

  // 时间戳
  createdAt: number;

  // TTL（DynamoDB 自动删除）
  ttl: number;          // Unix epoch 秒，= expiresAt / 1000

  // GSI 键
  gsi1pk: string;       // REALM#{realm}
  gsi1sk: string;       // TOKEN#{tokenId}
  gsi2pk: string;       // ISSUER#{issuerId}
  gsi2sk: string;       // TOKEN#{tokenId}
};
```

> **Scope 字段设计说明**：
> - `scopeNodeHash`：单 scope 场景下使用，存储 CAS 节点的 hash（hex 格式），避免创建额外的 ScopeSetNode 记录
> - `scopeSetNodeId`：多 scope 或 empty-set 场景下使用，指向 ScopeSetNode 记录
> - 两者互斥，必须且仅有一个非空，通过代码逻辑保证此不变式
> - 这种设计优化了单 scope 场景（最常见）的性能和存储开销

> **Issuer Chain 设计说明**：
> - `issuerChain` 存储从根用户到当前 Token 的完整签发者 ID 链
> - 格式：`[rootUserId, token1IssuerId, token2IssuerId, ...]`（不包含当前 Token 的 issuerId）
> - 签发时预计算：`newIssuerChain = [...parentToken.issuerChain, parentToken.issuerId]`
> - 用途：
>   - 权限继承验证：确保子 Token 权限不超过父 Token
>   - Depot 可见性：Token 可访问其 issuerChain 中任意签发者创建的 Depot
>   - 审计追踪：追溯 Token 的完整授权来源
> - 注意：issuerChain 长度受 Token 深度（depth）限制，最大 16 层（depth 0-15）

### 4.2 DepotRecord

```typescript
/**
 * Depot 数据库记录
 * 
 * 主键设计：使用 REALM#{realm} 分区，可直接按 realm 查询，无需 GSI
 */
export type DepotRecord = {
  // 主键
  pk: string;           // REALM#{realm}
  sk: string;           // DEPOT#{depotId}

  // 基本信息
  realm: string;
  depotId: string;
  name: string;         // Depot 名称（与 API 响应一致）

  // 版本信息
  root: string;         // 当前根节点 hash
  maxHistory: number;
  history: string[];    // 历史根节点列表

  // 创建者追踪
  creatorIssuerId: string;    // 创建该 Depot 的 Token 的 issuer ID
  creatorTokenId: string;     // 创建该 Depot 的 Token ID

  // 时间戳
  createdAt: number;
  updatedAt: number;

  // GSI 键（仅用于按创建者查询）
  gsi3pk: string;       // CREATOR#{creatorIssuerId}
  gsi3sk: string;       // DEPOT#{depotId}
};
```

> **说明**：Depot 使用 `REALM#{realm}` 作为 PK，可直接通过主表按 realm 查询所有 Depot，不再需要 gsi1。

### 4.3 TicketRecord

```typescript
/**
 * Ticket 工作空间记录
 * 
 * 简化设计：权限由关联的 Access Token 承载
 * 主键设计：使用 REALM#{realm} 分区，可直接按 realm 查询，无需 GSI
 * 
 * 注意：expiresAt 不存储在 Ticket 中，查询时从关联的 Access Token 获取
 */
export type TicketRecord = {
  // 主键
  pk: string;           // REALM#{realm}
  sk: string;           // TICKET#{ticketId}

  // 基本信息
  ticketId: string;
  realm: string;
  title: string;

  // 工作空间状态
  status: "pending" | "submitted";
  submittedAt?: number;

  // Submit 输出
  root?: string;        // submit 的输出节点 hash

  // 关联的 Access Token
  accessTokenId: string;

  // 创建信息
  creatorTokenId: string;     // 创建该 Ticket 的再授权 Token ID

  // 时间戳
  createdAt: number;

  // TTL（DynamoDB 自动删除）
  ttl: number;                // Unix epoch 秒，= createdAt / 1000 + 86400（24 小时超时）
};
```

> **说明**：
> - Ticket 使用 `REALM#{realm}` 作为 PK，可直接通过主表按 realm 查询所有 Ticket，不再需要 gsi1。
> - `expiresAt` 不存储在 Ticket 中，API 返回时从关联的 Access Token 获取，保证数据一致性。
> - Ticket 有 24 小时超时，未提交的 Ticket 会被 DynamoDB TTL 自动删除。

### 4.4 ScopeSetNodeRecord

```typescript
/**
 * Scope Set-Node 记录
 * 
 * 存储 Token scope 的 set-node，带引用计数
 */
export type ScopeSetNodeRecord = {
  // 主键
  pk: string;           // SETNODE#{setNodeId}
  sk: string;           // METADATA

  // set-node 数据
  setNodeId: string;    // Blake3-128 hash of children (hex)
  children: string[];   // 子节点 hash 列表（已排序去重，hex）

  // 引用计数
  refCount: number;     // 引用此 set-node 的 Token 数量

  // 时间戳
  createdAt: number;
  lastUpdated: number;
};
```

### 4.5 TokenRequestRecord

```typescript
/**
 * 客户端授权申请记录
 * 
 * 替代现有的 ClientPending
 */
export type TokenRequestRecord = {
  // 主键
  pk: string;           // TOKENREQ#{requestId}
  sk: string;           // METADATA

  // 申请信息
  requestId: string;
  clientName: string;
  clientSecretHash: string;   // Blake3-256 hash of clientSecret

  // 申请状态
  status: "pending" | "approved" | "rejected" | "expired";
  
  // 批准后的配置
  realm?: string;
  tokenType?: "delegate" | "access";
  depth?: number;             // 申请的 Token 深度 (0-15)
  expiresIn?: number;         // Token 有效期（秒）
  canUpload?: boolean;
  canManageDepot?: boolean;
  scope?: string[];           // scope 节点列表
  
  // Token 元数据
  tokenName?: string;         // Token 名称
  tokenDescription?: string;  // Token 描述

  // 加密的 Token（批准后设置）
  encryptedToken?: string;

  // 时间戳
  createdAt: number;
  expiresAt: number;          // 申请的过期时间（毫秒）
  approvedAt?: number;
  approvedBy?: string;        // 批准者的用户 ID
  approverTokenId?: string;   // 批准者使用的 Token ID（若通过 Token 批准）

  // TTL（DynamoDB 自动删除）
  ttl: number;                // Unix epoch 秒，= expiresAt / 1000
};
```

### 4.6 TokenAuditRecord

```typescript
/**
 * Token 审计日志记录
 */
export type TokenAuditRecord = {
  // 主键
  pk: string;           // AUDIT#{tokenId}
  sk: string;           // {timestamp}#{action}

  // 审计信息
  tokenId: string;
  action: "create" | "revoke" | "delegate" | "use";
  actorId: string;      // 执行操作的身份 ID
  actorType: "user" | "token" | "system";
  timestamp: number;

  // 操作详情
  details?: {
    childTokenId?: string;    // delegate 操作产生的子 Token
    resourceType?: string;    // use 操作的资源类型
    resourceId?: string;      // use 操作的资源 ID
    reason?: string;          // revoke 操作的原因
  };

  // GSI 键
  gsi4pk: string;       // AUDIT_DATE#{date}
  gsi4sk: string;       // {timestamp}#{tokenId}

  // TTL（DynamoDB 自动删除）
  ttl: number;          // Unix epoch 秒，= timestamp / 1000 + 90 * 86400（90 天保留期）
};
```

### 4.7 UserQuotaRecord

```typescript
/**
 * 用户配额记录
 * 
 * 存储用户级别的配额限制和使用量统计
 */
export type UserQuotaRecord = {
  // 主键
  pk: string;           // QUOTA#{realm}
  sk: string;           // USER

  // 用户信息
  realm: string;        // realm (userId hash)

  // 配额设置
  quotaLimit: number;   // 总配额（字节）

  // 存储使用量
  bytesUsed: number;          // 已提交的存储使用量
  bytesInProgress: number;    // 进行中的 Ticket 占用（预扣）

  // 资源计数
  tokenCount: number;         // 当前有效 Token 数量
  depotCount: number;         // 当前 Depot 数量
  ticketCount: number;        // 当前活跃 Ticket 数量

  // 时间戳
  createdAt: number;
  lastUpdated: number;
};
```

> **说明**：
> - `bytesInProgress`：Ticket 创建时预扣，提交或过期时释放
> - 资源计数字段用于限制用户创建资源的数量（如最大 Token 数）

### 4.8 TokenUsageRecord (Reserved)

```typescript
/**
 * Token 使用量记录（Reserved，当前版本不启用）
 */
export type TokenUsageRecord = {
  // 主键
  pk: string;           // USAGE#{tokenId}
  sk: string;           // AGGREGATE

  // 使用量
  bytesUsed: number;
  lastUpdated: number;
};
```

---

## 4.9 TTL 设计

DynamoDB 的 Time-To-Live (TTL) 功能用于自动删除过期记录。以下是各记录类型的 TTL 策略：

### TTL 字段设计

| 记录类型 | TTL 字段 | 值说明 | 自动删除行为 |
|----------|----------|--------|--------------|
| DelegateToken | `ttl` | `expiresAt / 1000`（Unix epoch 秒） | 过期后自动删除 |
| Ticket | `ttl` | `createdAt / 1000 + 86400`（24 小时后） | 超时未提交自动删除 |
| TokenRequest | `ttl` | `expiresAt / 1000`（申请过期时间） | 过期后自动删除 |
| TokenAudit | `ttl` | `createdAt / 1000 + 90 * 86400`（90 天） | 保留期后自动删除 |
| ScopeSetNode | - | 无 TTL | 通过引用计数 = 0 时手动删除 |
| Depot | - | 无 TTL | 手动删除 |
| UserQuota | - | 无 TTL | 手动删除 |

### 记录类型定义中添加 TTL 字段

```typescript
// DelegateTokenRecord
export type DelegateTokenRecord = {
  // ... 其他字段 ...
  ttl: number;  // Unix epoch 秒，用于 DynamoDB TTL
};

// TicketRecord
export type TicketRecord = {
  // ... 其他字段 ...
  ttl: number;  // Unix epoch 秒，24 小时超时
};

// TokenRequestRecord
export type TokenRequestRecord = {
  // ... 其他字段 ...
  ttl: number;  // Unix epoch 秒，申请过期时间
};

// TokenAuditRecord
export type TokenAuditRecord = {
  // ... 其他字段 ...
  ttl: number;  // Unix epoch 秒，90 天保留期
};
```

> **注意事项**：
> - DynamoDB TTL 删除是最终一致的，可能有延迟（通常几分钟内）
> - 已撤销的 Token 仍然保留 TTL，到期后自动删除
> - TTL 字段使用 Unix epoch **秒**（不是毫秒），需要将 `expiresAt`（毫秒）除以 1000
> - 创建表时需要启用 TTL 属性：`TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true }`

---

## 5. 数据库操作层实现

### 5.1 文件结构变更

```
db/
├── client.ts              # 保留（DynamoDB 客户端）
├── delegate-tokens.ts     # 新增：DelegateToken 操作
├── depots.ts              # 修改：扩展 Depot 操作
├── index.ts               # 修改：更新导出
├── ownership.ts           # 保留（CAS 节点归属，管理节点与 realm 的关联）
├── refcount.ts            # 保留（CAS 节点引用计数，用于垃圾回收）
├── scope-set-nodes.ts     # 新增：ScopeSetNode 操作
├── tickets.ts             # 新增：独立 Ticket 操作
├── token-audit.ts         # 新增：审计日志操作
├── token-requests.ts      # 新增：授权申请操作（替代 client-pending）
├── usage.ts               # 修改：扩展支持 UserQuota
├── user-roles.ts          # 保留
│
├── [deprecated]/          # 废弃文件（可删除或归档）
│   ├── awp-pending.ts
│   ├── awp-pubkeys.ts
│   ├── client-pending.ts
│   ├── client-pubkeys.ts
│   └── tokens.ts          # 旧 Token 操作
```

> **说明**：
> - `ownership.ts`：管理 CAS 节点与 realm 的归属关系，用于确定节点的所有权
> - `refcount.ts`：管理 CAS 节点的引用计数，用于垃圾回收（与 ScopeSetNode 的引用计数是不同的概念）

### 5.2 delegate-tokens.ts

```typescript
// 新文件：Delegate Token 操作

export type DelegateTokensDb = {
  // 基础 CRUD
  create: (record: Omit<DelegateTokenRecord, 'pk' | 'sk' | 'gsi1pk' | 'gsi1sk' | 'gsi2pk' | 'gsi2sk'>) => Promise<DelegateTokenRecord>;
  get: (tokenId: string) => Promise<DelegateTokenRecord | null>;
  getValid: (tokenId: string) => Promise<DelegateTokenRecord | null>;  // 过滤过期和已撤销
  
  // 撤销
  revoke: (tokenId: string, revokerId: string) => Promise<void>;
  revokeWithCascade: (tokenId: string, revokerId: string) => Promise<number>;  // 返回撤销数量
  
  // 查询
  listByRealm: (realm: string, options?: ListOptions) => Promise<PaginatedResult<DelegateTokenRecord>>;
  listByIssuer: (issuerId: string) => Promise<DelegateTokenRecord[]>;  // 用于级联撤销
  
  // 验证
  validateToken: (tokenBytes: Uint8Array) => Promise<DelegateTokenRecord | null>;
};
```

**关键实现点**：

1. **Token ID 计算**：`tokenId = blake3_128(tokenBytes)` 的 Crockford Base32 编码
2. **issuerChain 预计算**：签发时计算并存储，避免运行时递归查询
3. **级联撤销事务**：使用 `TransactWriteItems`，分批处理超过 100 项的情况

### 5.3 scope-set-nodes.ts

```typescript
// 新文件：ScopeSetNode 操作

export type ScopeSetNodesDb = {
  // 获取或创建
  getOrCreate: (children: string[]) => Promise<ScopeSetNodeRecord>;
  get: (setNodeId: string) => Promise<ScopeSetNodeRecord | null>;
  
  // 引用计数
  incrementRef: (setNodeId: string) => Promise<void>;
  decrementRef: (setNodeId: string) => Promise<void>;
  
  // 清理
  deleteZeroRefNodes: () => Promise<number>;  // 返回删除数量
};
```

**关键实现点**：

1. **set-node ID 计算**：`setNodeId = blake3_128(sortedChildren)` 
2. **empty set-node**：children 为空数组，有固定的 hash 值
3. **原子性**：引用计数增减使用 `ADD` 表达式，无需条件检查

### 5.4 depots.ts 修改

```typescript
// 修改现有文件

export type DepotsDb = {
  // 现有方法（签名调整）
  create: (realm: string, options: CreateDepotOptions & { 
    creatorIssuerId: string; 
    creatorTokenId: string; 
  }) => Promise<DepotRecord>;
  get: (realm: string, depotId: string) => Promise<DepotRecord | null>;
  list: (realm: string, options?: ListOptions) => Promise<PaginatedResult<DepotRecord>>;
  update: (realm: string, depotId: string, updates: Partial<DepotRecord>) => Promise<DepotRecord | null>;
  delete: (realm: string, depotId: string) => Promise<boolean>;
  
  // 新增方法
  listByCreator: (creatorIssuerId: string, options?: ListOptions) => Promise<PaginatedResult<DepotRecord>>;
  listVisibleToToken: (token: DelegateTokenRecord, realm: string, options?: ListOptions) => Promise<PaginatedResult<DepotRecord>>;
  checkAccess: (realm: string, depotId: string, tokenIssuerChain: string[]) => Promise<boolean>;
};
```

**主要变更**：

1. **主键格式**：改为 `REALM#{realm}` + `DEPOT#{depotId}`，与 Ticket 保持一致
2. **字段重命名**：`title` → `name`（与 API 响应一致）
3. **新增字段**：`creatorIssuerId`、`creatorTokenId`、`gsi3pk`、`gsi3sk`
4. **移除 gsi1**：主表已按 realm 分区，可直接查询，不再需要 gsi1pk/gsi1sk

### 5.5 tickets.ts

```typescript
// 新文件：独立 Ticket 操作

export type TicketsDb = {
  // 基础 CRUD
  create: (record: Omit<TicketRecord, 'pk' | 'sk'>) => Promise<TicketRecord>;
  get: (realm: string, ticketId: string) => Promise<TicketRecord | null>;
  
  // 状态更新
  submit: (realm: string, ticketId: string, root: string) => Promise<TicketRecord | null>;
  
  // 查询（直接查询主表，无需 GSI）
  listByRealm: (realm: string, options?: ListOptions & { status?: string }) => Promise<PaginatedResult<TicketRecord>>;
  listByCreator: (creatorTokenId: string, realm: string, options?: ListOptions) => Promise<PaginatedResult<TicketRecord>>;
  
  // 删除（用于过期清理）
  delete: (realm: string, ticketId: string) => Promise<boolean>;
};
```

> **说明**：Ticket 主键为 `REALM#{realm}` + `TICKET#{ticketId}`，可直接按 realm 查询，不需要 gsi1。

### 5.6 token-requests.ts

```typescript
// 新文件：客户端授权申请操作

export type TokenRequestsDb = {
  create: (record: Omit<TokenRequestRecord, 'pk' | 'sk'>) => Promise<TokenRequestRecord>;
  get: (requestId: string) => Promise<TokenRequestRecord | null>;
  
  approve: (requestId: string, approver: string, config: ApproveConfig) => Promise<TokenRequestRecord | null>;
  reject: (requestId: string) => Promise<boolean>;
  
  setEncryptedToken: (requestId: string, encryptedToken: string) => Promise<void>;
  
  // 清理过期申请
  cleanupExpired: () => Promise<number>;
};
```

---

## 6. 事务处理要求

### 6.1 需要事务的操作

| 操作 | 涉及的表/记录 | 事务项 |
|------|---------------|--------|
| 创建 Token | DelegateToken + ScopeSetNode | Put Token + Update refCount |
| 撤销 Token（级联） | 多个 DelegateToken + ScopeSetNode | 多个 Update isRevoked + Update refCount |
| 创建 Ticket | Ticket + DelegateToken | Put Ticket + Put AccessToken + Update refCount |
| Submit Ticket | Ticket + RefCount | Update Ticket + Update refCount |

### 6.2 事务实现模式

```typescript
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";

async function createTokenWithTransaction(
  tokenRecord: DelegateTokenRecord,
  setNodeId?: string
): Promise<void> {
  const transactItems: TransactWriteItem[] = [
    {
      Put: {
        TableName: TABLE_NAME,
        Item: tokenRecord,
        ConditionExpression: "attribute_not_exists(pk)",
      },
    },
  ];

  if (setNodeId) {
    transactItems.push({
      Update: {
        TableName: TABLE_NAME,
        Key: { pk: `SETNODE#${setNodeId}`, sk: "METADATA" },
        UpdateExpression: "ADD refCount :inc SET lastUpdated = :now",
        ExpressionAttributeValues: { ":inc": 1, ":now": Date.now() },
      },
    });
  }

  await client.send(new TransactWriteCommand({ TransactItems: transactItems }));
}
```

### 6.3 批量事务处理

DynamoDB 事务最多支持 100 个操作项。对于级联撤销等可能超过限制的操作：

```typescript
async function executeTransactWriteInBatches(
  items: TransactWriteItem[],
  batchSize: number = 100
): Promise<void> {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await client.send(new TransactWriteCommand({ TransactItems: batch }));
  }
}
```

> **注意**：分批事务不具备原子性。对于关键操作（如级联撤销），应考虑实现补偿逻辑或状态机。

### 6.4 级联撤销的一致性保证

级联撤销可能涉及大量 Token，需要特殊处理以保证一致性：

#### 设计原则

1. **先标记后处理**：先标记父 Token 为已撤销，再异步处理子 Token
2. **验证时检查 issuerChain**：验证 Token 时，除了检查自身 isRevoked，还要检查 issuerChain 中是否有已撤销的 Token
3. **幂等性**：撤销操作必须幂等，重复执行不会产生错误

#### 实现方案

```typescript
/**
 * 级联撤销 Token
 * 
 * 策略：
 * 1. 立即标记目标 Token 为已撤销（单条事务，保证原子性）
 * 2. 查询所有子 Token（通过 gsi2）
 * 3. 分批标记子 Token（可能失败，但不影响安全性）
 * 
 * 安全性保证：
 * - Token 验证时会检查 issuerChain 中是否有已撤销的祖先
 * - 即使子 Token 标记失败，它们也无法通过验证
 */
async function revokeTokenCascade(
  tokenId: string,
  revokedBy: string,
  reason?: string
): Promise<{ revokedCount: number; errors: string[] }> {
  const now = Date.now();
  const errors: string[] = [];
  
  // Step 1: 立即标记目标 Token（原子操作）
  await client.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { pk: `TOKEN#${tokenId}`, sk: "METADATA" },
    UpdateExpression: "SET isRevoked = :true, revokedAt = :now, revokedBy = :by",
    ConditionExpression: "isRevoked = :false",
    ExpressionAttributeValues: {
      ":true": true,
      ":false": false,
      ":now": now,
      ":by": revokedBy,
    },
  }));
  
  // Step 2: 收集所有需要撤销的子 Token
  const childTokenIds = await collectAllChildren(tokenId);
  
  // Step 3: 分批标记子 Token
  const batches = chunk(childTokenIds, 25); // 使用较小批次减少事务冲突
  let revokedCount = 1; // 包含目标 Token
  
  for (const batch of batches) {
    try {
      const items = batch.map(id => ({
        Update: {
          TableName: TABLE_NAME,
          Key: { pk: `TOKEN#${id}`, sk: "METADATA" },
          UpdateExpression: "SET isRevoked = :true, revokedAt = :now, revokedBy = :by",
          ExpressionAttributeValues: {
            ":true": true,
            ":now": now,
            ":by": `cascade:${tokenId}`,
          },
        },
      }));
      
      await client.send(new TransactWriteCommand({ TransactItems: items }));
      revokedCount += batch.length;
    } catch (error) {
      // 记录错误但继续处理
      errors.push(`Batch failed: ${batch.join(", ")}`);
    }
  }
  
  return { revokedCount, errors };
}

/**
 * 递归收集所有子 Token
 * 
 * 使用 BFS 遍历，避免深度递归导致栈溢出
 */
async function collectAllChildren(tokenId: string): Promise<string[]> {
  const allChildren: string[] = [];
  const queue: string[] = [tokenId];
  
  while (queue.length > 0) {
    const current = queue.shift()!;
    
    // 查询直接子 Token
    const result = await client.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "gsi2",
      KeyConditionExpression: "gsi2pk = :pk",
      ExpressionAttributeValues: {
        ":pk": `ISSUER#${current}`,
      },
      ProjectionExpression: "tokenId",
    }));
    
    for (const item of result.Items || []) {
      const childId = item.tokenId;
      allChildren.push(childId);
      queue.push(childId); // 继续查询子 Token 的子 Token
    }
  }
  
  return allChildren;
}
```

#### 验证时的 issuerChain 检查

```typescript
/**
 * 验证 Token 是否有效
 * 
 * 除了检查自身状态，还需要检查 issuerChain 中是否有已撤销的祖先
 */
async function validateToken(tokenId: string): Promise<TokenValidationResult> {
  // 获取 Token
  const token = await delegateTokensDb.get(tokenId);
  if (!token) {
    return { valid: false, reason: "token_not_found" };
  }
  
  // 检查自身状态
  if (token.isRevoked) {
    return { valid: false, reason: "token_revoked" };
  }
  if (token.expiresAt < Date.now()) {
    return { valid: false, reason: "token_expired" };
  }
  
  // 检查 issuerChain 中的祖先 Token 是否被撤销
  // 注意：issuerChain[0] 是用户 ID，不是 Token ID，从 issuerChain[1] 开始检查
  // 但在当前设计中，issuerChain 存储的是 issuerId（可能是用户 ID 或 Token ID）
  // 需要通过 issuerType 判断
  for (let i = 1; i < token.issuerChain.length; i++) {
    const ancestorId = token.issuerChain[i];
    // 如果这是一个 Token ID（以 dlt1_ 开头）
    if (ancestorId.startsWith("dlt1_")) {
      const ancestor = await delegateTokensDb.get(ancestorId);
      if (ancestor?.isRevoked) {
        return { valid: false, reason: "ancestor_revoked", ancestorId };
      }
    }
  }
  
  return { valid: true, token };
}
```

> **优化提示**：
> - 对于性能敏感的验证场景，可以缓存 Token 的有效性状态
> - 可以使用 BatchGetItem 批量获取祖先 Token，减少网络往返
> - 考虑在 Token 记录中添加 `ancestorRevokedAt` 字段，撤销时更新所有后代

---

## 7. 迁移与清理脚本

### 7.1 表结构更新脚本

由于系统尚未正式上线，采用清理并重建的策略：

```typescript
// scripts/migrate-to-delegate-token.ts

import { CreateTableCommand, DeleteTableCommand } from "@aws-sdk/client-dynamodb";

async function migrateTable(): Promise<void> {
  const TABLE_NAME = process.env.DYNAMODB_TABLE ?? "casfa-main-dev";
  
  console.log(`Migrating table: ${TABLE_NAME}`);
  
  // 1. 备份现有数据（可选，开发环境可跳过）
  // await backupTable(TABLE_NAME);
  
  // 2. 删除现有表
  console.log("Deleting existing table...");
  try {
    await dynamodb.send(new DeleteTableCommand({ TableName: TABLE_NAME }));
    await waitForTableDeletion(TABLE_NAME);
  } catch (e) {
    // 表可能不存在
  }
  
  // 3. 创建新表
  console.log("Creating new table with updated schema...");
  await dynamodb.send(new CreateTableCommand({
    TableName: TABLE_NAME,
    KeySchema: [
      { AttributeName: "pk", KeyType: "HASH" },
      { AttributeName: "sk", KeyType: "RANGE" },
    ],
    AttributeDefinitions: [
      { AttributeName: "pk", AttributeType: "S" },
      { AttributeName: "sk", AttributeType: "S" },
      { AttributeName: "gsi1pk", AttributeType: "S" },
      { AttributeName: "gsi1sk", AttributeType: "S" },
      { AttributeName: "gsi2pk", AttributeType: "S" },
      { AttributeName: "gsi2sk", AttributeType: "S" },
      { AttributeName: "gsi3pk", AttributeType: "S" },
      { AttributeName: "gsi3sk", AttributeType: "S" },
      { AttributeName: "gsi4pk", AttributeType: "S" },
      { AttributeName: "gsi4sk", AttributeType: "S" },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: "gsi1",
        KeySchema: [
          { AttributeName: "gsi1pk", KeyType: "HASH" },
          { AttributeName: "gsi1sk", KeyType: "RANGE" },
        ],
        Projection: { ProjectionType: "ALL" },
      },
      {
        IndexName: "gsi2",
        KeySchema: [
          { AttributeName: "gsi2pk", KeyType: "HASH" },
          { AttributeName: "gsi2sk", KeyType: "RANGE" },
        ],
        Projection: { ProjectionType: "ALL" },
      },
      {
        IndexName: "gsi3",
        KeySchema: [
          { AttributeName: "gsi3pk", KeyType: "HASH" },
          { AttributeName: "gsi3sk", KeyType: "RANGE" },
        ],
        Projection: { ProjectionType: "ALL" },
      },
      {
        IndexName: "gsi4",
        KeySchema: [
          { AttributeName: "gsi4pk", KeyType: "HASH" },
          { AttributeName: "gsi4sk", KeyType: "RANGE" },
        ],
        Projection: { ProjectionType: "KEYS_ONLY" },
      },
    ],
    BillingMode: "PAY_PER_REQUEST",
  }));
  
  await waitForTableActive(TABLE_NAME);
  console.log("Migration completed!");
}
```

### 7.2 本地开发表创建

更新 `scripts/create-local-tables.ts`：

```typescript
// 更新本地表创建脚本

const tableDefinition = {
  TableName: "casfa-local",
  KeySchema: [
    { AttributeName: "pk", KeyType: "HASH" },
    { AttributeName: "sk", KeyType: "RANGE" },
  ],
  // ... 完整定义同上
};
```

### 7.3 清理废弃数据

```typescript
// scripts/cleanup-legacy-data.ts

async function cleanupLegacyData(): Promise<void> {
  // 清理旧 Token 格式数据
  await deleteItemsByPrefix("TOKEN#", (item) => {
    // 保留新格式（sk = METADATA），删除旧格式（sk = TOKEN）
    return item.sk === "TOKEN";
  });
  
  // 清理 AWP 相关数据
  await deleteItemsByPrefix("AWP#");
  await deleteItemsByPrefix("CLIENT#");
}
```

---

## 8. 实现步骤

### 8.1 Phase 1: 基础设施

| 步骤 | 任务 | 文件 | 估计复杂度 |
|------|------|------|------------|
| 1.1 | 定义新的类型 | `src/types/delegate-token.ts` | 低 |
| 1.2 | 更新表定义脚本 | `scripts/create-local-tables.ts` | 低 |
| 1.3 | 创建迁移脚本 | `scripts/migrate-to-delegate-token.ts` | 中 |

### 8.2 Phase 2: 数据库操作层

| 步骤 | 任务 | 文件 | 估计复杂度 |
|------|------|------|------------|
| 2.1 | 实现 ScopeSetNodesDb | `db/scope-set-nodes.ts` | 中 |
| 2.2 | 实现 DelegateTokensDb | `db/delegate-tokens.ts` | 高 |
| 2.3 | 修改 DepotsDb | `db/depots.ts` | 中 |
| 2.4 | 实现 TicketsDb | `db/tickets.ts` | 中 |
| 2.5 | 实现 TokenRequestsDb | `db/token-requests.ts` | 中 |
| 2.6 | 实现 TokenAuditDb | `db/token-audit.ts` | 低 |
| 2.7 | 扩展 UsageDb（UserQuota） | `db/usage.ts` | 低 |
| 2.8 | 更新导出 | `db/index.ts` | 低 |

### 8.3 Phase 3: 测试

| 步骤 | 任务 | 文件 | 估计复杂度 |
|------|------|------|------------|
| 3.1 | 单元测试 | `tests/db/*.test.ts` | 中 |
| 3.2 | 事务测试 | `tests/db/transactions.test.ts` | 中 |
| 3.3 | 集成测试 | `e2e/delegate-tokens.test.ts` | 高 |

### 8.4 Phase 4: 清理

| 步骤 | 任务 | 文件 | 估计复杂度 |
|------|------|------|------------|
| 4.1 | 归档废弃文件 | `db/[deprecated]/*` | 低 |
| 4.2 | 删除旧 Token 引用 | 全局搜索替换 | 中 |
| 4.3 | 更新文档 | `README.md` 等 | 低 |

---

## 附录 A: 键值计算工具函数

```typescript
// utils/db-keys.ts

/** Token 主键 */
export const toTokenPk = (tokenId: string) => `TOKEN#${tokenId}`;
export const toTokenSk = () => "METADATA";

/** Realm 主键（用于 Depot 和 Ticket） */
export const toRealmPk = (realm: string) => `REALM#${realm}`;

/** Depot 排序键 */
export const toDepotSk = (depotId: string) => `DEPOT#${depotId}`;

/** Ticket 排序键 */
export const toTicketSk = (ticketId: string) => `TICKET#${ticketId}`;

/** ScopeSetNode 主键 */
export const toSetNodePk = (setNodeId: string) => `SETNODE#${setNodeId}`;

/** TokenRequest 主键 */
export const toTokenReqPk = (requestId: string) => `TOKENREQ#${requestId}`;

/** Audit 主键 */
export const toAuditPk = (tokenId: string) => `AUDIT#${tokenId}`;

/** Audit 排序键（使用零填充的 13 位时间戳确保正确排序） */
export const toAuditSk = (timestamp: number, action: string) => 
  `${timestamp.toString().padStart(13, '0')}#${action}`;

/** UserQuota 主键 */
export const toQuotaPk = (realm: string) => `QUOTA#${realm}`;

/** 日期格式化（用于 gsi4pk） */
export const toAuditDate = (timestamp: number) => {
  const date = new Date(timestamp);
  return date.toISOString().slice(0, 10);  // YYYY-MM-DD
};
```

---

## 附录 B: 查询模式示例

```typescript
// 1. 获取某 realm 下所有有效 Token（通过 gsi1）
const tokens = await client.send(new QueryCommand({
  TableName: TABLE_NAME,
  IndexName: "gsi1",
  KeyConditionExpression: "gsi1pk = :pk AND begins_with(gsi1sk, :prefix)",
  FilterExpression: "isRevoked = :false AND expiresAt > :now",
  ExpressionAttributeValues: {
    ":pk": `REALM#${realm}`,
    ":prefix": "TOKEN#",
    ":false": false,
    ":now": Date.now(),
  },
}));

// 2. 获取某 Token 签发的所有子 Token（用于级联撤销）
const children = await client.send(new QueryCommand({
  TableName: TABLE_NAME,
  IndexName: "gsi2",
  KeyConditionExpression: "gsi2pk = :pk",
  ExpressionAttributeValues: {
    ":pk": `ISSUER#${tokenId}`,
  },
}));

// 3. 获取某 realm 下所有 Depot（直接查询主表，无需 GSI）
const depots = await client.send(new QueryCommand({
  TableName: TABLE_NAME,
  KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
  ExpressionAttributeValues: {
    ":pk": `REALM#${realm}`,
    ":prefix": "DEPOT#",
  },
}));

// 4. 获取某 realm 下所有 Ticket（直接查询主表，无需 GSI）
const tickets = await client.send(new QueryCommand({
  TableName: TABLE_NAME,
  KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
  FilterExpression: "#status = :status",
  ExpressionAttributeNames: { "#status": "status" },
  ExpressionAttributeValues: {
    ":pk": `REALM#${realm}`,
    ":prefix": "TICKET#",
    ":status": "pending",
  },
}));

// 5. 获取某创建者的所有 Depot（通过 gsi3）
const creatorDepots = await client.send(new QueryCommand({
  TableName: TABLE_NAME,
  IndexName: "gsi3",
  KeyConditionExpression: "gsi3pk = :pk AND begins_with(gsi3sk, :prefix)",
  ExpressionAttributeValues: {
    ":pk": `CREATOR#${issuerId}`,
    ":prefix": "DEPOT#",
  },
}));

// 6. 获取某日期的审计日志（通过 gsi4）
const logs = await client.send(new QueryCommand({
  TableName: TABLE_NAME,
  IndexName: "gsi4",
  KeyConditionExpression: "gsi4pk = :pk AND gsi4sk BETWEEN :start AND :end",
  ExpressionAttributeValues: {
    ":pk": `AUDIT_DATE#${date}`,
    ":start": `${startTimestamp.toString().padStart(13, '0')}`,
    ":end": `${endTimestamp.toString().padStart(13, '0')}`,
  },
}));

// 7. 列出 Token Issuer Chain 可见的 Depot（用于 API /depots 列表）
// 
// 设计说明：
// - 每个 Token 可以访问其 issuerChain 中任意签发者创建的 Depot
// - issuerChain = [rootUserId, token1IssuerId, token2IssuerId, ...] 加上 token.issuerId
// - 这实现了"继承"语义：子 Token 继承父 Token 可访问的 Depot
//
async function listVisibleDepots(
  token: DelegateTokenRecord,
  realm: string,
  options?: ListOptions
): Promise<DepotRecord[]> {
  const allDepots: DepotRecord[] = [];
  
  // 完整的可见签发者列表 = issuerChain + 当前 Token 的 issuerId
  const visibleIssuers = [...token.issuerChain, token.issuerId];
  
  // 对每个签发者查询其创建的 Depot（可并行优化）
  const results = await Promise.all(
    visibleIssuers.map(issuerId =>
      client.send(new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: "gsi3",
        KeyConditionExpression: "gsi3pk = :pk",
        ExpressionAttributeValues: {
          ":pk": `CREATOR#${issuerId}`,
        },
      }))
    )
  );
  
  for (const result of results) {
    if (result.Items) {
      allDepots.push(...(result.Items as DepotRecord[]));
    }
  }
  
  // 过滤只保留当前 realm 的 Depot，然后去重、排序、分页
  const filtered = allDepots.filter(d => d.realm === realm);
  return paginate(dedupe(filtered, 'depotId'), options);
}

// 8. 验证 Token 是否可以访问指定 Depot
async function canAccessDepot(
  token: DelegateTokenRecord,
  depotId: string,
  realm: string
): Promise<boolean> {
  // 获取 Depot
  const depot = await client.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: {
      pk: `REALM#${realm}`,
      sk: `DEPOT#${depotId}`,
    },
  }));
  
  if (!depot.Item) return false;
  const depotRecord = depot.Item as DepotRecord;
  
  // 检查 Depot 创建者是否在 Token 的可见签发者列表中
  const visibleIssuers = [...token.issuerChain, token.issuerId];
  return visibleIssuers.includes(depotRecord.creatorIssuerId);
}
```

---

## 附录 C: 注意事项

### C.1 向后兼容性

由于系统尚未上线，本次重构不需要考虑向后兼容性。所有现有开发/测试数据将被清除。

### C.2 索引一致性

- DynamoDB GSI 是异步更新的，可能存在短暂的不一致
- 对于强一致性要求的场景（如验证 Token），应直接查询主表

### C.3 事务限制

- DynamoDB 事务最多 100 个操作项
- 事务中的所有项必须在同一个 AWS Region
- 跨分区事务性能较低，应尽量减少跨分区操作

### C.4 成本考虑

- GSI 使用 `ALL` 投影会增加存储和写入成本
- 审计日志可能增长较快，考虑设置 TTL 自动过期
- 考虑使用 DynamoDB Streams 进行异步审计日志写入

---

## 附录 D: 与现有代码的兼容层

在重构期间，可以创建兼容层以支持渐进式迁移：

```typescript
// db/compat/tokens-compat.ts

import { createDelegateTokensDb } from "../delegate-tokens.ts";
import { createTokensDb as createLegacyTokensDb } from "../[deprecated]/tokens.ts";

/**
 * 兼容层：同时支持旧 Token 和新 DelegateToken
 * 
 * 用于渐进式迁移期间
 */
export const createCompatTokensDb = (config: DbConfig) => {
  const legacyDb = createLegacyTokensDb(config);
  const newDb = createDelegateTokensDb(config);
  
  return {
    // 优先使用新表，回退到旧表
    getToken: async (tokenId: string) => {
      const newToken = await newDb.get(tokenId);
      if (newToken) return convertToLegacy(newToken);
      return legacyDb.getToken(tokenId);
    },
    // ... 其他方法
  };
};
```

> **建议**：由于系统未上线，建议直接迁移而非使用兼容层。
