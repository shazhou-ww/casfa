# Delegate Token 规范

> 版本: 1.0  
> 日期: 2026-02-05

---

## 目录

1. [概述](#1-概述)
2. [权限模型](#2-权限模型)
3. [Token 类型](#3-token-类型)
4. [二进制编码格式](#4-二进制编码格式)
5. [Token ID 计算](#5-token-id-计算)
6. [Token 生命周期](#6-token-生命周期)

---

## 1. 概述

Delegate Token 是 CASFA 授权系统的核心凭证。所有数据访问都必须通过 Delegate Token 进行授权。

### 1.1 设计原则

| 原则 | 说明 |
|------|------|
| **统一格式** | 所有 Token 使用相同的 128 字节二进制格式 |
| **服务端验证** | Token ID 存储在服务端数据库，通过查库验证 |
| **不可篡改** | Token ID 是 Token 内容的 Blake3-128 hash |
| **可追溯** | 记录所有签发和撤销操作 |
| **深度限制** | Token 转签发链最大深度为 15 层 |

### 1.2 Token 角色

```
┌────────────────────────────────────────────────────────────┐
│                     Delegate Token                          │
├──────────────────────────┬─────────────────────────────────┤
│     再授权 Token          │        访问 Token               │
│  (Delegation Token)      │    (Access Token)               │
├──────────────────────────┼─────────────────────────────────┤
│ ✗ 不能访问数据            │ ✓ 可以访问数据                  │
│ ✓ 可以签发子 Token        │ ✗ 不能签发 Token                │
│ ✓ 可以创建 Ticket         │ ✗ 不能创建 Ticket               │
│ 较长生命周期（业务控制）   │ 较短生命周期（业务控制）         │
└──────────────────────────┴─────────────────────────────────┘
```

---

## 2. 权限模型

Delegate Token 的权限由 6 个维度组成：

### 2.1 授权 Realm（必选）

- **字段**: `realm-id` (32 bytes)
- **含义**: Token 可访问的数据隔离域
- **验证**: 所有数据访问必须验证 realm 匹配
- **当前约束**: realm-id 等于 user-id（未来可能支持多 realm）

### 2.2 Token 类型（必选）

- **字段**: `flags.is_delegate` (1 bit)
- **取值**:
  - `1` = 再授权 Token：可签发子 Token，不能访问数据
  - `0` = 访问 Token：可访问数据，不能签发 Token

### 2.3 是否可上传 Node

- **字段**: `flags.can_upload` (1 bit)
- **含义**: 是否允许上传新的 CAS 节点
- **约束**: 转签发时只能缩小，不能扩大

### 2.4 是否允许管理 Depot

- **字段**: `flags.can_manage_depot` (1 bit)
- **含义**: 是否允许创建、删除、commit Depot
- **约束**: 转签发时只能缩小，不能扩大

### 2.5 读权限 Scope（必选）

- **字段**: `scope` (32 bytes)
- **含义**: 可读取的节点范围，存储 set-node 的 Blake3-128 hash（左侧填充 0 到 32 bytes）
- **验证**: 读取时需提供 index-path 证明节点在 scope 内
- **存储**: set-node 保存在数据库中（非 CAS 存储），具有引用计数

### 2.6 写权限配额 Quota（保留字段）

- **字段**: `quota` (8 bytes, u64)
- **含义**: 允许上传的新节点总字节数（当前版本保留，暂不启用）
- **取值**:
  - `0` = 不限制配额
  - `> 0` = 限制总字节数
- **状态**: **Reserved** - 在 Token 二进制格式中预留空间，当前版本仅验证用户总配额

### 2.7 授权截止时间 TTL（必选）

- **字段**: `ttl` (8 bytes, u64)
- **含义**: 授权有效截止时间（Unix epoch 毫秒）
- **验证**: 超过此时间 Token 自动失效
- **约束**: 转签发时不能超过父 Token 的 TTL

---

## 3. Token 类型

### 3.1 再授权 Token (Delegation Token)

**用途**: 分发给 Agent 或第三方服务，允许其签发受限的访问 Token

**特性**:
- 不能直接访问数据（读写 Node、访问 Depot）
- 可以签发子 Token（再授权或访问）
- 可以创建 Ticket（工作空间）
- 建议较长生命周期（如 30 天）

**典型场景**:
```
User 签发再授权 Token 给 Agent X
    │
    └── Agent X 根据任务需要签发访问 Token
            │
            └── 访问 Token 用于实际数据操作
```

### 3.2 访问 Token (Access Token)

**用途**: 实际执行数据访问操作

**特性**:
- 可以读取 scope 内的 Node
- 可以写入 Node（如果有 quota 和 can_upload 权限）
- 可以访问 Depot（如果有 can_manage_depot 权限）
- 不能签发任何 Token
- 建议较短生命周期（如 1 小时）

**典型场景**:
```
Agent 签发访问 Token
    │
    ├── 读取指定 scope 下的文件
    ├── 上传新的节点（受 quota 限制）
    └── 操作 Depot（如果有权限）
```

### 3.3 用户直接签发 vs 转签发

| 属性 | 用户直接签发 | 转签发 |
|------|--------------|--------|
| Issuer | User ID hash | 父 Token hash |
| flags.is_user_issued | 1 | 0 |
| Token 类型 | 不限 | 不限 |
| TTL | 不限 | ≤ 父 Token TTL |
| Scope | Depot/Ticket URI | 父 scope 的子集 |
| 权限 | 不限 | ≤ 父 Token 权限 |

---

## 4. 二进制编码格式

### 4.1 总体布局 (128 字节)

```
┌────────────────────────────────────────────────────────────┐
│                    Delegate Token (128 bytes)               │
├────────┬────────┬────────┬────────┬────────────────────────┤
│ Offset │  Size  │ Field  │  Type  │ Description            │
├────────┼────────┼────────┼────────┼────────────────────────┤
│ 0      │ 4      │ magic  │ u32 LE │ 固定值 0x01544C44      │
│ 4      │ 4      │ flags  │ u32 LE │ Token 标志位           │
│ 8      │ 8      │ ttl    │ u64 LE │ 授权截止时间 (epoch ms)│
│ 16     │ 8      │ quota  │ u64 LE │ 写入配额 (0=不限)      │
│ 24     │ 8      │ salt   │ u64 LE │ 随机数                 │
│ 32     │ 32     │ issuer │ bytes  │ 签发者 ID              │
│ 64     │ 32     │ realm  │ bytes  │ 授权 Realm ID          │
│ 96     │ 32     │ scope  │ bytes  │ 读权限 Scope (hash)    │
└────────┴────────┴────────┴────────┴────────────────────────┘
```

### 4.2 Magic Number

```
字节序列: 0x44, 0x4C, 0x54, 0x01 ("DLT\x01" ASCII)
u32 LE 值: 0x01544C44
```

用于快速识别 Delegate Token 格式。

### 4.3 Flags 字段布局

```
Bit 0:    is_delegate      是否是再授权 Token (1=再授权, 0=访问)
Bit 1:    is_user_issued   是否由用户直接签发 (1=用户, 0=转签发)
Bit 2:    can_upload       是否可上传 Node
Bit 3:    can_manage_depot 是否允许管理 Depot
Bits 4-7: depth            Token 深度 (0=用户直接签发, 1-15=转签发层级)
Bits 8-31: reserved        保留，必须为 0
```

**Flags 组合示例**:

| 场景 | flags 值 | 二进制 | 说明 |
|------|----------|--------|------|
| 用户签发的再授权 Token（全权限） | 0x0F | `0000 0000 0000 1111` | depth=0 |
| 用户签发的访问 Token（全权限） | 0x0E | `0000 0000 0000 1110` | depth=0 |
| 用户签发的只读访问 Token | 0x02 | `0000 0000 0000 0010` | depth=0 |
| 转签发的访问 Token（只读，depth=1） | 0x10 | `0000 0000 0001 0000` | depth=1 |
| 转签发的访问 Token（可上传，depth=2） | 0x24 | `0000 0000 0010 0100` | depth=2 |

**深度限制**:
- depth=0 表示用户直接签发
- depth=1-15 表示转签发层级
- 转签发时 `child.depth = parent.depth + 1`
- 当 `parent.depth >= 15` 时，禁止继续转签发

### 4.4 TTL 字段

- **类型**: u64 LE
- **含义**: Unix epoch 毫秒
- **范围**: 有效的未来时间戳

```typescript
// 编码
const ttlMs = Date.now() + expiresInSeconds * 1000;
view.setBigUint64(8, BigInt(ttlMs), true);

// 解码与验证
const ttl = Number(view.getBigUint64(8, true));
if (ttl < Date.now()) {
  throw new Error("Token expired");
}
```

### 4.5 Quota 字段（Reserved）

- **类型**: u64 LE
- **含义**: 允许上传的总字节数（当前版本保留）
- **特殊值**: `0` 表示不限制
- **状态**: 当前版本填充为 `0`，未来版本启用

```typescript
// 编码（当前版本始终为 0）
view.setBigUint64(16, 0n, true);

// 解码（预留接口）
const quota = Number(view.getBigUint64(16, true));
const hasQuotaLimit = quota > 0;
```

### 4.6 Salt 字段

- **类型**: u64 LE
- **用途**: 确保相同参数的 Token 有不同的 Token ID
- **生成**: 使用密码学安全的随机数生成器

```typescript
// 生成
const salt = crypto.getRandomValues(new Uint8Array(8));
buffer.set(salt, 24);
```

### 4.7 Issuer 字段

- **类型**: 32 bytes
- **含义**: 签发者标识
- **格式**:
  - 用户签发: User ID 的 Blake3-256 hash
  - 转签发: 父 Token 的 Token ID（Blake3-128，左侧填充 0）

```typescript
// 用户签发
const issuer = blake3_256(userId);
buffer.set(issuer, 32);

// 转签发
const issuer = new Uint8Array(32);
issuer.set(parentTokenId, 16); // Token ID 是 16 bytes，左侧填充 0
buffer.set(issuer, 32);
```

### 4.8 Realm 字段

- **类型**: 32 bytes
- **含义**: 授权的 Realm 标识
- **格式**: Realm ID 的 Blake3-256 hash
- **当前约束**: 等于 User ID hash

### 4.9 Scope 字段

- **类型**: 32 bytes
- **含义**: 可读取节点的范围
- **格式**: Blake3-128 hash（左侧填充 0 到 32 bytes）

**存储规则**：
| 场景 | 存储值 | 说明 |
|------|--------|------|
| 单个 scope | 节点 hash | 直接存储目标节点的 hash |
| 多个 scope | set-node hash | 创建 set-node 存储多个节点 hash |
| 只写（无读权限） | empty set-node hash | 表示不可读取任何节点 |

> **注意**：Core 需要支持 empty set-node，虽然 CAS 中不存储空 set，但 server 的 set-node 表需要支持。

```typescript
// 单个 scope - 直接存储节点 hash
const scopeHash = parseUri(uris[0]).nodeHash;

// 多个 scope - 使用 set-node
const setNode = await encodeSetNode({
  children: uris.map(uri => parseUri(uri).nodeHash)
}, hashProvider);
const scopeHash = setNode.hash;

// 只写（无读权限） - 使用 empty set-node
const emptySetNode = await encodeSetNode({ children: [] }, hashProvider);
const scopeHash = emptySetNode.hash;  // 固定值

// 存储到 Token（16 bytes hash 填充到 32 bytes）
const scope = new Uint8Array(32);
scope.set(scopeHash, 16);
buffer.set(scope, 96);
```

---

## 5. Token ID 计算

### 5.1 计算方法

Token ID 是 Token 完整 128 字节内容的 Blake3-128 hash：

```typescript
const tokenBytes = new Uint8Array(128);
// ... 填充 token 内容 ...

const tokenId = blake3_128(tokenBytes);
// tokenId 是 16 bytes = 128 bits
```

> **注意**：数据库只存储 Token ID（hash），不存储完整的 Token 二进制数据。
> Token 通过 HTTPS 返回给客户端，客户端负责保管完整 Token。

### 5.2 Token ID 格式

用于 API 和存储时，Token ID 使用 Crockford Base32 编码：

```typescript
// 编码
const tokenIdStr = crockfordBase32Encode(tokenId);
// 例如: "4XZRT7Y2M5K9BQWP3FNHJC6D"

// 解码
const tokenId = crockfordBase32Decode(tokenIdStr);
```

### 5.3 Token 字符串格式

为便于识别，Token 字符串添加版本前缀（全小写）：

```
dlt1_{crockford_base32(token_id)}
```

例如: `dlt1_4xzrt7y2m5k9bqwp3fnhjc6d`

> **说明**：前缀 `dlt1` 表示 Delegate Token 版本 1，便于未来格式升级。

---

## 6. Token 生命周期

### 6.1 签发

```
┌─────────────────────────────────────────────────────────────┐
│                       Token 签发流程                         │
├─────────────────────────────────────────────────────────────┤
│ 1. 验证签发者身份（OAuth JWT 或父 Token）                    │
│ 2. 验证签发参数合法性                                        │
│ 3. 验证深度限制（depth < 15）                                │
│ 4. 生成 Token 二进制数据（包含随机 salt）                    │
│ 5. 计算 Token ID = Blake3-128(token_bytes)                  │
│ 6. 存储 Token 元数据到数据库（不含完整 token_bytes）         │
│ 7. 通过 HTTPS 返回完整 Token 给客户端                        │
└─────────────────────────────────────────────────────────────┘
```

> **安全说明**：数据库只存储 Token ID 和元数据，不存储完整的 Token 二进制数据。
> 客户端收到 Token 后需妥善保管，丢失后无法恢复。

### 6.2 验证

> **验证方案**：客户端发送完整 Token（128 字节 Base64 编码），服务端计算 hash 验证。

```
┌─────────────────────────────────────────────────────────────┐
│                       Token 验证流程                         │
├─────────────────────────────────────────────────────────────┤
│ 1. 从 Authorization Header 提取完整 Token（Base64）         │
│ 2. Base64 解码得到 128 字节二进制数据                       │
│ 3. 计算 Token ID = Blake3-128(token_bytes)                  │
│ 4. 从数据库查询 Token 记录                                   │
│ 5. 验证 Token 未被撤销、未过期 (ttl > now)                  │
│ 6. 解码 Token 二进制数据，提取权限信息用于后续鉴权          │
└─────────────────────────────────────────────────────────────┘
```

### 6.3 撤销

```
┌─────────────────────────────────────────────────────────────┐
│                       Token 撤销流程                         │
├─────────────────────────────────────────────────────────────┤
│ 1. 验证撤销者身份                                            │
│ 2. 验证撤销权限（只能撤销自己签发的 Token）                   │
│ 3. 标记 Token 为已撤销（保留记录用于追溯）                   │
│ 4. 级联撤销所有子 Token（必须）                              │
│ 5. 减少关联 set-node 的引用计数                              │
└─────────────────────────────────────────────────────────────┘
```

> **重要**：撤销操作必须级联撤销所有子 Token，确保权限收回的完整性。

### 6.4 过期处理

- Token 过期后自动失效，无需显式撤销
- 过期 Token 记录保留一段时间用于审计
- 定期清理过期超过保留期的 Token 记录
- **引用计数**：过期不会自动减少 set-node 引用计数，只有 Token 记录被删除时才减少

> **注意**：过期是静默失效，不触发级联撤销。引用计数在定期清理任务删除过期记录时才递减。

---

## 附录 A: TypeScript 类型定义

```typescript
/**
 * Delegate Token flags
 */
type DelegateTokenFlags = {
  /** 是否是再授权 Token */
  isDelegate: boolean;
  /** 是否由用户直接签发 */
  isUserIssued: boolean;
  /** 是否可上传 Node */
  canUpload: boolean;
  /** 是否允许管理 Depot */
  canManageDepot: boolean;
  /** Token 深度 (0-15)，用于限制委托链长度 */
  depth: number;
};

/**
 * Delegate Token 解码结果
 */
type DelegateToken = {
  /** Token 标志位 */
  flags: DelegateTokenFlags;
  /** 授权截止时间 (epoch ms) */
  ttl: number;
  /** 写入配额 (0=不限) */
  quota: number;
  /** 签发者 ID (32 bytes) */
  issuer: Uint8Array;
  /** Realm ID (32 bytes) */
  realm: Uint8Array;
  /** Scope hash (32 bytes) */
  scope: Uint8Array;
};

/**
 * Token 签发输入
 */
type DelegateTokenInput = {
  /** Token 类型 */
  type: "delegate" | "access";
  /** 授权截止时间 (秒) */
  expiresIn: number;
  /** 是否可上传 Node */
  canUpload?: boolean;
  /** 是否允许管理 Depot */
  canManageDepot?: boolean;
  /** 写入配额 */
  quota?: number;
  /** Realm ID */
  realm: string;
  /** Scope CAS URIs */
  scope: string[];
};
```

---

## 附录 B: 编码示例

```typescript
import { blake3_128, blake3_256 } from "@casfa/core";

function encodeDelegateToken(
  input: DelegateTokenInput,
  issuer: Uint8Array,
  isUserIssued: boolean,
  parentDepth: number = 0
): { bytes: Uint8Array; id: Uint8Array } {
  const buffer = new Uint8Array(128);
  const view = new DataView(buffer.buffer);

  // 验证深度限制
  const depth = isUserIssued ? 0 : parentDepth + 1;
  if (depth > 15) {
    throw new Error("Maximum token delegation depth exceeded");
  }

  // Magic
  view.setUint32(0, 0x01544C44, true);

  // Flags (包含 depth)
  let flags = 0;
  if (input.type === "delegate") flags |= 0x01;
  if (isUserIssued) flags |= 0x02;
  if (input.canUpload) flags |= 0x04;
  if (input.canManageDepot) flags |= 0x08;
  flags |= (depth & 0x0F) << 4;  // depth 占用 bits 4-7
  view.setUint32(4, flags, true);

  // TTL (服务端时间)
  const ttl = Date.now() + input.expiresIn * 1000;
  view.setBigUint64(8, BigInt(ttl), true);

  // Quota (reserved, 当前版本为 0)
  view.setBigUint64(16, 0n, true);

  // Salt
  const salt = crypto.getRandomValues(new Uint8Array(8));
  buffer.set(salt, 24);

  // Issuer (32 bytes)
  buffer.set(issuer, 32);

  // Realm (32 bytes)
  const realmHash = blake3_256(new TextEncoder().encode(input.realm));
  buffer.set(realmHash, 64);

  // Scope (32 bytes) - 需要先解析 URI 并创建 set-node
  // ... scope 计算逻辑 ...

  // 计算 Token ID
  const id = blake3_128(buffer);

  return { bytes: buffer, id };
}
```
