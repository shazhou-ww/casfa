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
  if (await exists(filePath)) return;  // 内部优化：stat 比 write 便宜
  await writeFile(filePath, value);
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

## `storage-cached` 架构简化：拆分缓存与同步

### 现状问题

当前 `storage-cached`（467 行）混合了两个正交职责：

1. **缓存装饰器**（~50 行）— `cache → remote` 的透明串联（`get` 读穿、`put` 写穿/写回）
2. **CAS 树同步引擎**（~250 行）— `syncTree`（BFS 树遍历）、`topoSortLevels`（Kahn 拓扑排序）、`checkMany`/`claim` 三态分发、`WriteBackConfig` 生命周期钩子、`PendingKeyStore` 持久化

同步引擎了解 CAS 树结构（parent→children）、服务端 ownership 模型（owned/unowned/missing）、PoP claim 协议——这些都不是"缓存"的职责。缓存装饰器应该是一个通用的、不了解 CAS 语义的 StorageProvider 组合器。

### 目标架构

| 模块 | 职责 | 代码量 |
|---|---|---|
| `storage-cached` | 纯缓存装饰器：`(cache, remote) → StorageProvider` | ~20 行 |
| `storage-http` 增强层 | 缓冲 put → 拓扑排序 → 批量 checkMany → claim/put 分发 | ~200 行 |

### `storage-cached`：纯缓存装饰器

```typescript
const createCachedStorage = (cache: StorageProvider, remote: StorageProvider): StorageProvider => ({
  async get(key) {
    const cached = await cache.get(key);
    if (cached) return cached;
    const data = await remote.get(key);
    if (data) await cache.put(key, data);
    return data;
  },
  async put(key, value) {
    await cache.put(key, value);
    await remote.put(key, value);
  },
});
```

不知道 CAS、HTTP、claim、树结构。纯粹的两层 StorageProvider 串联。

### `storage-http` 增强：缓冲式批量同步

将同步逻辑下沉到 HTTP 层，作为 `HttpStorageProvider` 的增强包装。HTTP 层天然了解 `checkMany`/`claim` 协议，同步逻辑放在这里最合适：

```typescript
type BufferedHttpStorageConfig = {
  /** 从 node bytes 中提取子节点 key，用于构建依赖图 */
  getChildKeys: (value: Uint8Array) => string[];
  /** 缓冲区 flush 前的 debounce 间隔 (ms) */
  debounceMs?: number;
  /** 可选：持久化 pending keys（browser 用 IndexedDB，Node.js 用 FS 等） */
  pendingKeyStore?: PendingKeyStore;
  /** 生命周期钩子 */
  onSyncStart?: () => void | Promise<void>;
  onSyncEnd?: (result: SyncResult) => void;
  onKeySync?: (key: string, status: "uploading" | "done" | "error", error?: unknown) => void;
};

/** 返回标准 StorageProvider + 控制方法 */
type BufferedHttpStorageProvider = StorageProvider & {
  /** 手动触发 flush（如 depot sync 完成后强制同步） */
  flush: () => Promise<void>;
  /** 清理资源（取消 debounce timer 等） */
  dispose: () => void;
};

const createBufferedHttpStorage = (
  http: HttpStorageProvider,
  config: BufferedHttpStorageConfig,
): BufferedHttpStorageProvider => {
  const buffer = new Map<string, Uint8Array>();

  return {
    get: (key) => http.get(key),

    async put(key, value) {
      buffer.set(key, value);   // 缓冲，不立即发送
      scheduleFlush();          // debounce 后触发 flush
    },

    async flush() {
      const entries = [...buffer.entries()].map(([key, value]) => ({ key, value }));
      buffer.clear();
      if (entries.length === 0) return;

      await config.onSyncStart?.();

      // 1. 拓扑排序：children-first
      const levels = topoSortLevels(entries, config.getChildKeys);

      // 2. 按层级批量 checkMany
      for (const level of levels) {
        const keys = level.map((e) => e.key);
        const status = await http.checkMany(keys);

        // 3. 分发：missing → put, unowned → claim, owned → skip
        for (const entry of level) {
          if (status.owned.includes(entry.key)) continue;
          if (status.unowned.includes(entry.key)) {
            await http.claim(entry.key, entry.value);
          } else {
            await http.put(entry.key, entry.value);
          }
        }
      }

      config.onSyncEnd?.({ synced, skipped, failed });
    },
  };
};
```

### 使用方组合

```typescript
// 之前（storage-cached 承担所有职责）
const storage = createCachedStorage({
  cache: indexedDB,
  remote: httpStorage,
  writeBack: { getChildKeys, onSyncStart, onSyncEnd, onKeySync },
});
await storage.syncTree(rootKey);   // 从根遍历整棵树

// 之后（职责分离）
const http = createHttpStorage({ client, getTokenBytes, popContext });
const buffered = createBufferedHttpStorage(http, {
  getChildKeys, debounceMs: 100, pendingKeyStore: indexedDBPendingStore, ...
});
const storage = createCachedStorage(indexedDB, buffered);
// storage.put(key, value)
//   → indexedDB.put(key, value)      ← 本地缓存
//   → buffered.put(key, value)       ← 缓冲，不立即发送
//   → debounce 后 → flush()
//     → topoSort → checkMany → claim/put
// 也可手动触发：
await buffered.flush();               // depot sync 完成后强制同步
```

