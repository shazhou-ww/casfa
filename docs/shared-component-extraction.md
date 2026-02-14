# 公共组件提取分析报告

> 生成日期：2026-02-14  
> 最后更新：2026-02-14

本文档系统分析了 casfa 代码库中的重复代码和可提取为公共组件的模式，按优先级排列，附带具体文件位置和代码对比。

---

## 进度 Checklist

### P0 — 高优先级
- [x] **1. Crockford Base32 编解码** — 已提取到 `@casfa/encoding`，`protocol`/`core`/`server` 已迁移（`6fab294`）
- [ ] **2. storage-utils.ts 完全重复** — 待迁移到 `@casfa/storage-core`

### P1 — 中优先级
- [ ] **3. formatSize() 字节格式化** — `@casfa/encoding` 已包含实现，但 CLI/explorer 尚未迁移
- [ ] **4. PKCE 实现** — CLI 侧待迁移至 `@casfa/client-auth-crypto`
- [ ] **5. Base64URL 编解码** — `@casfa/encoding` 已包含实现，但消费端尚未迁移
- [ ] **6. Hash↔Key 转换函数** — 基础 CB32 已统一，上层转换函数待收敛
- [ ] **7. Prefixed ID↔Bytes 转换** — 待在 `@casfa/protocol` 添加泛型函数

### P2 — 低优先级
- [ ] **8. Storage Provider LRU + Dedup 模式** — 待提取 `withExistsCache()` 到 `@casfa/storage-core`
- [ ] **9. Result\<T, E\> 类型** — 待评估是否统一
- [ ] **10. waitForDynamoDB 重试逻辑** — 待提取到脚本共享模块
- [ ] **11. Blake3 哈希封装** — 待合并 server 内两个模块
- [ ] **12. concurrentPool 并发池** — 暂不提取，等第二个使用场景

### 已完成的基础设施
- [x] 创建 `@casfa/encoding` 包（零依赖，含 CB32 / base64url / hex / formatSize）
- [x] 消除 `core` ↔ `protocol` 循环依赖风险
- [x] 更新构建链和 tsconfig paths
- [x] 全部 21 个编码测试通过

---

## 下一步建议

根据**投入产出比**和**依赖关系**，建议按以下顺序继续提取：

### 第一批：低风险、高收益（利用已有 @casfa/encoding）

| 序号 | 任务 | 工作量 | 说明 |
|---|---|---|---|
| ① | **P1 #5 — Base64URL 消费端迁移** | ~30 min | `@casfa/encoding` 已有 `base64urlEncode`/`base64urlDecode`，只需将 `client-auth-crypto/pkce.ts`、`cli/pkce.ts`、`server/jwt-verifier.ts` 的内联实现替换为 import |
| ② | **P1 #3 — formatSize 消费端迁移** | ~20 min | `@casfa/encoding` 已有 `formatSize()`，替换 `cli/output.ts`、`cli/cache.ts`、`explorer/format-size.ts` 的本地实现 |
| ③ | **P1 #4 — PKCE 合并** | ~30 min | CLI 的 `pkce.ts` 整份删掉，改为 `import { generateCodeVerifier, generateCodeChallenge } from "@casfa/client-auth-crypto"`，将 `generateState()` 添加到 `client-auth-crypto` 导出 |

**收益**：三个任务合计消除约 ~110 行重复代码，风险极低（纯 import 替换 + 删除死代码）。

### 第二批：中等复杂度

