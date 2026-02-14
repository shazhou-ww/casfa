# StorageProvider `has` 方法移除方案

> 创建日期：2026-02-14  
> 状态：RFC（待讨论）

## 动机

当前 `StorageProvider` 接口有三个方法：`has` / `get` / `put`。

```typescript
type StorageProvider = {
  has: (key: string) => Promise<boolean>;
  get: (key: string) => Promise<Uint8Array | null>;
  put: (key: string, value: Uint8Array) => Promise<void>;
};
```

`has` 存在的职责不清晰：

1. **`get` 已经隐含了 `has`** — `get()` 返回 `null` 等价于 `has() === false`
2. **"某个 key 是否存在"是业务/索引层的问题**，不是存储层的问题。Server 端已有 DynamoDB 记录 ownership，client 端 `storage-cached` 已知本地有什么
3. **`has` 导致 storage 实现承担了不属于它的缓存职责** — `storage-fs` 和 `storage-s3` 各自维护一份 LRU 存在性缓存，代码完全重复

## 目标接口

```typescript
type StorageProvider = {
  get: (key: string) => Promise<Uint8Array | null>;
  put: (key: string, value: Uint8Array) => Promise<void>;
};
```

两个方法，零歧义。Storage 回归最简单的存储职责。

## 设计原则

### `has` 从接口中移除，但 `put` 内部可自行优化

`has` 不再是公开 API，但各 storage 实现**可在 `put()` 内部自行做存在性检查**来避免冗余写入——这是实现细节，不是接口契约：

```typescript
// storage-fs 内部实现
const put = async (key: string, value: Uint8Array): Promise<void> => {
  const filePath = toFilePath(key);
  if (existsSync(filePath)) return;  // 内部优化：stat 比 write 便宜
  writeFileSync(filePath, value);
};

// storage-s3 内部实现
const put = async (key: string, value: Uint8Array): Promise<void> => {
  try {
    await s3.send(new HeadObjectCommand({ ... }));
    return;  // 内部优化：HeadObject 比 PutObject 便宜
  } catch { /* not found, proceed to put */ }
  await s3.send(new PutObjectCommand({ ... }));
};

// storage-memory 内部实现 — Map.set 天然幂等，无需检查
const put = async (key: string, value: Uint8Array): Promise<void> => {
  data.set(key, value);
};
```

**关键区别**：当前设计中 `has` 是接口的一部分，消费方可以（且确实在）调用它——导致了职责混乱。移除后，存在性判断**只在内部发生**（性能优化）或**交给上层**（业务逻辑）。

### `storage-cached` 回归简单串联

`storage-cached` 不再需要独立的 `has` 逻辑，变成纯粹的两层 StorageProvider 组合：

```typescript
const createCachedStorage = (cache: StorageProvider, remote: StorageProvider) => ({
  async get(key: string): Promise<Uint8Array | null> {
    const cached = await cache.get(key);
    if (cached) return cached;
    const data = await remote.get(key);
    if (data) await cache.put(key, data);  // write-back to cache
    return data;
  },
  async put(key: string, value: Uint8Array): Promise<void> {
    await cache.put(key, value);
    await remote.put(key, value);  // write-through（或 write-back 变体）
  },
});
```

每层的 `put` 内部各自处理去重（cache 层通常是 memory/IndexedDB 幂等写入，remote 层可以做 HeadObject 检查），`storage-cached` 自身不关心。

## 当前 `has()` 调用分析

### Storage 内部使用（6 处）

| 位置 | 用途 | 移除后处理 |
|---|---|---|
| `storage-fs/has()` | 公开的存在性检查 API | 删除公开方法。`put()` 内部保留 `existsSync` 优化 |
| `storage-fs/put()` | 写入前调用 `has()`，跳过重复写 | 改为直接 `existsSync(filePath)`，不经过 LRU |
| `storage-s3/has()` | 公开的 HeadObject 检查 | 删除公开方法。`put()` 内部保留 HeadObject 优化 |
| `storage-s3/put()` | 写入前调用 `has()`，跳过重复写 | 改为直接 HeadObject 检查，不经过 LRU |
| `storage-cached/has()` | `cache.has → remote.has` 分层检查 | 删除。上层用 `get()` 返回 null 判断 |
| `storage-cached/sync()` | fallback 逐 key 检查远端是否存在 | 用 `remote.checkMany`（已有）或尝试 put |

