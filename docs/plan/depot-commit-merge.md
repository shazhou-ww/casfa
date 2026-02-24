# Depot Commit 3-Way Merge — Implementation Plan

## 现状分析

### 当前 Commit 流程

```
Client                           Server
  │                                 │
  │  POST /commit { root }          │
  │ ──────────────────────────────► │
  │                                 │  1. get depot → current root
  │                                 │  2. verify root exists in storage
  │                                 │  3. verify ownership
  │                                 │  4. blind UpdateCommand (no CAS)
  │  ◄────────────────────────────  │     → { depotId, root, updatedAt }
  │  200 OK                         │
```

**问题：**
- 无乐观锁 — 两个并发 commit 读到相同 `current.root`，最后一个 write 静默覆盖
- 历史丢失 — 被覆盖的中间 root 从 history 中消失
- 冲突检测仅在客户端 SyncManager 中，且检测后依然 LWW 覆盖提交

---

## 目标设计

### 核心原则

1. **Server：乐观锁** — commit 必须携带 `expectedRoot`，服务端用 DynamoDB `ConditionExpression` 校验
2. **Client：自动 merge** — 收到 409 Conflict 时，用 `@casfa/dag-diff` 做 3-way merge 后重试
3. **不破坏向后兼容** — `expectedRoot` 为可选字段，缺省时回退到当前行为

---

## Phase 1: Protocol & Schema 变更

### 1.1 `DepotCommitSchema` 增加 `expectedRoot`

```typescript
// packages/protocol/src/depot.ts
export const DepotCommitSchema = z.object({
  root: z.string().regex(NODE_KEY_REGEX),
  /** 乐观锁：期望的当前 root。如果 server root ≠ expectedRoot → 409 */
  expectedRoot: z.string().regex(NODE_KEY_REGEX).nullable().optional(),
});
```

- `expectedRoot` 未提供或 `undefined` → 向后兼容，跳过 CAS 检查
- `expectedRoot: null` → 期望 depot 当前无 root（首次提交）
- `expectedRoot: "nod_xxx"` → 期望 depot 的 root 恰好是这个值

### 1.2 `CommitDepotResponse` 增加字段

```typescript
// packages/client/src/api/depots.ts
export type CommitDepotResponse = {
  depotId: string;
  root: string;
  updatedAt: number;
  /** 新增：前一个 root，便于客户端做 3-way merge 的 base */
  previousRoot: string | null;
};
```

### 1.3 409 Conflict 响应体

```typescript
// Server 返回 409 时的 body
{
  error: {
    code: "CONFLICT",
    message: "Depot root has changed since expectedRoot",
    currentRoot: "nod_xxx",    // 当前服务端的 root
    expectedRoot: "nod_yyy",   // 客户端期望的 root
  }
}
```

---

## Phase 2: Server 变更

### 2.1 `db/depots.ts` — `commit()` 增加 CAS 条件

```typescript
const commit = async (
  realm: string,
  depotId: string,
  newRoot: string,
  expectedRoot?: string | null,   // 新增参数
): Promise<ExtendedDepot | null> => {
  const now = Date.now();
  const current = await get(realm, depotId);
  if (!current) return null;

  // ── 乐观锁检查 ──
  if (expectedRoot !== undefined) {
    const currentRoot = current.root ?? null;
    if (currentRoot !== expectedRoot) {
      throw new ConflictError(currentRoot, expectedRoot);
    }
  }

  // ... build history, DynamoDB UpdateCommand (带 ConditionExpression) ...
};
```

DynamoDB 层面也加条件，防止 get→check→update 之间的竞态：

