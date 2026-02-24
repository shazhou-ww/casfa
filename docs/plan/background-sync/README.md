# Background Async Sync

> 将 Web UI 的同步模型从「每次操作阻塞等待服务端完成」改为「本地即时完成 + 后台异步同步」。

## 现状

当前每个写操作（mkdir / upload / rename / delete）的流程：

```
localFs.op(root) → newRoot
  → await flush()          // 等所有 CAS 节点上传到服务端
    → await commit(newRoot) // 等 depot 指针更新
      → set(depotRoot)     // UI 才更新
```

**问题**：
1. 用户必须等 flush + commit 完成才能继续操作，体感很慢
2. `pendingKeys`（待同步的 CAS 节点 key 集合）只存在内存中，页面关闭/刷新即丢失
3. IndexedDB 中有数据但不知道哪些需要同步，无法恢复
4. 没有冲突检测——多端同时操作同一 depot 时 silent overwrite

## 目标流程

```
localFs.op(root) → newRoot
  → set(depotRoot)         // UI 立即更新，用户可以继续操作
  → syncManager.enqueue()  // fire-and-forget，入队后台任务
                ↓
        (后台 debounced)
  CachedStorage.flush()    // 批量上传 CAS 节点 (Layer 1)
  → commit(latestRoot)     // 只提交最新 root  (Layer 2)
```

**核心依据**：CAS 节点是 immutable 的，put 是幂等的。冲突只发生在 depot 指针更新。

## 两层同步模型

同步明确分为两个独立层次，各自职责清晰：

```
┌─────────────────────────────────────────────┐
│  Explorer Store / Upload Hook               │
│  写操作 → set(root) → scheduleCommit()       │
└──────────────┬──────────────────────────────┘
               │
┌──────────────▼──────────────────────────────┐
│  Layer 2: Depot Commit Sync (SyncManager)   │
│  - 有状态：冲突检测、retry、recover          │
│  - 依赖 Layer 1 的 flush() 作为前置条件      │
│  - 持久化：depot-queue (IndexedDB)           │
└──────────────┬──────────────────────────────┘
               │ await flush() 然后 commit()
┌──────────────▼──────────────────────────────┐
│  Layer 1: CAS Node Sync (CachedStorage)     │
│  - 完全幂等：put/claim 是 content-addressed  │
│  - 无冲突：相同 key = 相同内容               │
│  - 持久化：pending-sync (IndexedDB)          │
└─────────────────────────────────────────────┘
```

### Layer 1: CAS Node Sync

| 属性 | 说明 |
|------|------|
| 职责 | `CachedStorage` 的 write-back 模式：`pendingKeys` → `flush()` → `remote.put()` / `remote.claim()` |
| 幂等性 | **完全幂等**。CAS 节点是 content-addressed，相同 key 对应相同内容，put 任意多次结果一致 |
| 冲突 | **无冲突**。多端 put 同一 key 时内容必然相同 |
| 持久化 | 通过可插拔的 `PendingKeyStore` 接口持久化到 IndexedDB `pending-sync` store |
| 恢复 | 初始化时 `load()` → 触发 sync cycle，无需任何冲突处理 |
| 独立性 | **独立可用**——即使没有 SyncManager，`flush()` 仍然可以被任何调用者使用（CLI、测试等） |

### Layer 2: Depot Commit Sync

| 属性 | 说明 |
|------|------|
| 职责 | `SyncManager`：`enqueue()` → `flush()` → `client.depots.commit()` |
| 幂等性 | **非幂等**。commit 改变 depot 指针，多次 commit 不同 root 会产生不同结果 |
| 冲突 | **有冲突风险**。冲突检测（`lastKnownServerRoot` vs 服务端实际 root）、LWW 覆盖 |
| 持久化 | 通过可插拔的 `SyncQueueStore` 接口持久化到 IndexedDB `depot-queue` store |
| 恢复 | `recover()` 需要冲突检测 + 可能的用户确认 |
| 依赖 | **依赖 Layer 1**——commit 前必须确保所有 CAS 节点已上传。但 Layer 1 不知道 Layer 2 的存在 |

