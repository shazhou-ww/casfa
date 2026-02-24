# 01 — 新的 Token 二进制格式

## 概述

当前 Token 是 128 字节的固定大小二进制格式，包含了大量冗余信息（realm hash 32B、
scope hash 32B、quota 8B、flags 4B、magic 4B）。在新模型中，权限和 scope 完全由
Delegate 实体承载，Token 只需要：

1. **标识对应的 Delegate**（delegateId）
2. **包含随机 nonce**（使每个 token 唯一，hash 不可预测）
3. **AT 需要过期时间**

## 当前格式（128 字节）

```
Offset  Size  Field        Type      Description
──────────────────────────────────────────────────────
0       4     magic        u32 LE    0x01544C44 ("DLT\x01")
4       4     flags        u32 LE    isRefresh(0), canUpload(1), canManageDepot(2), depth(4-7)
8       8     ttl          u64 LE    过期时间 (epoch ms)，RT 为 0
16      8     quota        u64 LE    写入配额（预留，始终为 0）
24      8     salt         u64       随机盐
32      32    issuer       bytes     Delegate UUID (16B left-padded to 32B)
64      32    realm        bytes     Blake3-256(realm string)
96      32    scope        bytes     Blake3-256(scope roots)
```

**问题**：
- `magic` 和 `flags` 在新模型下不需要——验证通过哈希比对完成，不需要格式标记
- `flags` 中的 `canUpload`、`canManageDepot`、`depth` 是 Delegate 的属性，
  token 里嵌入它们没有意义（验证时以 Delegate 实体为准）
- `quota` 始终为 0，浪费 8 字节
- `issuer` 用 32 字节存 16 字节的 UUID，浪费 16 字节
- `realm` 占 32 字节（Blake3-256 hash），token 中不需要（Delegate 表以 delegateId 为主键）
- `scope` 占 32 字节，与 Delegate 冗余

## 新格式

Token 不包含任何头部信息（无 magic、无 type 标记）。
AT 和 RT 通过**字节长度**区分：32 字节 = AT，24 字节 = RT。

### Access Token（32 字节）

```
Offset  Size  Field        Type      Description
──────────────────────────────────────────────────────
0       16    delegateId   bytes     Delegate UUID v7 (16 bytes, raw binary)
16      8     expiresAt    u64 LE    过期时间 (epoch ms)
24      8     nonce        bytes     crypto random nonce
```

**Base64 编码**：`ceil(32 * 4/3)` = 44 字符（含 padding `==`）

### Refresh Token（24 字节）

```
Offset  Size  Field        Type      Description
──────────────────────────────────────────────────────
0       16    delegateId   bytes     Delegate UUID v7 (16 bytes, raw binary)
16      8     nonce        bytes     crypto random nonce
```

**Base64 编码**：`ceil(24 * 4/3)` = 32 字符（无 padding）

## 设计决策

### 为什么没有 magic number？

Magic number 的传统作用是格式识别和版本区分。但在新模型中：

- **格式识别不需要**：服务端验证 token 的方式是**比对哈希**——如果
  `Blake3-128(tokenBytes)` 不匹配 Delegate 上存的 `currentAtHash` / `currentRtHash`，
  就是无效的。随机数据不可能通过哈希比对。
- **版本区分**：旧 token 是 128 字节，新 AT 是 32 字节，新 RT 是 24 字节。
  三种长度完全不同，可以通过**字节长度**区分版本（过渡期内）。
- **去掉 magic 节省 4 字节**，让 token 更紧凑。

### 为什么没有 type 字段？

AT（32 字节）和 RT（24 字节）长度不同，服务端解码时根据字节长度即可区分。
不需要额外的 type 字段。

### 为什么不包含 realm？

采用**方案 C：Delegate 表主键改为 delegateId**。

`delegateId` 是全局唯一的 UUID v7，可以直接作为 Delegate 表的主键。
Token 中只需要 `delegateId`（16 字节）就能唯一定位对应的 Delegate 记录。

每个 Delegate 代理特定的 realm。即便未来支持单用户多 realm，
也通过创建多个 Delegate 实现，不影响 token 格式。