```typescript
await client.send(new UpdateCommand({
  TableName: tableName,
  Key: { realm, key: toLegacyDepotKey(depotId) },
  UpdateExpression: "SET #root = :root, history = :history, updatedAt = :now",
  ExpressionAttributeNames: { "#root": "root" },
  ExpressionAttributeValues: {
    ":root": newRoot,
    ":history": newHistory,
    ":now": now,
    ...(expectedRoot !== undefined
      ? { ":expectedRoot": expectedRoot ?? "__NULL__" }
      : {}),
  },
  // 当提供 expectedRoot 时，添加原子 CAS 条件
  ConditionExpression: expectedRoot !== undefined
    ? expectedRoot === null
      ? "(attribute_not_exists(#root) OR #root = :expectedRoot)"
      : "#root = :expectedRoot"
    : "attribute_exists(realm)",  // 原有行为：仅检查 depot 存在
  ReturnValues: "ALL_NEW",
}));
```

`ConditionalCheckFailedException` → 返回 409。

### 2.2 `controllers/depots.ts` — 处理 409

```typescript
commit: async (c) => {
  // ... parse body ...
  const { root: newRoot, expectedRoot } = body;

  try {
    const result = await depotsDb.commit(realm, depotId, newRoot, expectedRoot);
    return c.json({
      depotId,
      root: result.root,
      updatedAt: result.updatedAt,
      previousRoot: oldRoot,
    });
  } catch (err) {
    if (err instanceof ConflictError) {
      return c.json({
        error: {
          code: "CONFLICT",
          message: "Depot root has changed since expectedRoot",
          currentRoot: err.currentRoot,
          expectedRoot: err.expectedRoot,
        },
      }, 409);
    }
    throw err;
  }
};
```

### 2.3 `cached-depots.ts` — 无特殊变更

`commit()` 透传 `expectedRoot`，cache invalidation 逻辑不变。

### 2.4 MCP `depot_commit` 工具

增加可选 `expectedRoot` 参数，透传到 `depotsDb.commit()`。

---

## Phase 3: `@casfa/dag-diff` 增加 `applyMergeOps`

### 3.1 新函数：将 `MergeOp[]` 应用到 base tree

```typescript
// packages/dag-diff/src/apply.ts

export type ApplyMergeOptions = {
  storage: StorageProvider;
  keyProvider: KeyProvider;
};

/**
 * 将 dagMerge 产出的 MergeOp[] 应用到 baseRootKey 上，生成新的 merged root。
 *
 * - add:    在 path 处插入 nodeKey 指向的节点（mkdir -p 中间目录）
 * - remove: 删除 path 处的节点
 * - update: 替换 path 处的节点为 nodeKey
 *
 * 操作按顺序执行：先 remove，后 add/update（避免路径冲突）。
 */
export async function applyMergeOps(
  baseRootKey: string,
  operations: MergeOp[],
  options: ApplyMergeOptions,
): Promise<string>;   // 返回新的 root key
```

实现方式：

**方案 A - 映射到 `@casfa/fs` 的 `rewrite()`**：
- `add` / `update` → `{ link: nodeKey }` entry
- `remove` → deletes 列表
- 优势：复用现有逻辑（mkdir -p、Merkle rebuild）
- 劣势：依赖 `@casfa/fs`，增加 dag-diff 的依赖

**方案 B - 独立实现 tree 操作**：
- 直接用 `@casfa/core` 的 `encodeDictNode` + `decodeNode` + `hashToKey`
- 按 path 深度排序，逐层构建新树
- 优势：dag-diff 保持独立，不依赖 `@casfa/fs`
- 劣势：需要重新实现 path resolution 和 Merkle rebuild

**推荐方案 A**：dag-diff 增加 `@casfa/fs` 为依赖，`applyMergeOps` 内部调用 `rewrite()`。

> 另一方案：`applyMergeOps` 放在 `@casfa/fs` 而不是 `@casfa/dag-diff`，这样 dag-diff 保持纯 diff 职责，fs 负责 write。dag-diff 只负责计算 MergeOp，fs 负责应用。

---

## Phase 4: Client API 变更

### 4.1 `packages/client/src/api/depots.ts`

`commitDepot` 已经接受 `DepotCommit` body，schema 扩展后自动支持 `expectedRoot`。

增加 409 错误类型识别：