## 设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| Commit 粒度 | 只提交最新 root | 多次快速操作合并为一次 commit，减少网络请求，history 更简洁 |
| 冲突策略 | LWW + 检测告警 | 检测到服务端 root 被其他客户端修改时，warn 用户但仍强制覆盖。未来再考虑 merge |
| Pending key 持久化 | 可插拔 `PendingKeyStore` 接口 | storage-cached 层不耦合具体存储实现，前端用 IndexedDB 实现 |
| Commit 队列持久化 | 可插拔 `SyncQueueStore` 接口 | SyncManager 不耦合 IndexedDB，前端提供具体实现 |
| Enqueue 合并策略 | 只更新 `targetRoot` | 合并时只更新 `targetRoot` 和 `updatedAt`，`lastKnownServerRoot` 保持首次入队时的值，因为中间 root 从未被 commit 到服务端 |
| 向后兼容 | 保留 `beforeCommit` | 新增 `scheduleCommit` 回调走异步路径，不提供 `scheduleCommit` 时行为不变 |

## 数据流

```
用户操作 (mkdir)
  │
  ├─→ localFs.mkdir(root, path) → newRoot
  │     └─ storage.put(k1, v1)  ← 写入 IndexedDB, 记录 pending key  [Layer 1]
  │     └─ storage.put(k2, v2)
  │
  ├─→ set({ depotRoot: newRoot })  ← UI 立即更新
  │
  └─→ syncManager.enqueue(depotId, newRoot, prevRoot)                 [Layer 2]
        │
        ├─→ IndexedDB: upsert { depotId, targetRoot: newRoot, ... }
        │
        └─→ (debounce 2s 后)
              │
              ├─→ storage.flush()                            [Layer 1]
              │     └─ 批量上传 k1, k2 到 HTTP 后端
              │     └─ pendingKeyStore.remove([k1, k2])
              │
              ├─→ client.depots.get(depotId) → serverRoot    [Layer 2]
              │     └─ 冲突检测: serverRoot !== prevRoot? → warn
              │
              ├─→ client.depots.commit(depotId, { root: newRoot })
              │
              └─→ IndexedDB: delete { depotId }
```

---

## 实现：Layer 1 — CAS Node Sync

Layer 1 的改动集中在 `storage-cached` 和 `storage-indexeddb` 两个 packages，纯数据层，与业务无关。

### Step 1.1: `storage-cached` — 可插拔 Pending Key 持久化

**文件**: `packages/storage-cached/src/cached-storage.ts`

在 `WriteBackConfig` 中新增可选配置：

```typescript
interface PendingKeyStore {
  /** 加载所有已持久化的 pending keys */
  load(): Promise<string[]>;
  /** 持久化新增的 pending keys */
  add(keys: string[]): Promise<void>;
  /** 移除已同步成功的 keys */
  remove(keys: string[]): Promise<void>;
}

interface WriteBackConfig {
  // ... 既有字段 ...
  /** 可选：持久化 pending keys，支持页面关闭后恢复 */
  pendingKeyStore?: PendingKeyStore;
}
```

**改动**：

1. **初始化**：`createCachedStorage()` 内部，如果提供了 `pendingKeyStore`，调用 `load()` 将已持久化的 keys 加入 `pendingKeys` Set，触发一次 sync cycle

