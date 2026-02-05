# 数据模型变更

> 版本: 1.0  
> 日期: 2026-02-05

---

## 目录

1. [概述](#1-概述)
2. [Token 表变更](#2-token-表变更)
3. [Depot 表变更](#3-depot-表变更)
4. [Ticket 表变更](#4-ticket-表变更)
5. [新增表](#5-新增表)
6. [迁移方案](#6-迁移方案)
7. [索引设计](#7-索引设计)

---

## 1. 概述

### 1.1 变更范围

| 表 | 变更类型 | 说明 |
|-----|----------|------|
| Token | 重构 | 统一为 DelegateToken 格式，不存储完整 token |
| Depot | 扩展 | 增加 creatorIssuerId 字段 |
| Ticket | 简化 | 移除权限字段，仅保留工作空间状态，增加 root 字段 |
| ScopeSetNode | 新增 | 存储 Token scope 的 set-node，带引用计数 |
| TokenUsage | 新增 | 记录各 Token 的 quota 使用量（Reserved） |
| TokenAudit | 新增 | Token 操作审计日志 |

### 1.2 数据库

系统使用 DynamoDB 作为主数据库，采用单表设计。

---

## 2. Token 表变更

### 2.1 现有结构

```typescript
// 现有 Token 类型
type UserToken = {
  pk: string;           // TOKEN#{tokenId}
  sk: string;           // TOKEN
  type: "user";
  userId: string;
  refreshToken?: string;
  createdAt: number;
  expiresAt: number;
};

type AgentToken = {
  pk: string;
  sk: string;
  type: "agent";
  userId: string;
  name: string;
  description?: string;
  createdAt: number;
  expiresAt: number;
};

type Ticket = {
  pk: string;
  sk: string;
  type: "ticket";
  realm: string;
  issuerId: string;
  purpose?: string;
  scope?: string[];
  commit?: CommitConfig;
  isRevoked?: boolean;
  config: { nodeLimit: number; maxNameBytes: number };
  createdAt: number;
  expiresAt: number;
  gsi1pk?: string;
  gsi1sk?: string;
};
```

### 2.2 新结构

```typescript
type DelegateTokenRecord = {
  // 主键
  pk: string;           // TOKEN#{tokenId}
  sk: string;           // METADATA

  // 注意：不存储完整 tokenBytes，只存储元数据
  // Token 通过 HTTPS 返回给客户端保管

  // Token 基本信息
  tokenType: "delegate" | "access";
  realm: string;        // 32 bytes hash 的 hex 表示
  expiresAt: number;
  depth: number;        // Token 深度 (0-15)

  // Token 标识信息
  name?: string;              // Token 名称（用户签发时可提供）
  description?: string;       // Token 描述

  // 签发信息
  issuerId: string;           // 签发者 ID (hex)
  issuerType: "user" | "token";
  parentTokenId?: string;     // 转签发时的父 Token ID
  issuerChain: string[];      // 预计算的签发链（签发时计算并存储）

  // 权限标志
  canUpload: boolean;
  canManageDepot: boolean;
  isUserIssued: boolean;

  // Scope 信息（二选一，互斥）
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

  // GSI for realm queries
  gsi1pk: string;       // REALM#{realm}
  gsi1sk: string;       // TOKEN#{tokenId}

  // GSI for issuer chain queries
  gsi2pk: string;       // ISSUER#{issuerId}
  gsi2sk: string;       // TOKEN#{tokenId}
};
```

> **Issuer Chain 设计说明**：
> - `issuerChain` 存储从根用户到当前 Token 的完整签发者 ID 链
> - 格式：`[rootUserId, token1IssuerId, token2IssuerId, ...]`（不包含当前 Token 的 issuerId）
> - 签发时预计算：`newIssuerChain = [...parentToken.issuerChain, parentToken.issuerId]`
> - 用途：权限继承验证、Depot 可见性、审计追踪

### 2.3 字段对照

| 旧字段 | 新字段 | 说明 |
|--------|--------|------|
| type: "user" | - | 废弃，OAuth 不再产生 Token 记录 |
| type: "agent" | tokenType: "delegate" | AgentToken 迁移为再授权 Token |
| type: "ticket" | tokenType: "access" | Ticket Token 迁移为访问 Token |
| userId | issuerId (user) | 用户 ID 的 hash |
| refreshToken | - | 废弃，OAuth 层面处理 |
| name, description | name, description | 保留，用于 Token 标识 |
| scope (string[]) | scopeSetNodeId | 关联 set-node 表的 ID |
| commit.quota | - | 字段保留（reserved），当前版本不使用 |
| commit.accept | - | 暂时废弃，后续可扩展 |
| isRevoked | isRevoked | 保持 |
| - | depth | 新增：Token 深度 (0-15) |

### 2.4 主键设计

```
PK: TOKEN#{tokenId}
SK: METADATA

示例:
PK: TOKEN#dlt1_4xzrt7y2m5k9bqwp3fnhjc6d
SK: METADATA
```

---

## 3. Depot 表变更

### 3.1 现有结构

```typescript
type Depot = {
  pk: string;           // DEPOT#{realm}#{depotId}
  sk: string;           // METADATA
  realm: string;
  depotId: string;
  title: string;
  root: string;
  maxHistory: number;
  history: string[];
  createdAt: number;
  updatedAt: number;
};
```

### 3.2 新结构

```typescript
type DepotRecord = {
  // 主键（使用 REALM 分区，可直接按 realm 查询）
  pk: string;           // REALM#{realm}
  sk: string;           // DEPOT#{depotId}

  // 基本信息
  realm: string;
  depotId: string;
  name: string;         // Depot 名称（与 API 响应一致）

  // 版本信息
  root: string;
  maxHistory: number;
  history: string[];

  // 创建者追踪
  creatorIssuerId: string;    // 创建该 Depot 的 Token 的 issuer ID
  creatorTokenId: string;     // 创建该 Depot 的 Token ID

  // 时间戳
  createdAt: number;
  updatedAt: number;

  // GSI for creator queries
  gsi3pk: string;       // CREATOR#{creatorIssuerId}
  gsi3sk: string;       // DEPOT#{depotId}
};
```

> **说明**：Depot 使用 `REALM#{realm}` 作为 PK，可直接通过主表按 realm 查询所有 Depot，不需要 GSI。

### 3.3 字段变更

| 字段 | 变更类型 | 说明 |
|------|----------|------|
| pk | 修改 | `DEPOT#{realm}#{depotId}` → `REALM#{realm}` |
| sk | 修改 | `METADATA` → `DEPOT#{depotId}` |
| title | 重命名 | 改为 `name`，与 API 响应一致 |
| creatorIssuerId | 新增 | 创建该 Depot 的 Token 的 issuer ID |
| creatorTokenId | 新增 | 创建该 Depot 的 Token ID |
| gsi3pk | 新增 | 用于按创建者查询 Depot |
| gsi3sk | 新增 | 排序键 |

### 3.4 Issuer Chain 访问控制

通过 creatorIssuerId 和 Token 的预计算 issuerChain 实现访问控制：

```typescript
// 检查 Token 是否可以访问 Depot
function canAccessDepot(
  token: DelegateTokenRecord,
  depot: DepotRecord
): boolean {
  // 使用预计算的 issuerChain 加上当前 Token 的 issuerId
  const visibleIssuers = [...token.issuerChain, token.issuerId];
  
  // 检查 Depot 的创建者是否在 chain 中
  return visibleIssuers.includes(depot.creatorIssuerId);
}
```

> **说明**：issuerChain 在 Token 签发时预计算并存储，无需运行时递归查询。

---

## 4. Ticket 表变更

### 4.1 现有结构

```typescript
// Ticket 作为 Token 的一种类型存储
type Ticket = {
  pk: string;
  sk: string;
  type: "ticket";
  realm: string;
  issuerId: string;
  purpose?: string;
  scope?: string[];
  commit?: CommitConfig;
  isRevoked?: boolean;
  config: { nodeLimit: number; maxNameBytes: number };
  createdAt: number;
  expiresAt: number;
  gsi1pk?: string;
  gsi1sk?: string;
};
```

### 4.2 新结构

```typescript
type TicketRecord = {
  // 主键（使用 REALM 分区，可直接按 realm 查询）
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
  root?: string;        // submit 的输出节点 hash（用于访问历史输出）

  // 关联的 Access Token
  accessTokenId: string;

  // 创建信息
  creatorTokenId: string;     // 创建该 Ticket 的再授权 Token ID

  // 时间戳
  createdAt: number;

  // TTL（DynamoDB 自动删除）
  ttl: number;                // Unix epoch 秒，24 小时超时
};
```

> **说明**：
> - Ticket 使用 `REALM#{realm}` 作为 PK，可直接通过主表按 realm 查询，不再需要 gsi1
> - `expiresAt` 不存储在 Ticket 中，API 返回时从关联的 Access Token 获取

### 4.3 字段对照

| 旧字段 | 新字段 | 说明 |
|--------|--------|------|
| type: "ticket" | - | Ticket 独立于 Token 存储 |
| issuerId | creatorTokenId | 创建者 Token ID |
| purpose | title | 重命名 |
| scope | - | 移至关联的 Access Token |
| commit | - | 移至关联的 Access Token |
| isRevoked | - | 通过 Access Token 状态判断 |
| config | - | 移至关联的 Access Token |
| expiresAt | - | 通过 Access Token 判断 |
| - | status | 新增：pending / submitted |
| - | root | 新增：submit 输出节点，用于访问历史输出 |
| - | accessTokenId | 新增：关联的 Access Token |

### 4.4 简化说明

新架构中 Ticket 的职责简化为：

1. **工作空间标识**：ticketId、title
2. **提交状态管理**：status、submittedAt
3. **历史输出访问**：root（submit 输出节点）
4. **Token 关联**：accessTokenId

所有权限相关的信息都由关联的 Access Token 承载。

**引用计数**：
- Ticket submit 时设置 `root` 字段并增加该节点的引用计数（+1）
- 提交的根节点创建时引用计数为 0，submit 时 +1
- Ticket 过期不会清理 root 引用（Access Token 过期后 Ticket 数据仍有效）
- Ticket 被删除时递减 root 的引用计数（-1）

---

## 5. 新增表

### 5.1 ScopeSetNode 表

存储 Token scope 的 set-node（不在 CAS 存储中，独立管理）：

```typescript
type ScopeSetNodeRecord = {
  // 主键
  pk: string;           // SETNODE#{setNodeId}
  sk: string;           // METADATA

  // set-node 数据
  setNodeId: string;    // Blake3-128 hash of children
  children: string[];   // 子节点 hash 列表（已排序去重，可为空）

  // 引用计数
  refCount: number;     // 引用此 set-node 的 Token 数量

  // 时间戳
  createdAt: number;
  lastUpdated: number;
};
```

**用途**：
- 存储 Token scope 的 set-node 数据
- 支持 empty set-node（children 为空数组），用于只写 Token
- 通过引用计数管理生命周期
- Token 撤销时减少引用计数（触发级联撤销）
- Token 记录删除时减少引用计数（定期清理过期记录）
- 引用计数归零时可回收
- **注意**：过期不会自动减少引用计数，只有删除记录时才递减

> **注意**：单个 scope 时，直接使用节点 hash，不创建 ScopeSetNode 记录。
> 只有多 scope 或只写（empty set）场景才使用 ScopeSetNode 表。

### 5.2 TokenUsage 表（Reserved）

记录各 Token 的 quota 使用量（当前版本保留，暂不启用）：

```typescript
type TokenUsageRecord = {
  // 主键
  pk: string;           // USAGE#{tokenId}
  sk: string;           // AGGREGATE

  // 使用量
  bytesUsed: number;
  lastUpdated: number;
};
```

**用途**：
- 预留用于未来 Token 级别的 quota 约束
- 当前版本仅验证用户总配额

### 5.3 TokenAudit 表

记录 Token 操作的审计日志：

```typescript
type TokenAuditRecord = {
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

  // GSI for time-range queries
  gsi4pk: string;       // AUDIT_DATE#{date}
  gsi4sk: string;       // {timestamp}#{tokenId}
};
```

### 5.4 UserQuota 表

记录用户级别的配额和使用量：

```typescript
type UserQuotaRecord = {
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
> - 资源计数字段用于限制用户创建资源的数量

---

## 6. 迁移方案

> **注意**：系统尚未正式上线，无需考虑复杂的迁移兼容性。
> 以下为简化的迁移策略。

### 6.1 迁移策略

采用**直接替换**策略：

1. 清空现有开发/测试数据
2. 部署新版本数据模型
3. 使用新格式创建所有 Token

### 6.2 清理脚本

```typescript
async function cleanAndDeploy(): Promise<void> {
  console.log("Cleaning existing data...");

  // 清空开发/测试环境的旧数据
  await clearTable("casfa-main-dev");

  console.log("Deploying new schema...");

  // 部署新的表结构（GSI 等）
  await deployTableSchema();

  console.log("Clean deployment completed");
}
```

> **注意**：生产环境上线时如有遗留数据，需另行制定迁移方案。

---

## 7. 索引设计

### 7.1 主表索引

| 索引 | PK 格式 | SK 格式 | 用途 |
|------|---------|---------|------|
| 主键 | TOKEN#{id} | METADATA | Token 查询 |
| 主键 | REALM#{realm} | DEPOT#{id} | Depot 查询（按 realm 分区） |
| 主键 | REALM#{realm} | TICKET#{id} | Ticket 查询（按 realm 分区） |
| 主键 | SETNODE#{id} | METADATA | Scope set-node |
| 主键 | USAGE#{tokenId} | AGGREGATE | Token 使用量 (reserved) |
| 主键 | QUOTA#{realm} | USER | 用户配额 |
| 主键 | AUDIT#{tokenId} | {ts}#{action} | 审计日志 |
| 主键 | TOKENREQ#{id} | METADATA | 客户端授权申请 |

### 7.2 GSI 索引

| GSI | PK | SK | 用途 |
|-----|-----|-----|------|
| gsi1 | REALM#{realm} | TOKEN#{id} | 按 realm 查询 Token |
| gsi2 | ISSUER#{id} | TOKEN#{id} | 按 issuer 查询子 Token（级联撤销） |
| gsi3 | CREATOR#{id} | DEPOT#{id} | 按创建者查询 Depot |
| gsi4 | AUDIT_DATE#{date} | {ts}#{id} | 按日期查询审计日志 |

> **说明**：
> - Depot 和 Ticket 使用主表 `REALM#{realm}` 分区键，可直接查询，不需要 gsi1

### 7.3 查询模式

```typescript
// 1. 获取某 realm 下所有有效 Token
const tokens = await queryGsi1({
  pk: `REALM#${realm}`,
  skPrefix: "TOKEN#",
  filter: "isRevoked = :false AND expiresAt > :now",
});

// 2. 获取某 Token 签发的所有子 Token
const children = await queryGsi2({
  pk: `ISSUER#${tokenId}`,
  skPrefix: "TOKEN#",
});

// 3. 获取某 realm 下所有 Depot（直接查询主表）
const depots = await queryByPkPrefix({
  pk: `REALM#${realm}`,
  skPrefix: "DEPOT#",
});

// 4. 获取某 realm 下所有 Ticket（直接查询主表）
const tickets = await queryByPkPrefix({
  pk: `REALM#${realm}`,
  skPrefix: "TICKET#",
  filter: { status: "pending" },
});

// 5. 获取某创建者的所有 Depot（通过 gsi3）
const creatorDepots = await queryGsi3({
  pk: `CREATOR#${issuerId}`,
  skPrefix: "DEPOT#",
});

// 6. 获取某日期的审计日志
const logs = await queryGsi4({
  pk: `AUDIT_DATE#${date}`,
  skRange: { start: `${startTs}`, end: `${endTs}` },
});
```

---

## 附录 A: DynamoDB 表定义

```typescript
const tableDefinition = {
  TableName: "casfa-main",
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
  // TTL 配置
  TimeToLiveSpecification: {
    AttributeName: "ttl",
    Enabled: true,
  },
};
```

---

## 附录 B: 废弃的类型

以下类型在新架构中废弃：

```typescript
// 废弃：UserToken
// 原因：OAuth 层面处理，不再产生 Token 记录

// 废弃：AgentToken
// 原因：统一为 DelegateToken (type: delegate)

// 废弃：Ticket 作为 Token 类型
// 原因：Ticket 独立存储，权限由关联的 Access Token 承载

// 废弃：AWP 相关类型
// 原因：统一使用 DelegateToken
type AwpPendingAuth = { /* ... */ };  // 废弃
type AwpPubkey = { /* ... */ };       // 废弃
type ClientPendingAuth = { /* ... */ };  // 废弃
type ClientPubkey = { /* ... */ };       // 废弃
```

---

## 附录 C: 类型定义文件

新的类型定义文件位置：`apps/server/backend/src/types/delegate-token.ts`

```typescript
/**
 * Delegate Token 类型定义
 */

// Token flags
export type DelegateTokenFlags = {
  isDelegate: boolean;
  isUserIssued: boolean;
  canUpload: boolean;
  canManageDepot: boolean;
  depth: number;  // Token 深度 (0-15)
};

// Token 解码结果
export type DecodedDelegateToken = {
  flags: DelegateTokenFlags;
  ttl: number;
  quota: number;
  salt: Uint8Array;
  issuer: Uint8Array;
  realm: Uint8Array;
  scope: Uint8Array;
};

// Token 数据库记录
// 注意：不存储完整 tokenBytes，只存储元数据
export type DelegateTokenRecord = {
  pk: string;           // TOKEN#{tokenId}
  sk: string;           // METADATA
  tokenId: string;      // dlt1_xxx 格式
  tokenType: "delegate" | "access";
  realm: string;
  expiresAt: number;
  depth: number;
  name?: string;              // Token 名称（用户签发时可提供）
  description?: string;       // Token 描述
  issuerId: string;
  issuerType: "user" | "token";
  parentTokenId?: string;
  issuerChain: string[];  // 预计算的签发链
  canUpload: boolean;
  canManageDepot: boolean;
  isUserIssued: boolean;
  scopeNodeHash?: string;     // 单 scope 时的节点 hash
  scopeSetNodeId?: string;    // 多 scope 时的 set-node ID
  isRevoked: boolean;
  revokedAt?: number;
  revokedBy?: string;
  createdAt: number;
  ttl: number;          // Unix epoch 秒
  gsi1pk: string;
  gsi1sk: string;
  gsi2pk: string;
  gsi2sk: string;
};

// Scope set-node 记录
export type ScopeSetNodeRecord = {
  pk: string;
  sk: string;
  setNodeId: string;
  children: string[];
  refCount: number;
  createdAt: number;
  lastUpdated: number;
};

// Depot 记录
export type DepotRecord = {
  pk: string;           // REALM#{realm}
  sk: string;           // DEPOT#{depotId}
  realm: string;
  depotId: string;
  name: string;         // Depot 名称（API 使用 name）
  root: string;
  maxHistory: number;
  history: string[];
  creatorIssuerId: string;
  creatorTokenId: string;
  createdAt: number;
  updatedAt: number;
  gsi3pk: string;       // CREATOR#{creatorIssuerId}
  gsi3sk: string;       // DEPOT#{depotId}
};

// Ticket 记录
export type TicketRecord = {
  pk: string;           // REALM#{realm}
  sk: string;           // TICKET#{ticketId}
  ticketId: string;
  realm: string;
  title: string;
  status: "pending" | "submitted";
  submittedAt?: number;
  root?: string;        // submit 输出节点 hash（用于访问历史输出）
  accessTokenId: string;
  creatorTokenId: string;
  createdAt: number;
  ttl: number;          // Unix epoch 秒，24 小时超时
};

// Token 使用量记录
export type TokenUsageRecord = {
  pk: string;
  sk: string;
  bytesUsed: number;
  lastUpdated: number;
};

// 用户配额记录
export type UserQuotaRecord = {
  pk: string;           // QUOTA#{realm}
  sk: string;           // USER
  realm: string;
  quotaLimit: number;
  bytesUsed: number;
  bytesInProgress: number;
  tokenCount: number;
  depotCount: number;
  ticketCount: number;
  createdAt: number;
  lastUpdated: number;
};

// 审计日志记录
export type TokenAuditRecord = {
  pk: string;           // AUDIT#{tokenId}
  sk: string;           // {timestamp}#{action}
  tokenId: string;
  action: "create" | "revoke" | "delegate" | "use";
  actorId: string;
  actorType: "user" | "token" | "system";
  timestamp: number;
  details?: Record<string, unknown>;
  gsi4pk: string;       // AUDIT_DATE#{date}
  gsi4sk: string;       // {timestamp}#{tokenId}
  ttl: number;          // Unix epoch 秒，90 天保留期
};

// 客户端授权申请记录
export type TokenRequestRecord = {
  pk: string;           // TOKENREQ#{requestId}
  sk: string;           // METADATA
  requestId: string;
  clientName: string;
  clientSecretHash: string;
  status: "pending" | "approved" | "rejected" | "expired";
  realm?: string;
  tokenType?: "delegate" | "access";
  depth?: number;
  expiresIn?: number;
  canUpload?: boolean;
  canManageDepot?: boolean;
  scope?: string[];
  tokenName?: string;
  tokenDescription?: string;
  encryptedToken?: string;
  createdAt: number;
  expiresAt: number;
  approvedAt?: number;
  approvedBy?: string;
  approverTokenId?: string;
  ttl: number;          // Unix epoch 秒
};
```