```typescript
export type CommitConflictError = {
  code: "CONFLICT";
  message: string;
  currentRoot: string;
  expectedRoot: string | null;
};

export function isConflictError(error: unknown): error is CommitConflictError {
  return typeof error === "object" && error !== null
    && (error as any).code === "CONFLICT";
}
```

### 4.2 `packages/client/src/client/depots.ts`

Stateful wrapper 的 `commit` 方法签名不变（`params: DepotCommit`），向后兼容。

---

## Phase 5: SyncManager 3-Way Merge

### 5.1 新增 merge-commit 循环

当前 SyncManager `runSync()` 中的冲突处理：

```typescript
// 旧: 检测到冲突 → emitConflict → 强制覆盖提交
if (serverRoot !== entry.lastKnownServerRoot) {
  emitConflict({ ..., resolution: "lww-overwrite" });
}
// 无条件 commit
```

新流程：

```typescript
// 新: commit with expectedRoot → 409 → 3-way merge → retry
const commitResult = await client.depots.commit(entry.depotId, {
  root: entry.targetRoot,
  expectedRoot: entry.lastKnownServerRoot,
});

if (!commitResult.ok && isConflictError(commitResult.error)) {
  // 服务端 root 变了，需要 merge
  const serverRoot = commitResult.error.currentRoot;
  const baseRoot = entry.lastKnownServerRoot;  // 共同祖先
  const oursRoot = entry.targetRoot;

  // 3-way merge
  const mergeResult = await dagMerge(baseRoot, oursRoot, serverRoot, {
    storage, oursTimestamp: entry.updatedAt, theirsTimestamp: Date.now(),
  });

  // Apply merge ops to server's current root
  const mergedRoot = await applyMergeOps(serverRoot, mergeResult.operations, { storage, keyProvider });

  // Flush merged nodes to server
  await storage.flush();

  // Retry commit with new expectedRoot = serverRoot
  const retryResult = await client.depots.commit(entry.depotId, {
    root: mergedRoot,
    expectedRoot: serverRoot,
  });

  // If 409 again → retry loop (max N attempts)
  // ...
}
```

### 5.2 Merge 重试策略

```
attempt 1: commit(targetRoot, expectedRoot=lastKnownServerRoot)
  → 409 (serverRoot=X)
  → merge(lastKnownServerRoot, targetRoot, X) → mergedRoot₁
  → flush()

attempt 2: commit(mergedRoot₁, expectedRoot=X)
  → 409 (serverRoot=Y, 又有人提交了)
  → merge(X, mergedRoot₁, Y) → mergedRoot₂
  → flush()

attempt 3: commit(mergedRoot₂, expectedRoot=Y)
  → 200 OK ✓

max merge attempts: 3 (然后 fallback to LWW 强制覆盖 or emit permanent conflict)
```

### 5.3 SyncManager Config 扩展

```typescript
export type SyncManagerConfig = {
  storage: FlushableStorage;
  client: CasfaClient;
  queueStore: SyncQueueStore;
  debounceMs?: number;
  /** 新增 */
  mergeStorage?: StorageProvider;     // 用于 merge 时读/写节点
  keyProvider?: KeyProvider;          // 用于 applyMergeOps 创建新节点
  maxMergeAttempts?: number;          // 默认 3
};
```

### 5.4 ConflictEvent 扩展

```typescript
export type ConflictEvent = {
  depotId: string;
  localRoot: string;
  serverRoot: string | null;
  resolution:
    | "lww-overwrite"           // 旧行为（fallback）
    | "3way-merge-success"      // merge 成功
    | "3way-merge-failed";      // merge 失败，需要用户干预
  /** merge 信息 (仅 3way-merge-success 时存在) */
  mergeInfo?: {
    baseRoot: string;
    mergedRoot: string;
    resolutions: LwwResolution[];
  };
};
```

### 5.5 Explorer Store 的感知

`updateServerRoot(newRoot)` 在 merge 成功后被调用，`depotRoot` 更新为 `mergedRoot`：