2. **put()**：在 `pendingKeys.add(key)` 之后，调用 `pendingKeyStore.add([key])`。为了性能，批量收集同一 microtask 内的 keys 后一次性写入：
   ```typescript
   // Micro-batch: 收集同一 tick 内的 put keys
   let addBatch: string[] = [];
   let addScheduled = false;

   let persistPromise: Promise<void> = Promise.resolve();

   function persistPendingKey(key: string) {
     addBatch.push(key);
     if (!addScheduled) {
       addScheduled = true;
       queueMicrotask(() => {
         const batch = addBatch;
         addBatch = [];
         addScheduled = false;
         persistPromise = pendingKeyStore.add(batch).catch((err) => {
           console.error("[CachedStorage] Failed to persist pending keys:", err);
           // keys 仍在内存 pendingKeys 中，下次 flush 时可重试持久化
         });
       });
     }
   }
   ```

3. **runSync() 完成后**：对 `synced` + `skipped` 的 keys 调用 `pendingKeyStore.remove()`

4. **flush()**：在开始 flush 前先 `await persistPromise` 确保所有 microtask 批次的持久化已完成，再执行实际同步逻辑。最终 pendingKeys 为空时 pendingKeyStore 中也应已清空

### Step 1.2: `storage-indexeddb` — 实现 PendingKeyStore

**文件**: `packages/storage-indexeddb/src/indexeddb-storage.ts`

1. 升级 DB version（1 → 2），在 `onupgradeneeded` 中新增 object store `pending-sync`：
   ```typescript
   // version 2: add pending-sync store
   if (!db.objectStoreNames.contains("pending-sync")) {
     db.createObjectStore("pending-sync", { keyPath: "key" });
   }
   ```

2. 导出 `createPendingKeyStore()` 函数：
   ```typescript
   export function createPendingKeyStore(): PendingKeyStore {
     return {
       async load(): Promise<string[]> {
         const db = await openDB();
         const tx = db.transaction("pending-sync", "readonly");
         const store = tx.objectStore("pending-sync");
         const keys = await getAllKeys(store);
         return keys as string[];
       },
       async add(keys: string[]): Promise<void> {
         const db = await openDB();
         const tx = db.transaction("pending-sync", "readwrite");
         const store = tx.objectStore("pending-sync");
         for (const key of keys) {
           store.put({ key });
         }
         await txComplete(tx);
       },
       async remove(keys: string[]): Promise<void> {
         const db = await openDB();
         const tx = db.transaction("pending-sync", "readwrite");
         const store = tx.objectStore("pending-sync");
         for (const key of keys) {
           store.delete(key);
         }
         await txComplete(tx);
       },
     };
   }
   ```

### Step 1.3: `storage-indexeddb` — LRU 驱逐保护 Pending Keys

**文件**: `packages/storage-indexeddb/src/indexeddb-storage.ts`

LRU 驱逐时必须跳过仍在 `pending-sync` store 中的 key，否则未上传的 CAS 节点数据会丢失。

在 `CachedStorage` 层通过 `evictionFilter` 回调实现保护：

```typescript
interface IndexedDBStorageConfig {
  // ... 既有字段 ...
  /** 驱逐过滤器：返回 true 表示允许驱逐，返回 false 跳过 */
  evictionFilter?: (key: string) => boolean;
}
```

在 `createIndexedDBStorage()` 的 LRU 驱逐循环中，检查 `evictionFilter`：

```typescript
// 驱逐循环中
const cursor = await store.openCursor("lastAccessed");
while (cursor && evicted < evictionBatchSize) {
  const key = cursor.value.key;
  if (evictionFilter && !evictionFilter(key)) {
    cursor.continue();  // 跳过 pending key
    continue;
  }
  cursor.delete();
  evicted++;
  cursor.continue();
}
```

前端初始化时，将 `pendingKeys` Set 传入作为过滤依据：

```typescript
const indexedDBStorage = createIndexedDBStorage({
  evictionFilter: (key) => !pendingKeys.has(key),
});
```

> **注意**：`pendingKeys` 在 `CachedStorage` 内部维护，需要通过闭包或回调将其暴露给 IndexedDB 层。可在 `CachedStorage` 初始化时，将 `evictionFilter` 注入到 IndexedDB storage。

---

## 实现：Layer 2 — Depot Commit Sync