### 优势

1. **缓冲比树遍历更精确** — 当前 `syncTree` 从 root 遍历整棵树，发现哪些节点需要上传。缓冲方式只处理实际 `put()` 过的节点——CAS 的不可变性保证旧节点已在远端，无需重新遍历
2. **同步逻辑与 HTTP 协议同层** — `checkMany`/`claim` 是 `HttpStorageProvider` 的原生能力，放在同一层消除了 `storage-cached` 对 remote 类型的 duck-typing（`remote.checkMany?`、`remote.claim?`）
3. **`storage-cached` 可复用** — 纯缓存装饰器可用于任何 StorageProvider 组合（memory + FS、IndexedDB + S3 等），不绑定 HTTP 语义
4. **`syncTree(rootKey)` API 消失** — 不再需要调用方手动触发同步和传入 rootKey，put 后自动 debounce flush

## 风险

1. **向后兼容** — 所有 StorageProvider 实现和消费方都需要同步修改。当前全部内部使用，无需分 major 版本，可直接改
2. **`put()` 内部去重仍是各实现的责任** — 需确保 `storage-fs` 和 `storage-s3` 保留内部检查逻辑（async `exists` / `HeadObject`），只是不再通过公开的 `has` 和共享的 LRU

## 迁移计划

全部内部使用，无需分 major 版本，一次性完成。

### Phase 1：移除 `has` 接口 + 简化 storage 实现

- `StorageProvider` 接口删除 `has`，只留 `get` / `put`
- `storage-fs`：删除 `has` + LRU + `storage-utils.ts`，`put()` 内部用 async `exists()` 去重（storage 本身是 async API，不需要 `existsSync`）
- `storage-s3`：同上，`put()` 内部保留 `HeadObject` 去重
- `storage-memory`/`storage-indexeddb`/`storage-http`：删除 `has` 方法
- `core/controller.ts`：删除公开的 `has` 函数（已确认无外部调用方）及其从 `index.ts` 的导出
- 业务层 `has` 调用全部迁移到 DB 查询或 `get() !== null`

### Phase 2：`storage-cached` 拆分

- `storage-cached` 瘦身为纯缓存装饰器（删除 ~400 行，剩 ~20 行）
- 删除 `syncTree`、`topoSortLevels`、`WriteBackConfig`、`PendingKeyStore`、`CachedStorageProvider` 等类型
- 导出简单的 `createCachedStorage(cache, remote) → StorageProvider`

### Phase 3：`storage-http` 增强

- 将 `topoSortLevels` 迁入 `storage-http`（暂无其他复用场景）
- 新增 `createBufferedHttpStorage(http, config)` — 缓冲 put → 拓扑排序 → 批量 checkMany → claim/put 分发
- `flush()` 既可通过构造参数控制自动触发（debounce），也作为返回对象上的方法供调用方手动触发
- 缓冲区持久化通过可选的 `PendingKeyStore` provider 传入（browser 用 IndexedDB，Node.js 用 FS 等）
- 前端消费方（`apps/server/frontend/src/lib/storage.ts`）改为组合 `createCachedStorage(indexedDB, bufferedHttp)`

## 与 P0 #2 的关系

如果执行此方案，**P0 #2（storage-utils.ts 重复）自动解决**——`storage-utils.ts` 整个删除，`LRUCache`、`createLRUCache`、`toStoragePath` 都不再需要。`toStoragePath` 是各 storage 内部的路径映射逻辑，内联到各自实现中即可（一行代码）。

## 决策记录

- [x] ~~`controller.ts` 公开的 `has` API 是否有外部消费方？~~ → 已确认无外部调用方，可直接删除
- [x] ~~是否需要分 major 版本？~~ → 不需要，全部内部使用，直接改
- [x] ~~`storage-fs` 内部去重用 `existsSync` 还是保留 LRU？~~ → 用 async `exists()`（storage 是 async API），删除 LRU
- [x] ~~`storage-cached` 的 `sync` 路径不用 `has` 后，是否完全依赖 `checkMany`？~~ → 同步逻辑整体迁移到 `storage-http` 增强层，`checkMany` 是其原生能力
- [x] ~~`BufferedHttpStorage.flush()` 的触发时机~~ → 构造参数控制自动 debounce + 返回对象暴露 `flush()` 手动触发
- [x] ~~`topoSortLevels` 放在哪个包？~~ → 暂放 `storage-http`，当前无其他复用场景
- [x] ~~缓冲区的持久化~~ → 通过可选的 `PendingKeyStore` provider 传入（browser/Node.js 各自实现）