| 序号 | 任务 | 工作量 | 说明 |
|---|---|---|---|
| ④ | **P0 #2 — storage-utils 迁移** | ~45 min | 将 `LRUCache`、`createLRUCache`、`toStoragePath` 迁入 `@casfa/storage-core`。需要给 `storage-core` 添加 `quick-lru` 依赖并更新 `storage-fs`/`storage-s3` 的 import。测试覆盖简单 |
| ⑤ | **P1 #7 — Prefixed ID 泛型函数** | ~1 hr | 在 `@casfa/protocol` 添加 `prefixedIdToBytes(prefix, id)` / `bytesToPrefixedId(prefix, bytes)`，然后将 `nod_`/`dlt_`/`tkn_`/`usr_` 各处转换改为基于此泛型实现 |
| ⑥ | **P1 #6 — Hash↔Key 收敛** | ~45 min | CB32 已统一后，将 `hashToNodeKey`/`nodeKeyToHash` 等函数统一到 `@casfa/protocol`，其他包直接 re-export 或 import |

### 第三批：按需处理

| 序号 | 任务 | 条件 |
|---|---|---|
| ⑦ | **P2 #8 — withExistsCache()** | 当 storage provider 需要重构时顺带做 |
| ⑧ | **P2 #10 — waitForDynamoDB** | 当 e2e/脚本维护时顺带做 |
| ⑨ | **P2 #11 — Blake3 合并** | 当 server hashing 逻辑变更时顺带做 |
| ⑩ | **P2 #9 — Result 类型** | 需要更多讨论，可能影响 API 签名 |

### 推荐起点

**建议从第一批 ①②③ 开始**——它们都是"函数已就位，只差替换 import"的工作，合起来一个小时内可完成，且能立即验证 `@casfa/encoding` 和 `@casfa/client-auth-crypto` 的公共包价值。完成后再做 ④ storage-utils 迁移（唯一剩余的 P0 项）。

---

## 目录

