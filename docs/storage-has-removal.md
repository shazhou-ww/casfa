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
4. **`put()` 内部调用 `has()` 做去重是不必要的** — CAS 写入天然幂等（同 key 同内容），重复写入无害

## 目标接口

```typescript
type StorageProvider = {
  get: (key: string) => Promise<Uint8Array | null>;
  put: (key: string, value: Uint8Array) => Promise<void>;
};
```

两个方法，零歧义。Storage 回归最简单的存储职责。

## 当前 `has()` 调用分析

### Storage 内部使用（6 处）

| 位置 | 用途 | 移除后处理 |
|---|---|---|
| `storage-fs/put()` | 写入前检查 key 是否存在，跳过重复写 | 删除。CAS 幂等，重复写无害 |
| `storage-s3/put()` | 同上（HeadObject 检查） | 删除。S3 PutObject 也是幂等的 |
| `storage-cached/has()` | `cache.has → remote.has` 分层检查 | 改为 `cache.get` 返回 null = 不在本地 |
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

1. **Storage 实现大幅简化**
   - `storage-fs`：删除 LRU 缓存 + `has` 实现 + `put` 内 has 检查（~40 行）
   - `storage-s3`：同上（~40 行）
   - `storage-utils.ts`（两份副本）：**整个删除**（~56 行 × 2）
   - `storage-memory`：删除 `has` 实现（~2 行）
   - `storage-indexeddb`：删除 `has` 方法（~10 行）
   - `storage-http`：删除 `has` 方法（~15 行）

2. **消除 P0 #2 重复** — `storage-utils.ts` 不再需要，连同 `quick-lru` 依赖一起删除

3. **职责清晰** — "存不存在"是业务/索引层的问题，存储层只管读写字节

4. **`storage-cached` 简化** — 不需要 `has` 分支，`sync` 逻辑更清晰

## 风险

1. **`put()` 性能退化** — 去掉存在性检查后，重复 key 写入会执行实际 IO（文件写入或 S3 PutObject）。需评估典型场景中重复 put 的比例
2. **S3 成本** — 如果大量 PutObject 是重复的，成本比 HeadObject 高。但如果上层 DB 已做过 check 则不会到 storage 层
3. **向后兼容** — 所有 StorageProvider 实现和消费方都需要同步修改
4. **第三方消费方** — 如果外部代码依赖 `has` 方法，需要迁移指南

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

- [ ] `put()` 去掉存在性检查后，实际场景中重复 put 的比例有多高？需要 benchmark
- [ ] `storage-cached` 的 `sync` 路径不用 `has` 后，是否可以完全依赖 `checkMany`？
- [ ] `controller.ts` 公开的 `has` API 是否有外部消费方？
- [ ] 是否需要分 major 版本？还是当前都是内部使用可以直接改？