### 业务层使用（5 处）

| 位置 | 用途 | 移除后处理 |
|---|---|---|
| `server/chunks.ts` check endpoint | 分类 key 为 missing/owned/unowned | DB 层查询 ownership 表（已有 `checkMany`） |
| `server/chunks.ts` put 校验 | 验证子节点存在才接受父节点 | DB 层查询 node 记录 |
| `server/depots.ts` | 验证新 depot root 存在 | DB 层查询 |
| `core/controller.ts` | 公开 has API | 删除此 API 或改为 `get() !== null` |
| `fs/write-ops.ts` | 检查 link target 存在 | FS 元数据层查询 |

### 性能优化场景

| 场景 | 解决方式 |
|---|---|
| 需要高频存在性判断 | 调用方自建 `Set<string>` / LRU 缓存 |
| S3 HeadObject vs GetObject | 上层 DB 已有记录，不需要问 S3 |
| 批量同步 check | `checkMany` 已在 HTTP 层实现，不依赖 `has` |

## 收益

1. **接口精简** — `StorageProvider` 从 3 个方法降到 2 个，语义更清晰

2. **消除 P0 #2 重复** — LRU 存在性缓存层不再需要，`storage-utils.ts`（两份副本）**整个删除**（~56 行 × 2），连同 `quick-lru` 依赖一起删除。`toStoragePath` 内联到各 storage 实现（一行代码）

3. **Storage 实现简化**
   - `storage-fs`：删除公开 `has` + LRU 缓存；`put` 内部保留简单的 `existsSync` 检查
   - `storage-s3`：删除公开 `has` + LRU 缓存；`put` 内部保留 HeadObject 检查
   - `storage-memory`/`storage-indexeddb`/`storage-http`：删除 `has` 方法

4. **职责清晰** — "key 是否存在"的判断权回归业务/索引层（DB），存储层只管读写字节，`put` 内部的去重是实现优化而非接口契约

5. **`storage-cached` 回归简单串联** — 不需要独立 `has` 逻辑，变成纯粹的 cache → remote 组合

## 风险

1. **向后兼容** — 所有 StorageProvider 实现和消费方都需要同步修改
2. **第三方消费方** — 如果外部代码依赖 `has` 方法，需要迁移指南
3. **`put()` 内部去重仍是各实现的责任** — 需确保 `storage-fs` 和 `storage-s3` 保留内部检查逻辑（`existsSync` / `HeadObject`），只是不再通过公开的 `has` 和共享的 LRU

## 迁移计划

### Phase 1：将 `has` 改为可选（向后兼容）

```typescript
type StorageProvider = {
  get: (key: string) => Promise<Uint8Array | null>;
  put: (key: string, value: Uint8Array) => Promise<void>;
  /** @deprecated 将在下个 major 版本移除。使用 get() 返回 null 判断或上层 DB 查询。 */
  has?: (key: string) => Promise<boolean>;
};
```

- 所有消费方使用 `storage.has?.()` 或 fallback `(await storage.get(key)) !== null`
- 逐步将业务层的 `has` 调用迁移到 DB 查询

### Phase 2：从 storage 实现中移除 `has`

- `storage-fs`：删除 `has` + LRU + `storage-utils.ts`
- `storage-s3`：同上
- 其他 storage 实现删除 `has`

### Phase 3：从接口中移除 `has`

- 删除 `StorageProvider.has` 属性
- 删除所有相关测试
- 更新文档

## 与 P0 #2 的关系

如果执行此方案，**P0 #2（storage-utils.ts 重复）自动解决**——`storage-utils.ts` 整个删除，`LRUCache`、`createLRUCache`、`toStoragePath` 都不再需要。`toStoragePath` 是各 storage 内部的路径映射逻辑，内联到各自实现中即可（一行代码）。

## 待讨论

- [ ] `storage-cached` 的 `sync` 路径不用 `has` 后，是否可以完全依赖 `checkMany`？
- [ ] `controller.ts` 公开的 `has` API 是否有外部消费方？
- [ ] 是否需要分 major 版本？还是当前都是内部使用可以直接改？
- [ ] `storage-fs` 内部去重用简单 `existsSync` 还是保留 LRU？（`existsSync` 足够便宜，LRU 可能不值得维护）