- [进度 Checklist](#进度-checklist)
- [下一步建议](#下一步建议)
- [P0 — 高优先级（三处以上重复 / 已知技术债）](#p0--高优先级)
  - [1. Crockford Base32 编解码（3 份副本）](#1-crockford-base32-编解码3-份副本) ✅
  - [2. storage-utils.ts 完全重复（2 份副本）](#2-storage-utilsts-完全重复2-份副本)
- [P1 — 中优先级（两处重复 / 值得统一）](#p1--中优先级)
  - [3. formatSize() 字节格式化（3 份变体）](#3-formatsize-字节格式化3-份变体)
  - [4. PKCE 实现（2 份副本）](#4-pkce-实现2-份副本)
  - [5. Base64URL 编解码（3+ 处内联）](#5-base64url-编解码3-处内联)
  - [6. Hash↔Key 转换函数（4 处变体）](#6-hashkey-转换函数4-处变体)
  - [7. Prefixed ID↔Bytes 转换（多处变体）](#7-prefixed-idbytes-转换多处变体)
- [P2 — 低优先级（可改善但影响较小）](#p2--低优先级)
  - [8. Storage Provider LRU + Dedup 模式](#8-storage-provider-lru--dedup-模式)
  - [9. Result\<T, E\> 类型](#9-resultt-e-类型)
  - [10. waitForDynamoDB 重试逻辑（4 份副本）](#10-waitfordynamodb-重试逻辑4-份副本)
  - [11. Blake3 哈希封装](#11-blake3-哈希封装)
  - [12. concurrentPool 并发池工具](#12-concurrentpool-并发池工具)
- [提取方案总览](#提取方案总览)
- [建议新建包：@casfa/encoding](#建议新建包casfaencoding) ✅

---

## P0 — 高优先级

### 1. Crockford Base32 编解码（3 份副本） ✅ 已完成

> **已于 2026-02-14 完成**：提取到 `@casfa/encoding` 包，`protocol`/`core`/`server` 均已迁移为 re-export + import。提交 `6fab294`。

**严重程度：Critical**  —— 代码已知重复，且注释中明确标记为"duplicated to avoid circular dep"。

| 位置 | 函数名 | 行数 |
|---|---|---|
| `packages/protocol/src/common.ts` L36–95 | `encodeCrockfordBase32()` / `decodeCrockfordBase32()` | ~55 行 |
| `packages/core/src/utils.ts` L124–180 | `encodeCB32()` / `decodeCB32()` | ~55 行 |
| `apps/server/backend/src/util/encoding.ts` L8–80 | `toCrockfordBase32()` / `fromCrockfordBase32()` | ~70 行 |

三处实现的算法**完全相同**，仅函数名和注释/格式不同：

```typescript
// protocol/src/common.ts
const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CROCKFORD_DECODE: Record<string, number> = {};
// ... build decode table ...
export function encodeCrockfordBase32(bytes: Uint8Array): string {
  let result = ""; let buffer = 0; let bitsLeft = 0;
  for (const byte of bytes) { buffer = (buffer << 8) | byte; bitsLeft += 8;
    while (bitsLeft >= 5) { bitsLeft -= 5; result += CROCKFORD_ALPHABET[(buffer >> bitsLeft) & 0x1f]; }
  }
  if (bitsLeft > 0) result += CROCKFORD_ALPHABET[(buffer << (5 - bitsLeft)) & 0x1f];
  return result;
}

// core/src/utils.ts — 完全相同的逻辑，函数名为 encodeCB32
// server/backend/src/util/encoding.ts — 完全相同的逻辑，函数名为 toCrockfordBase32
```

`core/src/utils.ts` 第 124 行的注释：
> `// Crockford Base32 (duplicated from @casfa/protocol to avoid circular dep)`

**根本原因**：`@casfa/core` 和 `@casfa/protocol` 之间存在循环依赖风险，因此各自维护了一份副本。

**建议**：提取到新包 `@casfa/encoding`（零依赖），`protocol`、`core`、`server` 均从此包导入，彻底消除循环依赖。

---

### 2. storage-utils.ts 完全重复（2 份副本）

**严重程度：Critical** —— 两个文件**逐字节相同**（56 行）。

| 位置 | 内容 |
|---|---|
| `packages/storage-fs/src/storage-utils.ts` | LRUCache 类型 + `createLRUCache()` + `toStoragePath()` |
| `packages/storage-s3/src/storage-utils.ts` | 完全相同 |

```typescript
// 两个文件完全一致：
import QuickLRU from "quick-lru";

export type LRUCache<K, V> = {
  get: (key: K) => V | undefined;
  set: (key: K, value: V) => void;
  has: (key: K) => boolean;
  delete: (key: K) => boolean;
  clear: () => void;
  size: () => number;
};

export const DEFAULT_CACHE_SIZE = 10000;

export const createLRUCache = <K, V>(maxSize: number): LRUCache<K, V> => {
  const cache = new QuickLRU<K, V>({ maxSize });
  return { get, set, has, delete, clear, size: () => cache.size };
};

export const toStoragePath = (key: string, prefix = "cas/v1/"): string => {
  const subdir = key.slice(0, 2);
  return `${prefix}${subdir}/${key}`;
};
```

**建议**：将 `LRUCache`、`createLRUCache`、`DEFAULT_CACHE_SIZE`、`toStoragePath` 迁移到 `@casfa/storage-core`，`storage-fs` 和 `storage-s3` 从中导入。注意 `storage-core` 目前零依赖，需要引入 `quick-lru`。

---

## P1 — 中优先级

### 3. formatSize() 字节格式化（3 份变体）

| 位置 | 行数 | 差异 |
|---|---|---|
| `packages/explorer/src/utils/format-size.ts` L1–22 | 22 行 | 支持 `null`/`undefined` → "—"；1 位小数 |
| `apps/cli/src/lib/output.ts` L212–218 | 7 行 | 2 位小数 |
| `apps/cli/src/lib/cache.ts` L162–167 | 6 行 | 阈值分支法，1–2 位小数 |

三者核心算法一致（`bytes / 1024^i`），仅格式化精度不同：

```typescript
// explorer — 1 位小数
const value = bytes / 1024 ** i;
return `${i === 0 ? value : value.toFixed(1)} ${UNITS[i]}`;

// cli/output — 2 位小数
return `${size.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;

// cli/cache — if/else 链
if (bytes < 1024) return `${bytes} B`;
if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
```

**建议**：提取为一个参数化的 `formatSize(bytes, { precision?, nullFallback? })` 到 `@casfa/encoding` 或独立工具包。CLI 和 explorer 统一导入。

---

### 4. PKCE 实现（2 份副本）

| 位置 | 函数 |
|---|---|
| `packages/client-auth-crypto/src/pkce.ts` L1–85 | `generateCodeVerifier()`, `generateCodeChallenge()`, `generatePkceChallenge()`, `verifyPkceChallenge()` |
| `apps/cli/src/lib/pkce.ts` L1–60 | `generateCodeVerifier()`, `generateCodeChallenge()`, `generateState()` |

两者都实现 RFC 7636 PKCE，核心逻辑等价：
- 都用 `crypto.subtle.digest("SHA-256", ...)` 计算 challenge
- 都用 `btoa` + replace 做 Base64URL 编码
- 随机生成方式略不同（charset-based vs base64-based）

**差异**：
- `client-auth-crypto` 验证 verifier 长度 (43–128)
- `cli` 未验证，且多出一个 `generateState()` = `crypto.randomUUID()`

**建议**：CLI 直接 `import { generateCodeVerifier, generateCodeChallenge } from "@casfa/client-auth-crypto"`。将 `generateState()` 添加到 `client-auth-crypto` 导出。

---

### 5. Base64URL 编解码（3+ 处内联）

同一段 Base64URL 编码逻辑散布在多处：

| 位置 | 实现方式 |
|---|---|
| `packages/client-auth-crypto/src/pkce.ts` L47–49 | 内联 `btoa(...).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")` |
| `apps/cli/src/lib/pkce.ts` L44–50 | 独立函数 `base64UrlEncode()` |
| `apps/server/backend/src/auth/jwt-verifier.ts` L58 | `base64UrlDecode()` 函数 |
| `apps/server/backend/src/controllers/oauth-auth.ts` L363 | `codeBytes.toString("base64url")` (Node.js API) |

**建议**：提取 `base64urlEncode()` / `base64urlDecode()` 到 `@casfa/encoding`，浏览器端和 Node.js 端共用。

---

### 6. Hash↔Key 转换函数（4 处变体）

| 位置 | 函数 |
|---|---|
| `packages/core/src/utils.ts` L187–199 | `hashToKey()` / `keyToHash()` — 用 `encodeCB32` |
| `packages/protocol/src/common.ts` L115–155 | `hashToNodeKey()` / `nodeKeyToHash()` / `storageKeyToNodeKey()` / `nodeKeyToStorageKey()` |
| `packages/fs/src/helpers.ts` ~L20–27 | `hashToStorageKey()` / `storageKeyToHash()` — 薄封装 |
| `apps/server/backend/src/util/scope-proof.ts` ~L34 | `hashToStorageKey()` — 内联封装 `encodeCB32` |

本质上都是 `CB32(hash)` 加可选前缀。

**建议**：统一 CB32 编解码后（#1），在 `@casfa/protocol` 中提供 `hashToKey` / `keyToHash` / `hashToNodeKey` / `nodeKeyToHash` 等全部变体，其他包直接导入。

---

### 7. Prefixed ID↔Bytes 转换（多处变体）

| 位置 | 处理的前缀 |
|---|---|
| `packages/protocol/src/common.ts` | `nod_` (nodeKeyToHash, hashToNodeKey) |
| `packages/delegate-token/src/token-id.ts` | `tkn_`, `dlt_` 等 (parseTokenId, formatTokenId) |
| `apps/server/backend/src/util/delegate-token-utils.ts` | `dlt_` (delegateIdToBytes, bytesToDelegateId) |
| `apps/server/backend/src/util/encoding.ts` | `usr_` (uuidToUserId, userIdToUuid) |

所有 prefixed ID 遵循同一模式：`prefix_` + CB32 编码。

**建议**：在 `@casfa/protocol` 中添加泛型函数：

```typescript
function prefixedIdToBytes(prefix: string, id: string): Uint8Array
function bytesToPrefixedId(prefix: string, bytes: Uint8Array): string
```

所有 `nod_`、`dlt_`、`tkn_`、`usr_` 等转换均基于此实现。

---

## P2 — 低优先级

### 8. Storage Provider LRU + Dedup 模式

`storage-fs` 和 `storage-s3` 的 `put()` 方法使用**完全相同的结构模式**：

```typescript
async put(key, value) {
  if (existsCache.get(key)) return;        // 1. 检查 LRU 缓存
  const exists = await has(key);           // 2. 检查后端存储
  if (exists) { existsCache.set(key, true); return; }
  await actualPut(key, value);             // 3. 写入
  existsCache.set(key, true);              // 4. 更新缓存
}
```

两者还提供相同的 `clearCache()` + `getCacheStats()` 接口。

**建议**：创建 `withExistsCache(provider, cacheSize): CachedStorageProvider` 包装器在 `@casfa/storage-core`，将 ~30 行缓存逻辑从每个 storage 实现中剥离。

---

### 9. Result\<T, E\> 类型

| 位置 | 形式 |
|---|---|
| `apps/server/backend/src/util/result.ts` (59 行) | `Result<T, E> = { ok: true; value: T } \| { ok: false; error: E }` + `ok()`, `err()`, `map()`, `flatMap()`, `unwrap()`, `unwrapOr()` |
| `packages/client/src/types/client.ts` ~L68 | `FetchResult<T> = { ok: true; data: T; status: number } \| { ok: false; error: ClientError }` |

两者都用 `ok: true | false` 做判别联合，但字段不同（`value` vs `data`）。

**建议**：考虑将通用 `Result` 类型提取到 `@casfa/protocol` 或新建 `@casfa/result`。`FetchResult` 因含 HTTP 特有字段 `status` 可保留为独立类型，但可基于 `Result` 构建。

---

### 10. waitForDynamoDB 重试逻辑（4 份副本）

| 位置 |
|---|
| `apps/server/backend/scripts/dev.ts` L158 |
| `apps/server/backend/scripts/dev-setup.ts` L30 |
| `apps/server/backend/e2e/setup.ts` L86 |
| `apps/server/backend/scripts/integration-test.ts` L131 |
| `apps/cli/scripts/e2e-test.ts` L195 |

所有实现结构相同：

```typescript
async function waitForDynamoDB(maxAttempts = N, delayMs = 1000) {
  for (let i = 0; i < maxAttempts; i++) {
    try { await checkDynamoDBConnection(); return true; }
    catch { await sleep(delayMs); }
  }
  return false;
}
```

**建议**：提取为 `apps/server/backend/scripts/shared/wait-for-dynamodb.ts`，CLI 的 e2e 脚本也从此导入。

---

### 11. Blake3 哈希封装

| 位置 | 函数 |
|---|---|
| `apps/server/backend/src/util/hashing.ts` | `blake3sBase32()`, `blake3s128()`, `blake3Hash()` |
| `apps/server/backend/src/util/hash-provider.ts` | `createNodeKeyProvider()` — 也用 `blake3(data, { dkLen: 16 })` |

两处都封装 `@noble/hashes/blake3`，`blake3s128()` 和 `hash-provider` 的 `computeKey` 都执行 `blake3(data, { dkLen: 16 })`。

**建议**：合并为单一模块，`hash-provider` 的 `computeKey` 复用 `hashing.ts` 的 `blake3s128()`。

---

### 12. concurrentPool 并发池工具

目前 `concurrentPool` 仅存在于 `packages/explorer/src/utils/concurrent-pool.ts`，但这是一个通用的并发控制工具，如果未来其他包（如 `fs`、`client`）需要批量操作时可能用到。

**建议**：暂不提取，但标记为候选公共组件。如果后续出现第二个使用场景再迁移。

---

## 提取方案总览

| 优先级 | 提取内容 | 目标位置 | 消除重复行数 | 状态 |
|---|---|---|---|---|
| **P0** | Crockford Base32 encode/decode | `@casfa/encoding` | ~180 行 (3 处) | ✅ 已完成 |
| **P0** | `storage-utils.ts` (LRU + toStoragePath) | `@casfa/storage-core` | ~56 行 (2 处) | ⬜ 待做 |
| **P1** | `formatSize()` 消费端迁移 | `@casfa/encoding`（已有实现） | ~35 行 (3 处) | 🔵 实现已就位 |
| **P1** | PKCE 实现 | CLI 导入 `@casfa/client-auth-crypto` | ~60 行 (1 处) | ⬜ 待做 |
| **P1** | Base64URL 消费端迁移 | `@casfa/encoding`（已有实现） | ~15 行 (3+ 处) | 🔵 实现已就位 |
| **P1** | 泛型 `prefixedIdToBytes` / `bytesToPrefixedId` | `@casfa/protocol` | ~40 行 | ⬜ 待做 |
| **P2** | `withExistsCache()` Storage 包装器 | `@casfa/storage-core` | ~60 行 (2 处) | ⬜ 待做 |
| **P2** | `waitForDynamoDB` 脚本工具 | `apps/server/backend/scripts/shared/` | ~40 行 (4–5 处) | ⬜ 待做 |
| **P2** | `Result<T, E>` 类型 | `@casfa/protocol` 或 `@casfa/result` | ~60 行 | ⬜ 待做 |
| **P2** | Blake3 哈希封装合并 | server 内合并 | ~30 行 | ⬜ 待做 |

**总计可消除约 ~580 行重复代码（已消除 ~180 行）。**

---

## @casfa/encoding 包 ✅ 已创建

> **状态：已完成** — 提交 `6fab294`

零运行时依赖的编码工具包，已解决 `core` ↔ `protocol` 循环依赖问题。

```
packages/encoding/
├── src/
│   ├── crockford-base32.ts    # encodeCB32 / decodeCB32 / isValidCB32
│   ├── base64url.ts           # base64urlEncode / base64urlDecode
│   ├── hex.ts                 # bytesToHex / hexToBytes
│   ├── format.ts              # formatSize
│   ├── index.ts
│   └── index.test.ts          # 21 tests
├── package.json
├── README.md
└── tsconfig.json
```

### 当前消费方

| 包 | 导入内容 | 迁移方式 |
|---|---|---|
| `@casfa/protocol` | `encodeCB32`, `decodeCB32`, `isValidCB32` | 本地实现删除，改为 re-export |
| `@casfa/core` | `encodeCB32`, `decodeCB32`, `bytesToHex`, `hexToBytes` | 本地实现删除，改为 re-export |
| `server/backend` | `encodeCB32`, `decodeCB32`, `isValidCB32` | 本地实现删除，改为 alias re-export |

### 待迁移消费方

| 包 | 可导入内容 | 当前状态 |
|---|---|---|
| `client-auth-crypto` | `base64urlEncode` | 内联 btoa+replace |
| `cli` | `base64urlEncode`, `formatSize` | 本地实现 |
| `explorer` | `formatSize` | 本地实现 |
| `server/jwt-verifier.ts` | `base64urlDecode` | 本地函数 |

### 依赖关系（已实现）

```
encoding (0 deps)
  ├── core
  ├── protocol
  └── server/backend

待接入：
  ├── client-auth-crypto  (base64url)
  ├── cli                 (base64url + formatSize)
  └── explorer            (formatSize)
```