Layer 2 的改动涉及 SyncManager（`packages/explorer`）和前端集成层（`apps/server/frontend`）。

### Step 2.1: SyncManager 核心（packages 层）

**新建文件**: `packages/explorer/src/core/sync-manager.ts`

SyncManager 核心逻辑放在 `packages/` 层，持久化通过接口注入，确保可复用和可测试。

```typescript
/** 持久化 sync 队列的可插拔接口 */
interface SyncQueueStore {
  loadAll(): Promise<DepotSyncEntry[]>;
  upsert(entry: DepotSyncEntry): Promise<void>;
  remove(depotId: string): Promise<void>;
}
```

#### 数据结构

```typescript
interface DepotSyncEntry {
  depotId: string;       // primary key
  targetRoot: string;    // 要提交的最新 root（合并时只更新此字段）
  lastKnownServerRoot: string | null;  // 首次入队时的服务端 root（合并时不更新，用于冲突检测）
  createdAt: number;     // 首次入队时间
  updatedAt: number;     // 最后更新时间
  retryCount: number;    // 重试次数（最大 10 次，超过标记为 failed）
}
```

#### API

```typescript
interface SyncManagerConfig {
  /** Layer 1: CachedStorage，用于 flush() */
  storage: CachedStorageProvider;
  /** Depot 操作客户端 */
  client: CasfaClient;
  /** 持久化队列的存储实现 */
  queueStore: SyncQueueStore;
  /** Debounce 延迟（ms），默认 2000 */
  debounceMs?: number;
}

interface SyncManager {
  /**
   * 将新的 root 加入同步队列。
   * 如果该 depot 已有待同步条目，只更新 targetRoot 和 updatedAt（合并操作），
   * lastKnownServerRoot 保持首次入队时的值。
   */
  enqueue(depotId: string, newRoot: string, lastKnownServerRoot: string | null): void;

  /**
   * 页面加载时调用，从持久化存储恢复未完成的任务并启动同步。
   */
  recover(): Promise<void>;

  /**
   * 强制立即执行同步（flush + commit），用于登出前等场景。
   */
  flushNow(): Promise<void>;

  /**
   * 订阅同步状态变更。
   */
  onStateChange(listener: (state: SyncState) => void): () => void;

  /**
   * 订阅冲突检测事件。
   */
  onConflict(listener: (event: ConflictEvent) => void): () => void;

  /** 销毁 — 清理 timer */
  dispose(): void;
}

type SyncState = "idle" | "recovering" | "syncing" | "error" | "conflict";

interface ConflictEvent {
  depotId: string;
  localRoot: string;
  serverRoot: string;
  /** 冲突发生后的行为：当前为 LWW 强制覆盖 */
  resolution: "lww-overwrite";
}
```

#### Sync 循环

```typescript
const MAX_RETRY_COUNT = 10;

async function runSync() {
  const entries = await queueStore.loadAll();
  if (entries.length === 0) return;

  setState("syncing");

  // ── Layer 1: 确保所有 CAS 节点已上传 ──
  // flush() 是全局的、幂等的，不区分 depot。
  // 失败则中止整个 sync cycle——不能在节点缺失时 commit。
  try {
    await storage.flush();
  } catch (err) {
    console.error("[SyncManager] flush failed, aborting sync cycle:", err);
    setState("error");
    scheduleRetry(5_000);
    return;
  }

  // ── Layer 2: 逐 depot 执行冲突检测 + commit ──
  for (const entry of entries) {
    if (entry.retryCount >= MAX_RETRY_COUNT) {
      console.error(`[SyncManager] depot ${entry.depotId} exceeded max retries, giving up`);
      continue;
    }

    try {
      const depot = await client.depots.get(entry.depotId);
      const serverRoot = depot.root;

      if (serverRoot === entry.targetRoot) {
        await queueStore.remove(entry.depotId);
        continue;
      }

      if (
        entry.lastKnownServerRoot !== null &&
        serverRoot !== entry.lastKnownServerRoot
      ) {
        emitConflict({
          depotId: entry.depotId,
          localRoot: entry.targetRoot,
          serverRoot,
          resolution: "lww-overwrite",
        });
      }

      await client.depots.commit(entry.depotId, { root: entry.targetRoot });
      await queueStore.remove(entry.depotId);

    } catch (err) {
      await queueStore.upsert({
        ...entry,
        retryCount: entry.retryCount + 1,
        updatedAt: Date.now(),
      });
    }
  }

  const remaining = await queueStore.loadAll();
  setState(remaining.length > 0 ? "error" : "idle");

  // 如果有剩余，安排重试 (exponential backoff + jitter)
  if (remaining.length > 0) {
    const maxRetry = Math.max(...remaining.map(e => e.retryCount));
    const baseDelay = Math.min(1000 * 2 ** maxRetry, 60_000);
    const jitter = baseDelay * (0.5 + Math.random());
    scheduleRetry(jitter);
  }
}
```

