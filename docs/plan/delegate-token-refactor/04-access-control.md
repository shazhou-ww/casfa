# 访问鉴权规范

> 版本: 1.0  
> 日期: 2026-02-05

---

## 目录

1. [概述](#1-概述)
2. [Node 读取鉴权](#2-node-读取鉴权)
3. [Node 写入鉴权](#3-node-写入鉴权)
4. [Depot 访问鉴权](#4-depot-访问鉴权)
5. [Ticket 访问鉴权](#5-ticket-访问鉴权)
6. [鉴权中间件设计](#6-鉴权中间件设计)

---

## 1. 概述

### 1.1 鉴权原则

| 原则 | 说明 |
|------|------|
| **Token 必需** | 所有数据访问必须提供有效的 Delegate Token |
| **访问 Token 限定** | 只有访问 Token 可以访问数据，再授权 Token 不能 |
| **Scope 证明** | 读取时需提供 index-path 证明节点在授权范围内 |
| **链式约束** | 写入受整个 issuer chain 的 quota 约束 |

### 1.2 Token 类型与访问权限

| 操作 | 再授权 Token | 访问 Token |
|------|--------------|------------|
| 读取 Node | ✗ | ✓ (需 scope 证明) |
| 写入 Node | ✗ | ✓ (需 quota + can_upload) |
| 访问 Depot | ✗ | ✓ (需 can_manage_depot) |
| 创建 Ticket | ✗ | ✓ (需绑定预签发的 Access Token) |
| 签发 Token | ✓ | ✗ |

> **设计原则**：Delegate Token 只负责签发 Token，所有 Realm 数据操作统一使用 Access Token。

---

## 2. Node 读取鉴权

### 2.1 鉴权要求

读取 Node 时需要：

1. **有效的访问 Token**
2. **目标节点在 Token 的 scope 内**
3. **提供 index-path 证明**

### 2.2 Index-Path 证明

读取请求必须在 Header 中提供 `X-CAS-Index-Path`，证明目标节点是 scope 的子节点：

```
GET /api/realm/{realmId}/nodes/{key}
Authorization: Bearer {base64_encoded_token}
X-CAS-Index-Path: 0:1:2
```

> **说明**：`Authorization` Header 中的值是完整 Token（128 字节）的 Base64 编码。

### 2.3 验证流程

```
┌─────────────────────────────────────────────────────────────┐
│                    Node 读取鉴权流程                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. 验证 Token                                               │
│     ├── Token 存在且未撤销                                   │
│     ├── Token 未过期                                         │
│     ├── Token 类型是访问 Token                               │
│     └── Token realm 匹配请求 realm                           │
│                    │                                         │
│                    ▼                                         │
│  2. 解析 Index-Path                                          │
│     └── 解析 Header 中的 X-CAS-Index-Path                    │
│                    │                                         │
│                    ▼                                         │
│  3. 验证 Scope 包含                                          │
│     ├── 获取 Token 的 scope (set-node hash)                  │
│     ├── 沿 index-path 从 scope 向下遍历                      │
│     └── 验证最终到达请求的节点 key                           │
│                    │                                         │
│                    ▼                                         │
│  4. 返回节点数据                                             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 2.4 Scope 包含验证

```typescript
async function verifyNodeInScope(
  tokenScope: Uint8Array,   // 32 bytes, 后 16 bytes 是 hash
  indexPath: number[],
  targetKey: string,
  storage: StorageProvider
): Promise<boolean> {
  // 1. 提取 scope hash (后 16 bytes)
  const scopeHash = tokenScope.slice(16);

  // 2. 获取 scope 节点（可能是 set-node 或普通节点）
  const scopeNode = await storage.get(hashToKey(scopeHash));
  if (!scopeNode) {
    return false;
  }

  const decoded = decodeNode(scopeNode);

  // 3. 如果是 set-node，第一个 index 选择哪个根
  let currentHash: Uint8Array;
  let pathStart = 0;

  if (decoded.kind === "set") {
    if (indexPath.length === 0) {
      return false;  // set-node 本身不能被访问
    }
    const rootIndex = indexPath[0];
    if (rootIndex >= decoded.children!.length) {
      return false;
    }
    currentHash = decoded.children![rootIndex];
    pathStart = 1;
  } else {
    currentHash = scopeHash;
  }

  // 4. 沿 index-path 向下遍历
  for (let i = pathStart; i < indexPath.length; i++) {
    const node = await storage.get(hashToKey(currentHash));
    if (!node) {
      return false;
    }

    const nodeDecoded = decodeNode(node);
    const idx = indexPath[i];

    if (!nodeDecoded.children || idx >= nodeDecoded.children.length) {
      return false;
    }

    currentHash = nodeDecoded.children[idx];
  }

  // 5. 验证最终节点匹配请求的 key
  return hashToKey(currentHash) === targetKey;
}
```

### 2.5 错误响应

| 场景 | HTTP Status | 错误码 |
|------|-------------|--------|
| Token 无效/过期 | 401 | `INVALID_TOKEN` |
| Token 是再授权类型 | 403 | `ACCESS_TOKEN_REQUIRED` |
| 缺少 Index-Path | 400 | `INDEX_PATH_REQUIRED` |
| Index-Path 无效 | 400 | `INVALID_INDEX_PATH` |
| 节点不在 scope 内 | 403 | `NODE_NOT_IN_SCOPE` |
| 节点不存在 | 404 | `NODE_NOT_FOUND` |

---

## 3. Node 写入鉴权

### 3.1 鉴权要求

写入 Node 时需要：

1. **有效的访问 Token**
2. **Token 具有 can_upload 权限**
3. **用户总 quota 未超**
4. **Issuer chain 各节点的 quota 未超**

### 3.2 验证流程

```
┌─────────────────────────────────────────────────────────────┐
│                    Node 写入鉴权流程                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. 验证 Token                                               │
│     ├── Token 存在且未撤销                                   │
│     ├── Token 未过期                                         │
│     ├── Token 类型是访问 Token                               │
│     ├── Token realm 匹配请求 realm                           │
│     └── Token 具有 can_upload 权限                           │
│                    │                                         │
│                    ▼                                         │
│  2. 验证节点格式                                             │
│     ├── 验证 CAS 节点格式正确                                │
│     └── 计算节点大小                                         │
│                    │                                         │
│                    ▼                                         │
│  3. 验证用户 Quota                                           │
│     └── 用户已用空间 + 节点大小 ≤ 用户配额                   │
│                    │                                         │
│                    ▼                                         │
│  4. 验证链式 Quota (可选，第一期可跳过)                      │
│     └── 沿 issuer chain 验证各节点 quota                     │
│                    │                                         │
│                    ▼                                         │
│  5. 写入节点并更新统计                                       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 3.3 链式 Quota 约束

Quota 的链式约束确保每一级签发者的配额都被遵守：

```
User (total quota: 100 GB)
  │
  └── 签发 Token A (quota: 10 GB)
          │
          └── 转签发 Token B (quota: 1 GB)
                  │
                  └── 写入 500 MB
```

验证逻辑：

```typescript
async function verifyChainQuota(
  token: TokenRecord,
  bytesToWrite: number,
  tokensDb: TokensDb,
  usageDb: UsageDb
): Promise<boolean> {
  // 1. 验证当前 Token 的 quota（如果有限制）
  if (token.quota > 0) {
    const used = await usageDb.getTokenUsage(token.tokenId);
    if (used + bytesToWrite > token.quota) {
      return false;
    }
  }

  // 2. 如果是转签发的 Token，递归验证父 Token
  if (token.issuerType === "token" && token.parentTokenId) {
    const parent = await tokensDb.getToken(token.parentTokenId);
    if (!parent) {
      return false;  // 父 Token 不存在
    }
    return verifyChainQuota(parent, bytesToWrite, tokensDb, usageDb);
  }

  // 3. 验证用户总配额
  const userUsage = await usageDb.getUserUsage(token.realm);
  const userLimit = await usageDb.getUserLimit(token.realm);
  return userUsage + bytesToWrite <= userLimit;
}
```

### 3.4 第一期简化方案

第一期可以简化 quota 验证：

1. 只验证用户总配额
2. Token 级别的 quota 记录但不强制验证
3. 提供 API 查询各级 quota 使用情况

```typescript
async function verifyQuotaSimplified(
  token: TokenRecord,
  bytesToWrite: number,
  usageDb: UsageDb
): Promise<boolean> {
  // 只验证用户总配额
  const userUsage = await usageDb.getUserUsage(token.realm);
  const userLimit = await usageDb.getUserLimit(token.realm);
  return userUsage + bytesToWrite <= userLimit;
}
```

### 3.5 错误响应

| 场景 | HTTP Status | 错误码 |
|------|-------------|--------|
| Token 无 can_upload 权限 | 403 | `UPLOAD_NOT_ALLOWED` |
| 用户配额不足 | 413 | `USER_QUOTA_EXCEEDED` |
| Token 配额不足 | 413 | `TOKEN_QUOTA_EXCEEDED` |
| 链式配额不足 | 413 | `CHAIN_QUOTA_EXCEEDED` |

---

## 4. Depot 访问鉴权

### 4.1 操作类型

| 操作 | 权限要求 |
|------|----------|
| 创建 Depot | can_manage_depot |
| 列出 Depot | 访问 Token |
| 获取 Depot 详情 | 访问 Token |
| 更新 Depot | can_manage_depot + issuer chain 验证 |
| Commit Depot | can_manage_depot + issuer chain 验证 |
| 删除 Depot | can_manage_depot + issuer chain 验证 |

### 4.2 Issuer Chain 验证

对于修改操作（更新、commit、删除），需要验证 Depot 归属于当前 Token 的 issuer chain：

```
User
  │
  ├── Token A (再授权)
  │       │
  │       └── Token C (访问) ── 创建 Depot X
  │
  └── Token B (访问) ── 创建 Depot Y
```

访问规则：

| Token | Depot X | Depot Y |
|-------|---------|---------|
| Token B | ✗ 无权访问 | ✓ 可访问 |
| Token C | ✓ 可访问 | ✗ 无权访问 |
| 用户直接签发的 Token D | ✓ 可访问 | ✓ 可访问 |

### 4.3 Issuer Chain 验证流程

```
┌─────────────────────────────────────────────────────────────┐
│                    Issuer Chain 验证                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  输入: Token, Depot                                          │
│                                                              │
│  1. 获取 Depot 的创建者 (creator_issuer_id)                  │
│                                                              │
│  2. 构建 Token 的 issuer chain                               │
│     chain = [token.issuer_id]                                │
│     while (current.issuer_type === "token"):                 │
│       current = getToken(current.parent_token_id)            │
│       chain.push(current.issuer_id)                          │
│     chain.push(current.issuer_id)  // 最终是 user_id         │
│                                                              │
│  3. 验证 creator_issuer_id 在 chain 中                       │
│     return chain.includes(depot.creator_issuer_id)           │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 4.4 实现代码

```typescript
async function verifyDepotAccess(
  token: TokenRecord,
  depot: DepotRecord,
  operation: "read" | "write",
  tokensDb: TokensDb
): Promise<boolean> {
  // 1. 基本权限检查
  if (token.flags.isDelegate) {
    return false;  // 再授权 Token 不能访问 Depot
  }

  if (operation === "write" && !token.flags.canManageDepot) {
    return false;  // 无 Depot 管理权限
  }

  // 2. 读操作只需基本验证
  if (operation === "read") {
    return token.realm === depot.realm;
  }

  // 3. 写操作需要 issuer chain 验证
  const issuerChain = await buildIssuerChain(token, tokensDb);
  return issuerChain.includes(depot.creatorIssuerId);
}

async function buildIssuerChain(
  token: TokenRecord,
  tokensDb: TokensDb
): Promise<string[]> {
  const chain: string[] = [token.issuerId];

  let current = token;
  while (current.issuerType === "token" && current.parentTokenId) {
    const parent = await tokensDb.getToken(current.parentTokenId);
    if (!parent) break;

    chain.push(parent.issuerId);
    current = parent;
  }

  return chain;
}
```

### 4.5 Depot 创建

创建 Depot 时记录创建者：

```typescript
async function createDepot(
  token: TokenRecord,
  title: string,
  depotsDb: DepotsDb
): Promise<DepotRecord> {
  // 验证权限
  if (token.flags.isDelegate) {
    throw new Error("Delegation token cannot create depot");
  }
  if (!token.flags.canManageDepot) {
    throw new Error("Token lacks depot management permission");
  }

  // 创建 Depot，记录创建者
  return depotsDb.create({
    realm: token.realm,
    title,
    creatorIssuerId: token.issuerId,  // 记录创建者
  });
}
```

---

## 5. Ticket 访问鉴权

### 5.1 Ticket 概念

在新架构中，Ticket 代表一次 Agent 调用 Tool 的请求上下文（仅需要读写 CAS 的 Tool 需要 Ticket）：

- **不包含权限字段**：权限由关联的 Access Token 承载
- **仅包含工作空间状态**：title、submit 状态
- **绑定预签发的 Access Token**：创建 Ticket 时绑定一个已签发的 Access Token
- **一对一关系**：一个 Ticket 只能关联一个 Access Token，一个 Access Token 只能绑定一个 Ticket
- **数据持久性**：Access Token 过期后，Ticket 承载的 Tool 返回数据仍然有效

### 5.2 Ticket 生命周期

```
┌─────────────────────────────────────────────────────────────┐
│                    Ticket 生命周期                           │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  0. 预签发 Access Token (需要再授权 Token)                   │
│     ├── Agent 使用 Delegate Token 签发 Access Token          │
│     └── 获得 tokenId + tokenBase64                           │
│                    │                                         │
│                    ▼                                         │
│  1. 创建 Ticket (需要访问 Token)                             │
│     ├── 验证调用者是 Access Token                            │
│     ├── 验证 realm                                           │
│     ├── 验证预签发的 accessTokenId 有效且未绑定              │
│     ├── 验证 accessTokenId 的 issuer chain 包含调用者        │
│     └── 创建 Ticket 记录并绑定 Access Token                  │
│                    │                                         │
│                    ▼                                         │
│  2. 使用 Ticket (通过关联的 Access Token)                    │
│     ├── 读写节点                                             │
│     └── 操作 Depot（如果有权限）                             │
│                    │                                         │
│                    ▼                                         │
│  3. Submit Ticket                                            │
│     ├── 验证 Ticket 状态是 pending                           │
│     ├── 更新状态为 submitted                                 │
│     └── 自动撤销关联的 Access Token（必须）                  │
│                                                              │
└─────────────────────────────────────────────────────────────┘

> **重要约束**：
> - 一个 Ticket 只能关联一个 Access Token
> - 一个 Access Token 只能绑定一个 Ticket
> - Ticket submit 后 Access Token 自动撤销
> - Access Token 过期不影响 Ticket 数据的有效性
```

### 5.3 创建 Ticket

```typescript
type CreateTicketRequest = {
  title: string;
  accessTokenId: string;  // 预签发的 Access Token ID
};

type CreateTicketResponse = {
  ticketId: string;
  title: string;
  status: "pending";
  accessTokenId: string;  // 绑定的 Access Token ID
};
```

### 5.4 创建流程

```typescript
async function createTicket(
  callerToken: TokenRecord,  // 调用者的 Access Token
  request: CreateTicketRequest,
  tokensDb: TokensDb,
  ticketsDb: TicketsDb
): Promise<CreateTicketResponse> {
  // 1. 验证调用者是 Access Token
  if (callerToken.flags.isDelegate) {
    throw new Error("Ticket creation requires access token");
  }

  // 2. 获取预签发的 Access Token
  const boundToken = await tokensDb.getToken(request.accessTokenId);
  if (!boundToken) {
    throw new Error("Access token not found");
  }

  // 3. 验证预签发的 Token 是 Access Token
  if (boundToken.flags.isDelegate) {
    throw new Error("Bound token must be access token");
  }

  // 4. 验证 Token 未被绑定到其他 Ticket
  if (boundToken.boundTicketId) {
    throw new Error("Access token already bound to a ticket");
  }

  // 5. 验证 realm 一致
  if (boundToken.realm !== callerToken.realm) {
    throw new Error("Realm mismatch");
  }

  // 6. 验证 issuer chain 权限（boundToken 的 issuer chain 应包含调用者或其 issuer）
  if (!verifyIssuerChainAccess(callerToken, boundToken)) {
    throw new Error("No permission to bind this token");
  }

  // 7. 创建 Ticket 记录
  const ticket = await ticketsDb.create({
    realm: callerToken.realm,
    title: request.title,
    status: "pending",
    accessTokenId: request.accessTokenId,
    creatorIssuerId: callerToken.issuerId,  // 记录创建者的 issuer
  });

  // 8. 标记 Token 已绑定
  await tokensDb.update(request.accessTokenId, {
    boundTicketId: ticket.ticketId,
  });

  return {
    ticketId: ticket.ticketId,
    title: ticket.title,
    status: "pending",
    accessTokenId: request.accessTokenId,
  };
}

// 验证调用者有权绑定 boundToken
function verifyIssuerChainAccess(
  callerToken: TokenRecord,
  boundToken: TokenRecord
): boolean {
  // boundToken 的 issuer chain 应该包含 callerToken 的 issuerId
  // 或者 callerToken 和 boundToken 有共同的祖先
  return boundToken.issuerChain.includes(callerToken.issuerId) ||
         callerToken.issuerChain.some(id => boundToken.issuerChain.includes(id));
}
```

### 5.5 Submit Ticket

```typescript
async function submitTicket(
  accessToken: TokenRecord,
  ticketId: string,
  rootNodeHash: string,  // 提交的根节点 hash
  ticketsDb: TicketsDb,
  tokensDb: TokensDb,
  nodesDb: NodesDb
): Promise<void> {
  // 1. 获取 Ticket
  const ticket = await ticketsDb.get(ticketId);
  if (!ticket) {
    throw new Error("Ticket not found");
  }

  // 2. 验证 Token 是该 Ticket 的关联 Token
  if (ticket.accessTokenId !== accessToken.tokenId) {
    throw new Error("Token not associated with this ticket");
  }

  // 3. 验证状态
  if (ticket.status !== "pending") {
    throw new Error("Ticket already submitted");
  }

  // 4. 增加 root 节点的引用计数（提交的根节点创建时 refCount=0，submit 时 +1）
  await nodesDb.incrementRefCount(rootNodeHash);

  // 5. 更新状态，设置 root
  await ticketsDb.update(ticketId, {
    status: "submitted",
    submittedAt: Date.now(),
    root: rootNodeHash,
  });

  // 6. 自动撤销 Access Token（必须）
  await revokeToken(ticket.accessTokenId, accessToken.tokenId);
}
```

---

## 6. 鉴权中间件设计

### 6.1 中间件层次

```
┌─────────────────────────────────────────────────────────────┐
│                     请求处理流程                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  请求 ──▶ [Token 解析] ──▶ [Token 验证] ──▶ [权限检查]       │
│                                                              │
│           ┌──────────────────────────────────────────────┐  │
│           │              Token 解析                       │  │
│           │  - 从 Authorization Header 提取完整 Token    │  │
│           │  - Base64 解码得到 128 字节二进制            │  │
│           └──────────────────────────────────────────────┘  │
│                              │                               │
│                              ▼                               │
│           ┌──────────────────────────────────────────────┐  │
│           │              Token 验证                       │  │
│           │  - 计算 Token ID = hash(token_bytes)         │  │
│           │  - 从数据库获取 Token 记录                    │  │
│           │  - 验证未撤销、未过期                         │  │
│           └──────────────────────────────────────────────┘  │
│                              │                               │
│                              ▼                               │
│           ┌──────────────────────────────────────────────┐  │
│           │              权限检查                         │  │
│           │  - 路由级别的权限要求                         │  │
│           │  - 资源级别的访问控制                         │  │
│           └──────────────────────────────────────────────┘  │
│                              │                               │
│                              ▼                               │
│                         路由处理器                           │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 6.2 AuthContext 设计

```typescript
type DelegateAuthContext = {
  // Token 信息
  tokenId: string;
  tokenType: "delegate" | "access";
  flags: {
    isDelegate: boolean;
    isUserIssued: boolean;
    canUpload: boolean;
    canManageDepot: boolean;
  };

  // 授权范围
  realm: string;
  scope: Uint8Array;  // 32 bytes
  quota: number;
  expiresAt: number;

  // Issuer 信息
  issuerId: string;
  issuerType: "user" | "token";

  // 便捷方法
  isAccessToken(): boolean;
  canRead(): boolean;
  canWrite(): boolean;
  canManageDepot(): boolean;
};
```

### 6.3 中间件实现

> **验证方案**：客户端发送完整 Token（128 字节），服务端计算 `hash(token) == stored_token_id` 验证身份。

```typescript
import { createMiddleware } from "hono/factory";
import { blake3_128, bytesToHex, EMPTY_SET_NODE_HASH } from "@casfa/core";

// 判断 scope 是否为空（只写 Token）
function isEmptyScope(scope: Uint8Array): boolean {
  const scopeHash = scope.slice(16);  // 后 16 bytes 是 hash
  return bytesToHex(scopeHash) === bytesToHex(EMPTY_SET_NODE_HASH);
}

const tokenAuthMiddleware = createMiddleware<{
  Variables: { auth: DelegateAuthContext };
}>(async (c, next) => {
  // 1. 提取完整 Token（Base64 编码的 128 字节）
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: { code: "MISSING_TOKEN" } }, 401);
  }

  const tokenBase64 = authHeader.slice(7);
  let tokenBytes: Uint8Array;
  try {
    tokenBytes = base64Decode(tokenBase64);
    if (tokenBytes.length !== 128) {
      throw new Error("Invalid token length");
    }
  } catch {
    return c.json({ error: { code: "INVALID_TOKEN_FORMAT" } }, 401);
  }

  // 2. 计算 Token ID 并验证
  const tokenId = blake3_128(tokenBytes);
  const tokenIdStr = `dlt1_${crockfordBase32Encode(tokenId).toLowerCase()}`;

  const tokenRecord = await tokensDb.getToken(tokenIdStr);
  if (!tokenRecord) {
    return c.json({ error: { code: "TOKEN_NOT_FOUND" } }, 401);
  }

  if (tokenRecord.isRevoked) {
    return c.json({ error: { code: "TOKEN_REVOKED" } }, 401);
  }

  if (tokenRecord.expiresAt < Date.now()) {
    return c.json({ error: { code: "TOKEN_EXPIRED" } }, 401);
  }

  // 3. 解码 Token 二进制数据（客户端发送的）
  const decoded = decodeDelegateToken(tokenBytes);

  // 4. 构建 AuthContext
  const auth: DelegateAuthContext = {
    tokenId: tokenIdStr,
    tokenType: decoded.flags.isDelegate ? "delegate" : "access",
    flags: decoded.flags,
    realm: bytesToHex(decoded.realm),
    scope: decoded.scope,
    quota: decoded.quota,
    expiresAt: decoded.ttl,
    issuerId: tokenRecord.issuerId,
    issuerType: tokenRecord.issuerType,
    issuerChain: tokenRecord.issuerChain,  // 预计算的 issuer chain

    isAccessToken: () => !decoded.flags.isDelegate,
    canRead: () => !decoded.flags.isDelegate && !isEmptyScope(decoded.scope),
    canWrite: () => !decoded.flags.isDelegate && decoded.flags.canUpload,
    canManageDepot: () => !decoded.flags.isDelegate && decoded.flags.canManageDepot,
  };

  c.set("auth", auth);
  await next();
});
```

### 6.4 路由级权限检查

```typescript
// 需要访问 Token 的路由
const accessTokenRequired = createMiddleware<{
  Variables: { auth: DelegateAuthContext };
}>(async (c, next) => {
  const auth = c.get("auth");
  if (!auth.isAccessToken()) {
    return c.json(
      { error: { code: "ACCESS_TOKEN_REQUIRED" } },
      403
    );
  }
  await next();
});

// 需要 Depot 管理权限的路由
const depotManageRequired = createMiddleware<{
  Variables: { auth: DelegateAuthContext };
}>(async (c, next) => {
  const auth = c.get("auth");
  if (!auth.canManageDepot()) {
    return c.json(
      { error: { code: "DEPOT_MANAGE_REQUIRED" } },
      403
    );
  }
  await next();
});

// 需要再授权 Token 的路由
const delegateTokenRequired = createMiddleware<{
  Variables: { auth: DelegateAuthContext };
}>(async (c, next) => {
  const auth = c.get("auth");
  if (auth.isAccessToken()) {
    return c.json(
      { error: { code: "DELEGATE_TOKEN_REQUIRED" } },
      403
    );
  }
  await next();
});
```

### 6.5 路由配置示例

```typescript
const app = new Hono();

// 所有 API 需要 Token 认证
app.use("/api/*", tokenAuthMiddleware);

// Node 读取 - 需要访问 Token
app.get(
  "/api/realm/:realmId/nodes/:key",
  accessTokenRequired,
  nodeReadHandler
);

// Node 写入 - 需要访问 Token + 上传权限
app.put(
  "/api/realm/:realmId/nodes/:key",
  accessTokenRequired,
  uploadRequired,
  nodeWriteHandler
);

// Depot 列表 - 需要访问 Token
app.get(
  "/api/realm/:realmId/depots",
  accessTokenRequired,
  depotListHandler
);

// Depot 创建 - 需要访问 Token + Depot 管理权限
app.post(
  "/api/realm/:realmId/depots",
  accessTokenRequired,
  depotManageRequired,
  depotCreateHandler
);

// Token 签发 - 需要再授权 Token
app.post(
  "/api/tokens/:tokenId/delegate",
  delegateTokenRequired,
  tokenDelegateHandler
);

// Ticket 创建 - 需要再授权 Token
app.post(
  "/api/realm/:realmId/tickets",
  delegateTokenRequired,
  ticketCreateHandler
);
```

---

## 附录 A: 错误码汇总

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `MISSING_TOKEN` | 401 | 缺少 Authorization Header |
| `INVALID_TOKEN_FORMAT` | 401 | Token 格式无效 |
| `TOKEN_NOT_FOUND` | 401 | Token 不存在 |
| `TOKEN_REVOKED` | 401 | Token 已被撤销 |
| `TOKEN_EXPIRED` | 401 | Token 已过期 |
| `ACCESS_TOKEN_REQUIRED` | 403 | 需要访问 Token |
| `DELEGATE_TOKEN_REQUIRED` | 403 | 需要再授权 Token |
| `INDEX_PATH_REQUIRED` | 400 | 缺少 Index-Path Header |
| `INVALID_INDEX_PATH` | 400 | Index-Path 格式无效 |
| `NODE_NOT_IN_SCOPE` | 403 | 节点不在授权范围内 |
| `NODE_NOT_FOUND` | 404 | 节点不存在 |
| `UPLOAD_NOT_ALLOWED` | 403 | Token 无上传权限 |
| `USER_QUOTA_EXCEEDED` | 413 | 用户配额不足 |
| `TOKEN_QUOTA_EXCEEDED` | 413 | Token 配额不足 |
| `DEPOT_MANAGE_REQUIRED` | 403 | 需要 Depot 管理权限 |
| `DEPOT_ACCESS_DENIED` | 403 | 无权访问该 Depot |
| `TICKET_NOT_FOUND` | 404 | Ticket 不存在 |
| `TICKET_ALREADY_SUBMITTED` | 400 | Ticket 已提交 |

---

## 附录 B: Header 规范

| Header | 用途 | 示例 |
|--------|------|------|
| `Authorization` | Token 认证 | `Bearer {base64_encoded_128_bytes}` |
| `X-CAS-Index-Path` | Scope 证明 | `0:1:2` |
| `X-CAS-Content-Type` | 节点 MIME 类型 | `application/json` |
| `X-CAS-Size` | 节点逻辑大小 | `1024` |
| `X-CAS-Kind` | 节点类型 | `dict` / `file` / `successor` / `set` |
