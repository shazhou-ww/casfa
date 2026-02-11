# Size-Flagged Hash 改造方案

> 日期: 2026-02-11
> 状态: 草案

---

## 目录

1. [动机](#1-动机)
2. [设计概述](#2-设计概述)
3. [Size Flag Byte 编码](#3-size-flag-byte-编码)
4. [Hash 算法抽象化](#4-hash-算法抽象化)
5. [影响分析](#5-影响分析)
6. [实施计划](#6-实施计划)
7. [旧数据清理](#7-旧数据清理)
8. [风险评估](#8-风险评估)

---

## 1. 动机

### 1.1 当前状况

Node 的 key（存储键）是对序列化 node 字节做 BLAKE3s-128 hash 后的纯 128-bit 摘要。
Key 本身不携带任何关于 node 大小的信息。

### 1.2 问题

未来如果实现**分层存储**（例如小 node 存 DB、大 node 存 S3），路由决策需要知道 node
大小。当前方案下，仅凭 key 无法判定，必须额外查询元数据或实际读取 node。

### 1.3 目标

在 key 的 128-bit 中"牺牲" 8 bit，嵌入一个表示 **node 序列化字节长度最小上界**的
标志字节（size flag byte），使得：

- 仅凭 key 即可在 O(1) 时间判定存储层级
- key 仍然是 node 内容的纯函数（保持内容寻址性质）
- 碰撞安全性损失可忽略

同时，借此机会将 `HashProvider` 从"提供 BLAKE3s-128 hash"抽象为"提供 128-bit
content-derived key"，使底层 hash 算法可替换，为本次改造及未来演进提供灵活性。

---

## 2. 设计概述

### 2.1 新 Key 生成流程

```
nodeBytes
  ├─ rawHash  = BLAKE3(nodeBytes).slice(0, 16)     // 16 bytes
  ├─ flagByte = computeSizeFlagByte(nodeBytes.length)
  └─ key[0..15] = [flagByte, rawHash[1], rawHash[2], ..., rawHash[15]]
```

即：用 size flag byte **替换** raw hash 的第一字节。

### 2.2 Key 仍然是内容的纯函数

```
content → nodeBytes → (size, rawHash) → key
```

`size` 由 `nodeBytes` 唯一确定，`rawHash` 由 `nodeBytes` 唯一确定，
因此 `key = f(content)`，内容寻址性质完好保留。

### 2.3 有效 hash 位数

从 128 bit 降至 120 bit。Birthday bound 碰撞概率：

$$P \approx \frac{n^2}{2^{121}}$$

即使 $n = 2^{40}$（万亿级 node），仍有 $P \approx 2^{-41} \approx 4.5 \times 10^{-13}$，完全可忽略。

---

## 3. Size Flag Byte 编码

### 3.1 编码公式

将一个字节分为高 4 位 `H` 和低 4 位 `L`：

```
flagByte = (H << 4) | L
sizeUpperBound = L × 16^H
```

### 3.2 编码表（部分）

| Flag Byte | H | L | 上界 | 含义 |
|-----------|---|---|------|------|
| `0x00` | 0 | 0 | 0 B | 空 node |
| `0x01`–`0x0F` | 0 | 1–15 | 1–15 B | 极小 |
| `0x11`–`0x1F` | 1 | 1–15 | 16–240 B | 小 |
| `0x21`–`0x2F` | 2 | 1–15 | 256–3,840 B | 中小 |
| `0x31`–`0x3F` | 3 | 1–15 | 4 KB–60 KB | 中 |
| `0x41`–`0x4F` | 4 | 1–15 | 64 KB–960 KB | 中大 |
| `0x51`–`0x5F` | 5 | 1–15 | 1 MB–15 MB | 大 |
| ... | ... | ... | ... | ... |
| `0xF1`–`0xFF` | 15 | 1–15 | ~1.15 EB–~17.3 EB | 极大 |

### 3.3 关键性质

**单调性**：flag byte 的自然字节序 ≡ 大小序。

证明：同一 `H` 内，`L` 增 → 上界增 → 字节值增。跨 `H` 时，`H` 层最大值
$15 \times 16^H < 16^{H+1}$ = 下一层最小非零值，而 `0x(H)F < 0x(H+1)1`。

这意味着可以直接用 key 的字典序范围查询来筛选特定大小级别的 node。

**层间空洞**：`L=0` 的位置（`0x10`, `0x20`, ..., `0xF0`）全部映射到 0，和 `0x00`
重复。共 15 个空洞，有效编码 241 个档位，利用率 94%。这些空洞恰好充当层间分隔符，
是保证严格单调性的必要代价。

### 3.4 计算 Flag Byte 的算法

```typescript
function computeSizeFlagByte(size: number): number {
  if (size <= 0) return 0x00;

  // 找到最小的 (H, L) 使得 L × 16^H >= size
  let power = 1; // 16^H
  for (let H = 0; H <= 15; H++) {
    // L = ceil(size / power), 需要 L <= 15
    const L = Math.ceil(size / power);
    if (L <= 15) {
      return (H << 4) | L;
    }
    power *= 16;
  }

  // size 超出编码范围（> 15 × 16^15 ≈ 17.3 EB），理论上不可能
  return 0xFF;
}
```

### 3.5 分层存储判定示例

设阈值 256 字节：

```typescript
function routeStorage(key: Uint8Array): "db" | "s3" {
  return key[0] <= 0x1F ? "db" : "s3";
  // 0x1F → H=1, L=15 → 上界 240 B → 实际 ≤ 240 → 存 DB
  // 0x21 → H=2, L=1  → 上界 256 B → 实际 ≤ 256 → 存 S3
}
```

一个字节比较即可路由，不需要查询 node 元数据。

---

## 4. Hash 算法抽象化

### 4.1 动机

当前 `HashProvider` 的注释和语义强绑定 BLAKE3s-128：

```typescript
// packages/core/src/types.ts
export type HashProvider = {
  /** Compute hash of data (BLAKE3s-128 for CAS\01) */
  hash: (data: Uint8Array) => Promise<Uint8Array>;
};
```

本次改造后，`hash()` 返回的不再是纯 BLAKE3s-128，而是"BLAKE3s-128 + 首字节被
size flag 替换"的复合结果。如果不做抽象化改造，语义会混乱。

### 4.2 重命名为 KeyProvider

将 `HashProvider` 重命名为 `KeyProvider`，语义从"计算 hash"变为"为 node 计算
128-bit 内容寻址 key"：

```typescript
/**
 * Key provider — computes a 128-bit content-addressed key for a node.
 *
 * The key is a pure function of the input bytes. The provider may use
 * any combination of hashing, size-flagging, or other deterministic
 * transforms, as long as the output is 16 bytes.
 *
 * Current implementation: BLAKE3s-128 with size-flag byte (byte 0).
 */
export type KeyProvider = {
  /**
   * Compute 128-bit content-addressed key.
   * @param data - Serialized node bytes
   * @returns 16-byte key as Uint8Array
   */
  computeKey: (data: Uint8Array) => Promise<Uint8Array>;
};

/**
 * @deprecated Use KeyProvider instead. Will be removed in next major version.
 */
export type HashProvider = KeyProvider;
```

### 4.3 为什么用别名而非直接删除

`HashProvider` 被以下位置直接引用：

| 位置 | 引用方式 |
|------|----------|
| `packages/core/src/types.ts` | 定义 |
| `packages/core/src/controller.ts` | `CasContext.hash` |
| `packages/core/src/node.ts` | 所有 `encode*Node` 参数 |
| `packages/core/src/validation.ts` | `validateNode` 参数 |
| `packages/fs/src/types.ts` | `FsContext.hash` |
| `packages/explorer/src/types.ts` | `ExplorerProps.hash` |
| `packages/explorer/src/core/explorer-store.ts` | `CreateExplorerStoreOpts.hash` |
| `apps/server/backend/src/util/hash-provider.ts` | `CombinedHashProvider extends HashProvider` |
| `apps/server/frontend/src/lib/storage.ts` | `hashProvider: HashProvider` |
| `apps/cli/src/commands/node.ts` | 内联对象 |

保留 `HashProvider` 为 deprecated alias 可以在过渡期避免一次性大面积改动，
允许下游按自己的节奏迁移。

---

## 5. 影响分析

### 5.1 Breaking Change 清单

| 层 | 影响 | 说明 |
|----|------|------|
| **Key 格式** | 🔴 不兼容 | 所有 node key 改变（首字节不同）|
| **Well-known keys** | 🔴 需更新 | `EMPTY_DICT_KEY` 需重新计算 |
| **S3 存储路径** | 🟡 路径前缀变化 | 默认前缀从 `cas/blake3s/` 改为 `cas/v1/` |
| **NODE_KEY_REGEX** | 🟢 不需要改 | CB32 字符集不变 |
| **DB 中已有 key** | � 需清理 | 服务未上线，直接删除旧数据即可 |
| **客户端缓存** | 🟢 自动失效 | IndexedDB 中缓存的 node 数据（key 不匹配，自动 miss）|

### 5.2 逐包影响

#### `packages/core`

| 文件 | 改动 |
|------|------|
| `types.ts` | `HashProvider` → `KeyProvider` (保留 deprecated alias) |
| `constants.ts` | 无需修改（Magic 和 HASH_ALGO 不变） |
| `node.ts` | `encode*Node` 中 `hashProvider.hash` → `keyProvider.computeKey` |
| `validation.ts` | `validateNode` 参数类型更新 |
| `controller.ts` | `CasContext.hash` → `CasContext.key` |
| `well-known.ts` | `EMPTY_DICT_KEY` 重新计算 |
| `header.ts` | 无需修改 |
| `utils.ts` | 新增 `computeSizeFlagByte()` |
| `index.ts` | 导出新类型和函数 |

#### `packages/fs`

| 文件 | 改动 |
|------|------|
| `types.ts` | `FsContext.hash` → `FsContext.key` |
| `tree-ops.ts` | 读取 `ctx.key` 替代 `ctx.hash` |
| `write-ops.ts` | 同上 |

#### `packages/explorer`

| 文件 | 改动 |
|------|------|
| `types.ts` | `ExplorerProps.hash` → `ExplorerProps.key` |
| `core/explorer-store.ts` | `CreateExplorerStoreOpts.hash` → `.key` |

#### `packages/protocol`

| 文件 | 改动 |
|------|------|
| `common.ts` | `EMPTY_DICT_NODE_KEY` 更新值 |

#### `packages/storage-s3`

| 文件 | 改动 |
|------|------|
| `s3-storage.ts` | S3 prefix 默认值从 `cas/blake3s/` 改为 `cas/v1/` |
| `storage-utils.ts` | `toStoragePath` 默认 prefix 更新为 `cas/v1/` |

#### `apps/server/backend`

| 文件 | 改动 |
|------|------|
| `src/util/hash-provider.ts` | `createNodeHashProvider` 返回 `KeyProvider` 实现 |
| `src/controllers/chunks.ts` | 适配新类型 |
| `src/controllers/depots.ts` | `EMPTY_DICT_KEY` 引用更新 |
| `src/app.ts` | 适配 |

#### `apps/server/frontend`

| 文件 | 改动 |
|------|------|
| `src/lib/storage.ts` | `hashProvider` → `keyProvider`，实现 `computeKey` |

#### `apps/cli`

| 文件 | 改动 |
|------|------|
| `src/commands/node.ts` | 内联的 hashProvider 更新为 KeyProvider 实现 |

### 5.3 S3 路径与 CB32 编码

**CB32 编码不变**：key 仍然是完整的 16 字节，使用相同的 Crockford Base32 编码，
不跳过 flag byte。这意味着 CB32 字符串的前几个字符会受 flag byte 影响，但这不会
造成混乱——CB32 key 只是一个 opaque 的标识符，外部不应依赖其字符分布。

S3 子目录仍使用 CB32 key 的前 2 个字符。虽然 flag byte 使分布不再完全均匀，但
S3 不像传统文件系统那样依赖目录均匀分散来获得性能，实际影响可忽略。

**S3 路径前缀**：默认前缀从 `cas/blake3s/` 改为 `cas/v1/`。服务未正式上线，
不需要 `v2` 标记。`blake3s` 不再适合作为前缀名（key 不再是纯 hash）。

---

## 6. 实施计划

### Phase 0: 准备（本次 PR 之前）

- [ ] 编写 `computeSizeFlagByte()` 函数及单元测试
- [ ] 验证编码单调性、全覆盖性、边界 case
- [ ] 编写 size flag byte → size bound 的反向解码函数及测试

### Phase 1: 抽象化 `HashProvider` → `KeyProvider`

**目标：纯重构，不改变行为。**

1. **`packages/core/src/types.ts`**
   - 新增 `KeyProvider` 类型（`computeKey` 方法）
   - 保留 `HashProvider` 为 deprecated alias
   - 同时保留 `hash` 字段作为 `computeKey` 的 alias（向后兼容）

2. **`packages/core/src/node.ts`**
   - 参数类型注解从 `HashProvider` 改为 `KeyProvider`
   - 调用从 `hashProvider.hash(nodeBytes)` 改为 `keyProvider.computeKey(nodeBytes)`

3. **`packages/core/src/validation.ts`**
   - 参数类型注解更新

4. **`packages/core/src/controller.ts`**
   - `CasContext` 中 `hash: HashProvider` → `key: KeyProvider`

5. **`packages/fs/src/types.ts`**
   - `FsContext.hash` → `FsContext.key`

6. **`packages/explorer/src/types.ts` + `core/explorer-store.ts`**
   - 对应属性名更新

7. **所有 `HashProvider` 创建点**
   - `apps/server/backend/src/util/hash-provider.ts`
   - `apps/server/frontend/src/lib/storage.ts`
   - `apps/cli/src/commands/node.ts`
   - 全部适配新接口（此阶段实现仍为纯 BLAKE3s-128）

8. **运行全量测试**，确保行为完全不变

> **Phase 1 可以独立合并**，降低后续 Phase 2 的 review 负担。

### Phase 2: 实现 Size-Flagged Hash

**目标：切换到新的 key 生成逻辑。**

> `computeSizeFlagByte()` 和 `decodeSizeFlagByte()` 已在 Phase 0 完成。

1. **所有 `KeyProvider` 实现点**
   - `computeKey` 实现改为：
     ```typescript
     async computeKey(data: Uint8Array): Promise<Uint8Array> {
       const rawHash = blake3(data, { dkLen: 16 });
       rawHash[0] = computeSizeFlagByte(data.length);
       return rawHash;
     }
     ```
   - 涉及文件：
     - `apps/server/backend/src/util/hash-provider.ts`
     - `apps/server/frontend/src/lib/storage.ts`
     - `apps/cli/src/commands/node.ts`

2. **`packages/core/src/well-known.ts`**
   - 重新计算 `EMPTY_DICT_KEY`
   - 更新 `WELL_KNOWN_NODES` 映射

3. **`packages/protocol/src/common.ts`**
   - 更新 `EMPTY_DICT_NODE_KEY`

4. **`packages/storage-s3/src/storage-utils.ts` + `s3-storage.ts`**
   - 默认 prefix 从 `cas/blake3s/` 改为 `cas/v1/`
   - 子目录仍使用 CB32 key 的前 2 字符（不跳过 flag byte）

5. **`packages/core/src/validation.ts`**
   - `validateNode` 增加 size flag 一致性校验：
     ```
     computeSizeFlagByte(bytes.length) === actualKey[0]
     ```

6. **不需要修改的文件**
   - `packages/core/src/constants.ts` — Magic 保持 `CAS\01`，`HASH_ALGO` 保持
     `BLAKE3S_128 = 0`（hash 算法本身未变，只是 key 首字节被后处理替换）
   - `packages/core/src/header.ts` — flags 不变
   - CB32 编码/解码逻辑 — key 仍是完整 16 字节，不跳过 flag byte

7. **更新所有测试**
   - 涉及硬编码 key 值的测试用例全部更新
   - 新增 size flag 相关测试

### Phase 3: 旧数据清理 & 收尾

详见 [§7 旧数据清理](#7-旧数据清理)。

- 清理 S3 旧前缀数据、DB 表数据
- 移除 `HashProvider` deprecated alias
- 更新 `CAS_BINARY_FORMAT.md` 规范文档

---

## 7. 旧数据清理

> 服务尚未正式上线，没有生产用户数据。直接删除旧数据即可，无需迁移。

### 7.1 S3

删除旧前缀下所有对象：

```bash
# 旧前缀（如果有历史数据）
aws s3 rm s3://<bucket>/cas/blake3s/ --recursive
```

### 7.2 DB

涉及存储 node key 的表：

| 表/字段 | 处理方式 |
|---------|----------|
| `depots` | 删除所有 depot，或将 `root` 重置为新的 `EMPTY_DICT_NODE_KEY` |
| `ownership_v2` | 清空表 |
| 其他引用 node key 的索引 | 清空 |

可以通过重建 DynamoDB 表或运行清理脚本完成。

### 7.3 客户端缓存

IndexedDB 缓存在 key 变化后自动 miss，无需特殊处理。
用户刷新页面后缓存自然冷启动。

### 7.4 步骤清单

1. **部署新代码**（Phase 2 完成后）
2. **清空 S3 旧前缀** `cas/blake3s/`
3. **清空/重建 DB 表**
4. **验证**：创建新 depot，上传文件，确认新 key 格式正确

---

## 8. 风险评估

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| 碰撞概率增加 (128→120 bit) | 🟢 低 | $2^{-41}$ @ 万亿 node，可忽略 |
| 大量代码需改动（类型重命名） | 🟡 中 | Phase 1 做纯重构，与功能变更分离 |
| 旧数据清理 | 🟢 低 | 服务未上线，直接删除旧数据 |
| S3 路径分布不均 | � 低 | S3 性能不依赖目录均匀分布，影响可忽略 |
| 第三方集成中断 | 🟢 低 | 保留 deprecated alias，版本号 major bump |
| 上线后发现遗漏旧数据引用 | 🟢 低 | 部署前 grep 全量代码确认无硬编码旧 key |