#### 页面生命周期

```typescript
// 页面加载时
await syncManager.recover();  // 从持久化存储恢复 + 启动 sync

// 页面关闭前：不需要做任何操作。
// 所有必要数据在操作时即已持久化：
//   - CAS 节点字节 → IndexedDB blocks store        [Layer 1]
//   - Pending sync keys → IndexedDB pending-sync    [Layer 1]
//   - Depot commit 队列 → IndexedDB depot-queue     [Layer 2]
// 下次打开时 recover() 会自动恢复并继续同步。
```

### Step 2.2: 前端 SyncQueueStore 实现

**新建文件**: `apps/server/frontend/src/lib/sync-queue-store.ts`

基于 IndexedDB 实现 `SyncQueueStore` 接口。IndexedDB database `casfa-sync`，object store `depot-queue`：

```typescript
export function createIndexedDBSyncQueueStore(): SyncQueueStore {
  const dbPromise = openSyncDB();

  return {
    async loadAll() {
      const db = await dbPromise;
      const tx = db.transaction("depot-queue", "readonly");
      return getAllFromStore<DepotSyncEntry>(tx.objectStore("depot-queue"));
    },
    async upsert(entry) {
      const db = await dbPromise;
      const tx = db.transaction("depot-queue", "readwrite");
      tx.objectStore("depot-queue").put(entry);
      await txComplete(tx);
    },
    async remove(depotId) {
      const db = await dbPromise;
      const tx = db.transaction("depot-queue", "readwrite");
      tx.objectStore("depot-queue").delete(depotId);
      await txComplete(tx);
    },
  };
}
```

### Step 2.3: 修改 Explorer Store — 去掉阻塞等待

**文件**: `packages/explorer/src/core/explorer-store.ts`

#### 新增配置

```typescript
interface ExplorerStoreOptions {
  // ... 既有字段 ...
  /**
   * 异步 commit 回调。提供此回调时，写操作不再阻塞等待 flush + commit，
   * 而是立即更新本地 root 并通过此回调通知 SyncManager（fire-and-forget）。
   */
  scheduleCommit?: (depotId: string, newRoot: string, prevRoot: string | null) => void;
}
```

#### 修改写操作

以 `createFolder` 为例：

```typescript
// ── 之前 ──
const result = await localFs.mkdir(depotRoot, fullPath);
await beforeCommit?.();                                     // Layer 1 flush
await client.depots.commit(depotId, { root: result.newRoot }); // Layer 2 commit
set({ depotRoot: result.newRoot });

// ── 之后 ──
const result = await localFs.mkdir(depotRoot, fullPath);
const prevRoot = depotRoot;
set({ depotRoot: result.newRoot });  // UI 立即更新

if (scheduleCommit) {
  // 异步路径：入队 Layer 2，由 SyncManager 稍后统一 flush + commit
  scheduleCommit(depotId, result.newRoot, prevRoot);
} else {
  // 向后兼容：同步阻塞路径
  await beforeCommit?.();
  await client.depots.commit(depotId, { root: result.newRoot });
}
```