### 为什么 nonce 是 8 字节？

- 8 字节 = 64 位随机性，birthday bound ≈ 2^32 次签发才有 50% 碰撞概率
- 每个 Delegate 同一时间只有 1 个有效 RT 和 1 个有效 AT，实际碰撞概率可忽略
- 8 字节对齐，便于内存布局

### 为什么 flags 被移除？

旧格式的 `flags` 包含 `isRefresh`、`canUpload`、`canManageDepot`、`depth`。

- `isRefresh` → 通过字节长度区分（32B = AT, 24B = RT）
- `canUpload`、`canManageDepot`、`depth` → 这些是 Delegate 实体的属性，
  验证时从 DB 获取，token 中嵌入没有意义

## Token 哈希计算

服务端存储的不是 token 原文，而是 token 的哈希：

```
tokenHash = Blake3-128(tokenBytes)   // 16 字节
tokenHashHex = hex(tokenHash)        // 32 字符 hex string
```

Delegate 实体上存储 `currentRtHash` 和 `currentAtHash`，
类型为 hex 编码的 Blake3-128 哈希字符串。

## Token ID

在 API 响应中，Token ID 仍然使用 `tkn_` 前缀 + CrockfordBase32 编码：

```
tokenId = "tkn_" + CrockfordBase32(Blake3-128(tokenBytes))
```

但 Token ID 不再作为 DB 的主键——它只是一个对外展示的标识符。
服务端内部用 `currentRtHash` / `currentAtHash` 进行比对。

## 编码/解码接口

```typescript
// === 常量 ===
const AT_SIZE = 32;
const RT_SIZE = 24;
const DELEGATE_ID_SIZE = 16;
const NONCE_SIZE = 8;
const EXPIRES_AT_SIZE = 8;

const OFFSETS = {
  DELEGATE_ID: 0,    // 16 bytes — both AT and RT
  // AT layout:
  AT_EXPIRES_AT: 16, // 8 bytes
  AT_NONCE: 24,      // 8 bytes
  // RT layout:
  RT_NONCE: 16,      // 8 bytes
} as const;

// === 编码 ===
interface EncodeAccessTokenInput {
  delegateId: Uint8Array;  // 16 bytes (raw UUID v7)
  expiresAt: number;       // epoch ms
}

interface EncodeRefreshTokenInput {
  delegateId: Uint8Array;  // 16 bytes (raw UUID v7)
}

function encodeAccessToken(input: EncodeAccessTokenInput): Uint8Array;  // → 32 bytes
function encodeRefreshToken(input: EncodeRefreshTokenInput): Uint8Array; // → 24 bytes

// === 解码 ===
type DecodedAccessToken = {
  type: "access";
  delegateId: Uint8Array;  // 16 bytes
  expiresAt: number;       // epoch ms
  nonce: Uint8Array;       // 8 bytes
};

type DecodedRefreshToken = {
  type: "refresh";
  delegateId: Uint8Array;  // 16 bytes
  nonce: Uint8Array;       // 8 bytes
};

type DecodedToken = DecodedAccessToken | DecodedRefreshToken;

/**
 * 根据字节长度自动判断 AT / RT：
 *   32 bytes → Access Token
 *   24 bytes → Refresh Token
 *   其他长度 → 抛出错误
 */
function decodeToken(bytes: Uint8Array): DecodedToken;
```

## 格式对比总结

| | 旧格式 | 新 AT | 新 RT |
|---|---|---|---|
| **大小** | 128 字节 | 32 字节 | 24 字节 |
| **Base64 长度** | 172 字符 | 44 字符 | 32 字符 |
| **Magic** | 4B | 无 | 无 |
| **Type/Flags** | 4B | 无（按长度区分） | 无（按长度区分） |
| **DelegateId** | 32B (padded) | 16B (raw) | 16B (raw) |
| **ExpiresAt** | 8B | 8B | 无 |
| **Nonce** | 8B | 8B | 8B |
| **Realm** | 32B | 无 | 无 |
| **Scope** | 32B | 无 | 无 |
| **Quota** | 8B | 无 | 无 |