```typescript
// SyncManager commit 成功后
emitCommit({ depotId, committedRoot: mergedRoot });

// ExplorerStore 的 onSyncCommit handler
updateServerRoot(mergedRoot);
updateDepotRoot(mergedRoot);  // 本地也要切到 merge 后的 root
```

---

## Phase 6: `applyMergeOps` 实现细节

### 放置位置

推荐放在 `@casfa/fs`：

```typescript
// packages/fs/src/merge-apply.ts
import type { MergeOp } from "@casfa/dag-diff";

export async function applyMergeOps(
  rootNodeKey: string,
  operations: MergeOp[],
  ctx: FsContext,
): Promise<string> {
  const fs = createFsService({ ctx });

  // 分组
  const removes = operations.filter(op => op.type === "remove").map(op => op.path);
  const upserts: Record<string, FsRewriteEntry> = {};
  for (const op of operations) {
    if (op.type === "add" || op.type === "update") {
      upserts[op.path] = { link: op.nodeKey };
    }
  }

  // 调用 rewrite 一次完成
  const result = await fs.rewrite(rootNodeKey, upserts, removes);
  if ("code" in result) {
    throw new Error(`applyMergeOps failed: ${result.code} — ${result.message}`);
  }

  return result.newRoot;
}
```

这样 `@casfa/dag-diff` 保持纯 diff/merge 计算，`@casfa/fs` 负责 tree 写入。

---

## 变更清单

| 层 | 包/文件 | 变更 | 难度 |
|----|---------|------|------|
| Protocol | `packages/protocol/src/depot.ts` | `DepotCommitSchema` 增加 `expectedRoot` | S |
| Server DB | `apps/server/backend/src/db/depots.ts` | `commit()` 增加 CAS 条件 + `ConflictError` | M |
| Server DB | `apps/server/backend/src/db/cached-depots.ts` | 透传 `expectedRoot` | S |
| Server Controller | `apps/server/backend/src/controllers/depots.ts` | 处理 `ConflictError` → 409 | S |
| Server MCP | `apps/server/backend/src/mcp/handler.ts` | 透传 `expectedRoot` | S |
| Client API | `packages/client/src/api/depots.ts` | `CommitDepotResponse` + conflict 类型 | S |
| FS | `packages/fs/src/merge-apply.ts` | `applyMergeOps()` 映射到 `rewrite()` | M |
| Dag-diff | `packages/dag-diff/src/index.ts` | re-export `MergeOp` (已有) | - |
| SyncManager | `packages/explorer/src/core/sync-manager.ts` | merge-commit 循环 + retry | L |
| Explorer Store | `packages/explorer/src/core/explorer-store.ts` | 感知 mergedRoot 更新 | S |
| Tests | 全部上述 | 单元测试 + 集成测试 | M |

### 实施顺序

```
Phase 1: Protocol schema  ←  无依赖
Phase 2: Server 乐观锁    ←  依赖 Phase 1
Phase 3: applyMergeOps    ←  依赖 dag-diff (已完成)
Phase 4: Client API       ←  依赖 Phase 1
Phase 5: SyncManager      ←  依赖 Phase 2 + 3 + 4
Phase 6: Explorer UI      ←  依赖 Phase 5 (如需展示 merge 结果)
```

Phase 1-4 可以并行开发，Phase 5 需要前面全部完成。

---

## 回退策略

- `expectedRoot` 是可选字段 → 旧客户端不受影响
- 新客户端提交 `expectedRoot` 但 server 未升级 → server 忽略该字段，行为不变
- Merge 失败时 SyncManager fallback to LWW 覆盖（与当前行为一致）
- `maxMergeAttempts` 耗尽 → emit `"3way-merge-failed"` 事件，由 UI 层决定处理

---

## 未来扩展点

- **Server-side merge** — 当前 merge 在客户端做。未来可选 server 端 merge，减少 round-trip
- **Merge 策略插件** — 当前固定 LWW，未来可支持自定义冲突处理器
- **实时协作** — 基于 merge 机制实现 CRDT-like 实时同步
- **Merge history** — 在 depot history 中标记哪些 commit 是 merge 产生的