所有写操作统一改为此模式：`deleteItems`、`renameItem`、`pasteItems`、上传。

> **关于 delete 操作**：删除不产生新 CAS 节点（只修改目录树结构），但会产生新 root。
> 在异步模式下，如果删除操作的 commit 被 debounce 合并到后续操作中，被删除的文件在服务端
> 仍然存在直到 commit 成功。这是预期行为——CAS 合并语义保证最终提交的 root 反映所有操作的累积结果。

#### 修改上传

[packages/explorer/src/hooks/use-upload.ts](packages/explorer/src/hooks/use-upload.ts) 中的 per-file 处理：

```typescript
// ── 之前 ──
const result = await localFs.write(...);
await beforeCommit?.();
await client.depots.commit(depotId, { root: result.newRoot }).catch(() => {});
updateDepotRoot(result.newRoot);

// ── 之后 ──
const result = await localFs.write(...);
updateDepotRoot(result.newRoot);  // UI 立即更新
// 注意：不再逐文件 scheduleCommit，继续处理队列中的下一个文件
```

在所有文件处理完成后（队列清空时），统一调用一次 `scheduleCommit`：

```typescript
// 队列全部处理完毕后
if (scheduleCommit) {
  scheduleCommit(depotId, latestRoot, initialRoot);
} else {
  await beforeCommit?.();
  await client.depots.commit(depotId, { root: latestRoot }).catch(() => {});
}
```

这样避免上传 100 个文件产生 100 次 IndexedDB upsert。`initialRoot` 是开始上传前的 root，`latestRoot` 是所有文件写入后的最终 root。

### Step 2.4: 前端初始化串联

**文件**: `apps/server/frontend/src/pages/explorer-page.tsx`

```tsx
// 初始化 SyncManager（Layer 2），注入 Layer 1 的 storage
const syncManager = useMemo(() => createSyncManager({
  client,
  storage,                                    // Layer 1: CachedStorage
  queueStore: createIndexedDBSyncQueueStore(), // Layer 2: 持久化
}), [client, storage]);

// 页面加载时恢复
useEffect(() => {
  syncManager.recover();
  return () => syncManager.dispose();
}, [syncManager]);

// scheduleCommit 回调
const scheduleCommit = useCallback((depotId: string, newRoot: string, prevRoot: string | null) => {
  syncManager.enqueue(depotId, newRoot, prevRoot);
}, [syncManager]);

// 冲突提示
useEffect(() => {
  return syncManager.onConflict((event) => {
    toast.warn(`Depot ${event.depotId} 有冲突：服务端已被其他客户端修改，本地更改将覆盖。`);
  });
}, [syncManager]);

// 传递给 Explorer
<CasfaExplorer
  client={client}
  storage={storage}
  keyProvider={keyProv}
  depotId={depotId}
  scheduleCommit={scheduleCommit}  // 新增
  beforeCommit={undefined}          // 不再需要
/>
```

### Step 2.5: 登出流程

**文件**: `apps/server/frontend/src/lib/storage.ts`

登出时需要确保两层都完成：

```typescript
// ── 之前 ──
async function resetStorage() {
  await flushStorage();     // 直接 flush（只有 Layer 1）
  storage?.dispose();
}

// ── 之后 ──
async function resetStorage(syncManager?: SyncManager) {
  if (syncManager) {
    // syncManager.flushNow() 内部会先调用 Layer 1 flush()，再执行 Layer 2 commit
    await syncManager.flushNow();
  } else {
    // 没有 SyncManager 时（向后兼容），直接 flush Layer 1
    await flushStorage();
  }
  storage?.dispose();
}
```

> `storage.flush()`（Layer 1）本身是幂等的，可以被任何调用者安全调用。
> 但当 SyncManager 存在时，应通过 `flushNow()` 统一入口以确保 flush + commit 的原子性，
> 避免与 `runSync()` 内的 flush 产生并发。

