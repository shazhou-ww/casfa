# Token 签发规范

> 版本: 1.0  
> 日期: 2026-02-05

---

## 目录

1. [概述](#1-概述)
2. [用户直接签发](#2-用户直接签发)
3. [Delegate Token 转签发](#3-delegate-token-转签发)
4. [Scope 计算规则](#4-scope-计算规则)
5. [签发记录与追溯](#5-签发记录与追溯)

---

## 1. 概述

### 1.1 签发类型

Token 签发分为两种类型：

| 类型 | 签发者 | Issuer 字段 | 验证方式 |
|------|--------|-------------|----------|
| **用户直接签发** | 已认证用户 | User ID hash | OAuth JWT |
| **转签发** | 再授权 Token | 父 Token ID | Token 验证 |

### 1.2 签发参数

所有签发操作需要以下参数：

| 参数 | 类型 | 必选 | 说明 |
|------|------|------|------|
| `type` | enum | 是 | `delegate` 或 `access` |
| `expiresIn` | number | 是 | 有效期（秒） |
| `canUpload` | boolean | 否 | 是否可上传 Node |
| `canManageDepot` | boolean | 否 | 是否允许管理 Depot |
| `quota` | number | 否 | 写入配额（字节） |
| `realm` | string | 是 | 授权 Realm |
| `scope` | string[] | 是 | CAS URI 数组 |

---

## 2. 用户直接签发

### 2.1 签发流程

```
┌─────────────────────────────────────────────────────────────┐
│                    用户直接签发流程                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. 验证用户身份                                             │
│     └── 解析 OAuth JWT，提取 user_id                        │
│                    │                                         │
│                    ▼                                         │
│  2. 验证签发参数                                             │
│     ├── Token 类型：不限                                     │
│     ├── 有效期：不限（业务可设上限）                          │
│     ├── 权限标志：不限                                       │
│     ├── Quota：不限                                          │
│     ├── Realm：必须是用户可访问的 realm                      │
│     └── Scope：必须使用 depot: 或 ticket: URI               │
│                    │                                         │
│                    ▼                                         │
│  3. 验证 Scope 归属                                          │
│     └── 每个 depot/ticket 必须属于指定 realm                 │
│                    │                                         │
│                    ▼                                         │
│  4. 计算 Scope Hash                                          │
│     ├── 单个 URI：直接使用节点 hash                          │
│     └── 多个 URI：创建 set-node                              │
│                    │                                         │
│                    ▼                                         │
│  5. 生成 Token                                               │
│     ├── 填充 Token 字段                                      │
│     ├── issuer = blake3_256(user_id)                        │
│     ├── flags.is_user_issued = 1                            │
│     └── 生成随机 salt                                        │
│                    │                                         │
│                    ▼                                         │
│  6. 存储与返回                                               │
│     ├── 计算 token_id = blake3_128(token_bytes)             │
│     ├── 预计算 issuerChain = [user_id]                      │
│     ├── 存储 Token 元数据到数据库（不含完整 token_bytes）   │
│     ├── 增加关联 set-node 的引用计数                        │
│     └── 通过 HTTPS 返回完整 Token 给客户端                  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 参数约束

| 参数 | 约束 | 说明 |
|------|------|------|
| Token 类型 | 不限 | 可签发再授权或访问 Token |
| 有效期 | 业务逻辑控制 | 可能对再授权和访问 Token 设不同上限 |
| canUpload | 不限 | 用户完全控制 |
| canManageDepot | 不限 | 用户完全控制 |
| Quota | 不限 | 用户完全控制 |
| Realm | 用户可访问 | 当前要求 realm = user_id |
| Scope | Depot/Ticket URI | 不能使用 node: URI |

### 2.3 Scope 验证

用户签发时，Scope 必须满足：

1. **URI 类型限制**：只能使用 `depot:` 或 `ticket:` URI
2. **归属验证**：每个 depot/ticket 必须属于指定 realm

```typescript
async function validateUserScope(
  realm: string,
  uris: string[],
  depotsDb: DepotsDb,
  ticketsDb: TicketsDb
): Promise<void> {
  for (const uri of uris) {
    const parsed = parseCasUri(uri);

    if (parsed.rootType === "node") {
      throw new Error("User issuance requires depot: or ticket: URI");
    }

    if (parsed.rootType === "depot") {
      const depot = await depotsDb.get(parsed.rootId);
      if (!depot || depot.realm !== realm) {
        throw new Error(`Depot ${parsed.rootId} not found in realm`);
      }
    }

    if (parsed.rootType === "ticket") {
      const ticket = await ticketsDb.get(parsed.rootId);
      if (!ticket || ticket.realm !== realm) {
        throw new Error(`Ticket ${parsed.rootId} not found in realm`);
      }
    }
  }
}
```

### 2.4 API 定义

```typescript
// POST /api/tokens
type CreateTokenRequest = {
  type: "delegate" | "access";
  expiresIn: number;
  canUpload?: boolean;
  canManageDepot?: boolean;
  quota?: number;
  realm: string;
  scope: string[];
};

type CreateTokenResponse = {
  tokenId: string;  // dlt_XXXXX 格式
  expiresAt: string; // ISO 8601
};
```

---

## 3. Delegate Token 转签发

### 3.1 转签发流程

```
┌─────────────────────────────────────────────────────────────┐
│                    转签发流程                                │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. 验证父 Token                                             │
│     ├── Token 存在于数据库                                   │
│     ├── Token 未被撤销                                       │
│     ├── Token 未过期                                         │
│     └── Token 类型是再授权 Token                             │
│                    │                                         │
│                    ▼                                         │
│  2. 验证签发参数                                             │
│     ├── Token 类型：不限                                     │
│     ├── 有效期：≤ 父 Token 剩余有效期                        │
│     ├── canUpload：≤ 父 Token 权限                           │
│     ├── canManageDepot：≤ 父 Token 权限                      │
│     ├── Quota：不限（运行时链式约束）                         │
│     ├── Realm：= 父 Token realm                              │
│     └── Scope：父 scope 的子集（relative index-path）        │
│                    │                                         │
│                    ▼                                         │
│  3. 计算子 Scope                                             │
│     ├── 解析父 Token 的 scope (set-node)                     │
│     ├── 对每个 relative index-path 定位子节点                │
│     └── 创建新的 set-node                                    │
│                    │                                         │
│                    ▼                                         │
│  4. 生成 Token                                               │
│     ├── 填充 Token 字段                                      │
│     ├── issuer = 父 token_id (左侧填充 0 到 32 bytes)        │
│     ├── flags.is_user_issued = 0                            │
│     └── 生成随机 salt                                        │
│                    │                                         │
│                    ▼                                         │
│  5. 存储与返回                                               │
│     ├── 计算 token_id = blake3_128(token_bytes)             │
│     ├── 验证深度限制 (parent.depth < 15)                    │
│     ├── 预计算 issuerChain = [...parent.issuerChain, tokenId]│
│     ├── 存储 Token 元数据到数据库（不含完整 token_bytes）   │
│     ├── 记录父子关系用于追溯和级联撤销                      │
│     ├── 增加关联 set-node 的引用计数                        │
│     └── 通过 HTTPS 返回完整 Token 给客户端                  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 参数约束

| 参数 | 约束 | 验证逻辑 |
|------|------|----------|
| Token 类型 | 不限 | 可签发再授权或访问 Token |
| 深度 | < 15 | `parent.depth < 15` |
| 有效期 | ≤ 父 Token TTL | `parentTtl - now >= expiresIn * 1000` |
| canUpload | ≤ 父权限 | `!input.canUpload \|\| parent.canUpload` |
| canManageDepot | ≤ 父权限 | `!input.canManageDepot \|\| parent.canManageDepot` |
| Quota | reserved | 当前版本不验证，字段保留 |
| Realm | = 父 Realm | `input.realm === parent.realm` |
| Scope | 父 scope 子集 | 使用 relative index-path |

### 3.3 Scope 子集验证

转签发时，scope 使用 **scope 相对路径**（relative index-path）表示，必须是父 scope 的子集。

> **说明**：这里的"相对路径"是指相对于父 Token 的 scope 的 CAS 节点路径，
> 而非 API URL 的相对路径。格式为 `.:index1:index2`，从父 scope 的节点向下索引。

```typescript
async function computeChildScope(
  parentScopeHash: Uint8Array,
  relativeUris: string[],
  storage: StorageProvider,
  hashProvider: HashProvider
): Promise<Uint8Array> {
  // 1. 获取父 scope 的 set-node
  const parentSetNode = await storage.get(hashToKey(parentScopeHash));
  if (!parentSetNode) {
    throw new Error("Parent scope not found");
  }
  const parentDecoded = decodeNode(parentSetNode);

  // 2. 解析每个 relative index-path
  const childHashes: Uint8Array[] = [];

  for (const relUri of relativeUris) {
    const relative = parseRelativePath(relUri);
    if (relative.type !== "index") {
      throw new Error("Re-delegation requires relative index-path");
    }

    // 3. 在父 scope 中定位子节点
    // 第一个 index 选择父 set-node 中的哪个根
    const rootIndex = relative.indices![0];
    if (rootIndex >= parentDecoded.children!.length) {
      throw new Error(`Root index ${rootIndex} out of bounds`);
    }

    let nodeHash = parentDecoded.children![rootIndex];

    // 继续沿 index path 向下
    for (let i = 1; i < relative.indices!.length; i++) {
      const node = await storage.get(hashToKey(nodeHash));
      const decoded = decodeNode(node!);
      const idx = relative.indices![i];

      if (!decoded.children || idx >= decoded.children.length) {
        throw new Error(`Index ${idx} out of bounds`);
      }
      nodeHash = decoded.children[idx];
    }

    childHashes.push(nodeHash);
  }

  // 4. 创建新的 set-node
  if (childHashes.length === 1) {
    // 单个节点，直接返回其 hash（填充到 32 bytes）
    const scope = new Uint8Array(32);
    scope.set(childHashes[0], 16);
    return scope;
  }

  const setNode = await encodeSetNode({ children: childHashes }, hashProvider);
  const scope = new Uint8Array(32);
  scope.set(setNode.hash, 16);
  return scope;
}
```

### 3.4 API 定义

```typescript
// POST /api/tokens/:tokenId/delegate
type DelegateTokenRequest = {
  type: "delegate" | "access";
  expiresIn: number;
  canUpload?: boolean;
  canManageDepot?: boolean;
  scope: string[];  // scope 相对路径数组（非 API 路径），如 [".:0", ".:1:2"]
};

// 注意：quota 字段当前版本保留，不在 API 中暴露

type DelegateTokenResponse = {
  tokenId: string;
  expiresAt: string;
};
```

---

## 4. Scope 计算规则

### 4.1 单个 URI

当 scope 只包含一个 URI 时：

```typescript
const parsed = parseCasUri(uri);
const nodeHash = await resolveUri(parsed, storage, depotsDb, ticketsDb);

// scope 字段存储 hash（16 bytes -> 32 bytes，左侧填充 0）
const scope = new Uint8Array(32);
scope.set(nodeHash, 16);
```

### 4.2 多个 URI

当 scope 包含多个 URI 时，创建 set-node：

```typescript
const nodeHashes: Uint8Array[] = [];
for (const uri of uris) {
  const parsed = parseCasUri(uri);
  const hash = await resolveUri(parsed, storage, depotsDb, ticketsDb);
  nodeHashes.push(hash);
}

// 使用现有的 encodeSetNode 函数
const setNode = await encodeSetNode({ children: nodeHashes }, hashProvider);

// set-node 会自动：
// 1. 按 hash 字节序排序
// 2. 去重
// 3. 计算 set-node 的 hash

const scope = new Uint8Array(32);
scope.set(setNode.hash, 16);
```

### 4.3 set-node 复用

为避免重复创建相同的 set-node，可以：

1. 计算 set-node 的 hash 前先查询是否已存在
2. 如果存在，直接使用现有的 hash
3. 如果不存在，创建并存储 set-node

```typescript
async function getOrCreateSetNode(
  children: Uint8Array[],
  storage: StorageProvider,
  hashProvider: HashProvider
): Promise<Uint8Array> {
  // 排序并去重
  const sorted = sortAndDedupeChildren(children);

  // 预计算 hash（不实际编码）
  const preHash = await computeSetNodeHash(sorted, hashProvider);
  const key = hashToKey(preHash);

  // 检查是否已存在
  if (await storage.has(key)) {
    return preHash;
  }

  // 创建并存储
  const encoded = await encodeSetNode({ children: sorted }, hashProvider);
  await storage.put(key, encoded.bytes);

  return encoded.hash;
}
```

### 4.4 Scope 继承图示

```
用户签发 Token A
scope = set-node[depot:X#root, depot:Y#root]
             │
             │ 转签发 (scope: [".:0", ".:0:1"])
             ▼
        Token B
        scope = set-node[depot:X#root, depot:X#root/child1]
             │
             │ 转签发 (scope: [".:1"])
             ▼
        Token C
        scope = depot:X#root/child1
```

---

## 5. 签发记录与追溯

### 5.1 存储设计

每个 Token 记录包含以下追溯信息：

```typescript
type TokenRecord = {
  // 主键
  pk: string;  // TOKEN#{tokenId}
  sk: string;  // METADATA

  // 注意：不存储完整 tokenBytes，只存储元数据
  // 完整 Token 通过 HTTPS 返回给客户端保管

  // 签发信息
  issuerId: string;      // 签发者 ID（user hash 或 parent token ID）
  issuerType: "user" | "token";
  parentTokenId?: string;  // 转签发时的父 Token ID
  issuerChain: string[];   // 预计算的签发链

  // 状态
  isRevoked: boolean;
  revokedAt?: number;
  revokedBy?: string;

  // 时间戳
  createdAt: number;
  expiresAt: number;

  // GSI for realm queries
  gsi1pk: string;  // REALM#{realm}
  gsi1sk: string;  // TOKEN#{tokenId}

  // GSI for issuer chain queries
  gsi2pk: string;  // ISSUER#{issuerId}
  gsi2sk: string;  // TOKEN#{tokenId}
};
```

### 5.2 Issuer Chain 查询

通过 GSI 可以快速查询：

1. **某个 Token 签发的所有子 Token**:
   ```typescript
   // Query GSI2: ISSUER#{tokenId}
   const children = await queryByIssuer(tokenId);
   ```

2. **追溯到用户**:
   ```typescript
   async function traceToUser(tokenId: string): Promise<string> {
     const token = await getToken(tokenId);
     if (token.issuerType === "user") {
       return token.issuerId;
     }
     return traceToUser(token.parentTokenId!);
   }
   ```

### 5.3 撤销级联

撤销 Token 时，可选择级联撤销所有子 Token：

```typescript
async function revokeToken(
  tokenId: string,
  revokerId: string
): Promise<void> {
  // 1. 标记当前 Token 为已撤销
  await markRevoked(tokenId, revokerId);

  // 2. 减少关联 set-node 的引用计数
  const token = await getToken(tokenId);
  if (token?.scopeSetNodeId) {
    await decrementSetNodeRefCount(token.scopeSetNodeId);
  }

  // 3. 级联撤销所有子 Token（必须）
  const children = await queryByIssuer(tokenId);
  for (const child of children) {
    await revokeToken(child.tokenId, revokerId);
  }
}
```

### 5.4 审计日志

关键操作记录审计日志：

```typescript
type TokenAuditLog = {
  pk: string;  // AUDIT#{tokenId}
  sk: string;  // {timestamp}#{action}

  tokenId: string;
  action: "create" | "revoke" | "expire" | "use";
  actorId: string;
  actorType: "user" | "token" | "system";
  details?: Record<string, unknown>;
  timestamp: number;
};
```

---

## 附录 A: 签发示例

### A.1 用户签发再授权 Token

```typescript
// 用户登录后，签发一个再授权 Token 给 Agent
const response = await fetch("/api/tokens", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${oauthToken}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    type: "delegate",
    expiresIn: 2592000,  // 30 days
    canUpload: true,
    canManageDepot: true,
    realm: "usr_abc123",
    scope: ["cas://depot:MAIN"],  // 主 Depot
  }),
});

const { tokenId } = await response.json();
// tokenId = "dlt_4XZRT7Y2M5K9BQWP3FNHJC6D"
```

### A.2 Agent 转签发访问 Token

```typescript
// Agent 使用再授权 Token 签发临时访问 Token
const response = await fetch("/api/tokens/dlt_4XZRT7Y2M5K9/delegate", {
  method: "POST",
  headers: {
    "Authorization": `Bearer dlt_4XZRT7Y2M5K9BQWP3FNHJC6D`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    type: "access",
    expiresIn: 3600,  // 1 hour
    canUpload: true,
    canManageDepot: false,
    quota: 10485760,  // 10 MB
    scope: [".:0:1", ".:0:2"],  // Depot 的特定子目录
  }),
});

const { tokenId } = await response.json();
// tokenId = "dlt_7YNMQ3KP2JDFHW8X9BCRT6VZ"
```

### A.3 使用访问 Token 读取数据

```typescript
// 使用访问 Token 读取节点
const response = await fetch("/api/realm/usr_abc123/nodes/ABCD1234", {
  headers: {
    "Authorization": `Bearer dlt_7YNMQ3KP2JDFHW8X9BCRT6VZ`,
    "X-CAS-Index-Path": "0:1:0",  // 证明节点在 scope 内
  },
});

const nodeData = await response.arrayBuffer();
```

---

## 附录 B: 错误处理

### B.1 签发错误

| 错误码 | 说明 | HTTP Status |
|--------|------|-------------|
| `INVALID_TOKEN_TYPE` | Token 类型无效 | 400 |
| `INVALID_EXPIRES_IN` | 有效期无效或超出父 Token | 400 |
| `INVALID_REALM` | Realm 无效或无权访问 | 403 |
| `INVALID_SCOPE` | Scope URI 格式无效 | 400 |
| `SCOPE_NOT_FOUND` | Scope 中的 depot/ticket 不存在 | 404 |
| `SCOPE_NOT_IN_REALM` | Scope 不属于指定 realm | 403 |
| `PARENT_NOT_DELEGATE` | 父 Token 不是再授权 Token | 403 |
| `PARENT_EXPIRED` | 父 Token 已过期 | 401 |
| `PARENT_REVOKED` | 父 Token 已被撤销 | 401 |
| `PERMISSION_EXCEEDED` | 请求权限超出父 Token | 403 |

### B.2 错误响应格式

```typescript
type ErrorResponse = {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
};

// 示例
{
  "error": {
    "code": "SCOPE_NOT_IN_REALM",
    "message": "Depot 'MAIN' does not belong to realm 'usr_abc123'",
    "details": {
      "depotId": "MAIN",
      "depotRealm": "usr_xyz789",
      "requestedRealm": "usr_abc123"
    }
  }
}
```