### Step 2.6: Sync 状态 UI

修改 `SyncIndicator` 组件（已有），展示两层合并状态：

| 层次 | 数据源 | 状态 |
|------|--------|------|
| Layer 1: CAS sync | `onSyncStatusChange` + `SyncLogEntry`（已有） | CAS 节点上传进度 |
| Layer 2: Commit sync | `SyncManager.onStateChange`（新增） | `idle` / `recovering` / `syncing` / `error` / `conflict` |

**合并显示规则**：
- 两者都 idle → "Synced"
- 任一 syncing → "Syncing…"
- error / conflict → 优先显示

额外增加：
- 当前 pending depot commit 数量
- 冲突警告图标 + 提示
- 手动重试按钮（调用 `syncManager.flushNow()`）

---

## 边界情况

### 页面关闭时的数据安全

| 数据 | 层次 | 持久化位置 | 恢复方式 |
|------|------|-----------|---------|
| CAS 节点字节 | Layer 1 | IndexedDB `blocks` store | 始终在 put 时同步写入 |
| Pending sync keys | Layer 1 | IndexedDB `pending-sync` store | CachedStorage 初始化时 `load()` |
| Depot commit 队列 | Layer 2 | IndexedDB `depot-queue` store | SyncManager `recover()` |

页面关闭后再打开，两层数据都能独立恢复：
- Layer 1 通过 `PendingKeyStore.load()` 恢复 pending keys，触发 sync cycle——完全幂等，无需额外逻辑
- Layer 2 通过 `SyncQueueStore.loadAll()` 恢复 commit 队列——需要冲突检测（见下方）

### Recover 时的冲突处理

页面加载时 `syncManager.recover()` 恢复 pending commits。恢复过程中：

1. 设置状态为 `"recovering"`
2. 先调用 Layer 1 的 `flush()` 确保所有 CAS 节点已上传
3. 对每个恢复的 entry，先 `getDepot()` 获取服务端最新 root
4. 如果服务端 root 与 entry 的 `lastKnownServerRoot` 不同（说明其他端已修改），
   **触发 `onConflict` 事件并等待用户确认**，而不是静默 LWW 覆盖
5. 用户确认后才执行 commit

这与正常 sync 循环中的 LWW 策略不同——recover 场景下用户可能离开了很久，
服务端变更可能很大，静默覆盖风险更高。

### 多 Tab 场景

当前不处理多 tab 间的协调。每个 tab 有独立的 SyncManager 实例，但共享 IndexedDB。
可能的问题：两个 tab 同时 commit 同一 depot。由于是幂等的 LWW，不会造成数据损坏，
但可能有重复的 commit 请求。可以通过 [Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API)
在未来解决，当前 MVP 不处理。

### 网络恢复

SyncManager 使用 exponential backoff + jitter 重试（避免多 tab 惊群效应）。
可以额外监听 `navigator.onLine` 事件，网络恢复时立即触发一次 sync。

### IndexedDB 空间

CAS 节点的 LRU 驱逐策略（50K 条目上限）不变。`pending-sync` 和 `depot-queue` 条目
数量极小（通常 < 100 和 < 10），不影响空间。

LRU 驱逐通过 `evictionFilter` 回调保护 pending keys（见 Step 1.3），
`pendingKeys` 内存 Set 作为过滤依据，跳过仍需同步的 key。

## 未来演进

1. **Merge 策略**：替代 LWW，实现 three-way merge（基于 common ancestor）
2. **多 Tab 协调**：通过 Web Locks 或 BroadcastChannel 协调 sync
3. **Service Worker**：将 sync 逻辑移到 SW，页面关闭后仍可继续同步
4. **Conflict UI**：展示 diff，让用户选择保留哪个版本
5. **Offline-first**：完全离线操作，网络恢复后批量同步