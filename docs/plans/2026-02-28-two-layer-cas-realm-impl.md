# 两层 CAS/Realm 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 按 docs/plans/2026-02-28-two-layer-cas-realm-design.md 实现 Level 0 @casfa/cas 与 Level 1 @casfa/realm，删除现有 packages/realm，并更新根构建/测试顺序。

**Architecture:** 新包 packages/cas 依赖 @casfa/core，注入 Storage(get/put/del)，自维护 keysToRetain blob 与 key→时间/新增 key 索引，提供 getNode/putNode/hasNode/gc/info。新包 packages/realm 依赖 @casfa/cas、@casfa/dag-diff，注入 CAS 与 DepotStore，实现 Depot 的 create/commit/close 与 path 下 getNode/hasNode/putNode，parent commit 后通过 dag-diff 更新子 depot path。

**Tech Stack:** TypeScript, Bun, @casfa/core, @casfa/dag-diff, @casfa/cas-uri（若 path 解析需要）。

---

## Task 1: Storage 接口增加 del(key)

**设计约定:** Level 0 需要 storage 支持 del(key)。在 @casfa/storage-core 的 StorageProvider 中增加 `del(key: string): Promise<void>`，方法名用 `del` 避免与 JS 关键字冲突。

**Files:**
- Modify: `packages/storage-core/src/types.ts`
- Modify: `packages/storage-memory/src/memory-storage.ts`（实现 del）
- Test: `packages/storage-core` 或 `packages/storage-memory` 的现有/新增单测

**Step 1:** 在 `StorageProvider` 类型中增加 `del: (key: string) => Promise<void>`。

**Step 2:** 在 `packages/storage-memory` 的 memory storage 实现中增加 del（从内存 Map 删除 key）。

**Step 3:** 其它实现 StorageProvider 的包需补充 `del`，否则 typecheck 会失败：storage-http、storage-s3、storage-cached、storage-indexeddb、storage-fs；以及 core、dag-diff、fs 等包内测试用的 MemoryStorage mock。远程型 storage 可先实现为 no-op 或调用后端删除 API（若有）。

**Step 4:** 若有 storage-core 的单元测试，为 del 增加用例；否则在 storage-memory 的测试中覆盖 del。运行各包 typecheck 与测试确保通过。

**Step 5:** Commit: `git add packages/storage-core/src/types.ts packages/storage-memory/src/memory-storage.ts ... && git commit -m "feat(storage): add del(key) to StorageProvider" -m "Required for CAS GC; use 'del' to avoid JS keyword."`

---

## Task 2: @casfa/cas 包脚手架

**Files:**
- Create: `packages/cas/package.json`
- Create: `packages/cas/tsconfig.json`
- Create: `packages/cas/src/index.ts`
- Modify: `package.json` (root) — build:packages 与 test:unit 中在 core 之后加入 cas（realm 尚未删除时先加 cas，后续 task 再删 realm 并调整顺序）

**Step 1:** 创建 packages/cas/package.json，name 为 @casfa/cas，dependencies 含 @casfa/core、@casfa/storage-core（或仅 core，若 key 用 core 的）。参考 packages/delegate 或 packages/core 的 scripts。

**Step 2:** 创建 packages/cas/tsconfig.json，与其它包一致（module ESNext、moduleResolution bundler、outDir dist）。

**Step 3:** 创建 packages/cas/src/index.ts，导出空或占位 export。

**Step 4:** 在根 package.json 的 build:packages 中，在 `cd ../core && bun run build` 之后插入 `cd ../cas && bun run build`。在 test:unit 中同样在 core 之后插入 `cd ../cas && bun run test:unit`。

**Step 5:** 运行 `cd packages/cas && bun run build` 确保通过。Commit: `git add packages/cas package.json && git commit -m "chore(cas): add package scaffold"`

---

## Task 3: CAS 类型与 Storage 注入

**Files:**
- Create: `packages/cas/src/types.ts`
- Create: `packages/cas/src/cas-service.ts`（或 cas.ts）占位

**Step 1:** 在 types.ts 中定义 CasStorage：get/put/del。定义 CasContext：storage + KeyProvider（来自 core）。定义 CasInfo（lastGcTime?, nodeCount, totalBytes 等）。

**Step 2:** 在 cas-service 中导出 createCasService(ctx) 或类似工厂，返回对象占位（暂无方法实现）。index.ts 导出 types 与 createCasService。

**Step 3:** 运行 `cd packages/cas && bun run typecheck`。Commit: `git add packages/cas/src/types.ts packages/cas/src/cas-service.ts packages/cas/src/index.ts && git commit -m "feat(cas): add CasStorage type and CasService placeholder"`

---

## Task 4: CAS getNode / putNode / hasNode（put 校验子节点存在）

**Files:**
- Modify: `packages/cas/src/cas-service.ts`
- Create: `packages/cas/tests/cas-service.test.ts`

**Step 1:** 写单测：给定内存 storage + KeyProvider，getNode 不存在的 key 返回 null；putNode 合法 node 后 getNode 可读；hasNode 对存在/不存在返回 true/false；putNode 时若 data 引用子 key 且子 key 不存在则失败（期望错误码如 ChildMissing）。

**Step 2:** 运行测试，预期失败（未实现）。

**Step 3:** 实现 getNode：storage.get(key) 后 core 的 decodeNode。实现 hasNode：storage.get 非 null。实现 putNode：解析 data 得到所有子 key，逐个 hasNode，若有缺失则返回 ChildMissing；校验 nodeKey 与 data 的 content-address 一致（KeyProvider）；然后 storage.put(nodeKey, data)，并写入自维护的「key→时间」与「自上次 GC 以来新增 key」索引（索引可先放内存或约定 blob key，见下 task）。

**Step 4:** 运行测试，通过则 commit: `git add packages/cas/src/cas-service.ts packages/cas/tests/cas-service.test.ts && git commit -m "feat(cas): implement getNode, putNode, hasNode with child existence check"`

---

## Task 5: CAS 内部状态（keysToRetain blob + key→时间 + 新增 key）

**Files:**
- Create: `packages/cas/src/cas-meta.ts`（或内置于 cas-service）
- Modify: `packages/cas/src/cas-service.ts`

**Step 1:** 约定固定 blob key（如 `__cas_retained__`）存上次 GC 的 keysToRetain（序列化为 list 或 set 的持久化形式）。约定另一 key（如 `__cas_new_keys__`）或同一 namespace 下记录「自上次 GC 以来新增的 key」。key→时间 可存为另一 blob（如 key 为 `__cas_times__` 的 map 序列化）或按 key 前缀存每条 key→timestamp。设计为仅用 storage 的 get/put/del，不要求 listKeys。

**Step 2:** 实现读写这些元数据的辅助；putNode 成功时写入当前时间戳与「新增 key」记录；gc 完成后用 R 覆盖 keysToRetain，清空「新增 key」并更新 lastGcTime。

**Step 3:** 为 gc 与 info 写占位或最小实现（gc 遍历 roots、计算 R、根据 allKeys = 上次 keysToRetain ∪ 新增 key、toDelete = allKeys \ R 且时间 < cutOffTime、逐条 del）；info 返回 lastGcTime、nodeCount、totalBytes（nodeCount/totalBytes 可由 keysToRetain 与新增 key 集合遍历求和，或在上次 GC 时快照）。先通过单测再完善。

**Step 4:** 单测覆盖：put 若干 node，gc(roots, cutOffTime) 后不可达且早于 cutOffTime 的 key 被 del；info 含 lastGcTime 与合理 nodeCount。Commit: `git add packages/cas/src/... && git commit -m "feat(cas): internal keysToRetain, key->time, new keys; gc and info"`

---

## Task 6: CAS gc 与 info 完整实现与单测

**Files:**
- Modify: `packages/cas/src/cas-service.ts`
- Modify: `packages/cas/tests/cas-service.test.ts`

**Step 1:** gc(nodeKeys, cutOffTime)：从 nodeKeys 遍历 DAG 得到 R（用 core 的 getNode 从 storage 读）；allKeys = 上次 keysToRetain ∪ 自上次 GC 以来新增 key；toDelete = { k ∈ allKeys : k ∉ R 且 写入时间(k) < cutOffTime }；对 toDelete 逐条 storage.del(k)；用 R 更新 keysToRetain blob；清空或合并「新增 key」；更新 lastGcTime。info()：返回 lastGcTime、nodeCount（|keysToRetain| + 新增 key 数或重算）、totalBytes（遍历这些 key 的 size 求和或上次 GC 时快照）。

**Step 2:** 单测覆盖：多根、cutOffTime 过滤、info 在 gc 前后变化。Run tests, commit.

---

## Task 7: 删除现有 realm 包并更新根脚本

**Files:**
- Delete: `packages/realm` 下全部文件（或整目录）
- Modify: `package.json` (root) — build:packages 与 test:unit 中移除对 realm 的引用

**Step 1:** 从根 package.json 的 build:packages 和 test:unit 中删除 `cd ../realm && bun run build` 与 `cd ../realm && bun run test:unit`。

**Step 2:** 删除 packages/realm 目录下所有文件（或 `rm -rf packages/realm`）。若有其它包或 apps 依赖 @casfa/realm，先改为不依赖或后续 task 再让新 realm 提供兼容出口；本 task 仅删除旧包与根脚本引用。

**Step 3:** 运行 `bun run build:packages` 确保除 realm 外均通过（若有依赖 realm 的包会报错，需在后续 task 中新建 realm 后再恢复）。Commit: `git add package.json && git rm -r packages/realm && git commit -m "chore: remove legacy @casfa/realm package" -m "To be replaced by new realm per two-layer design."`

---

## Task 8: @casfa/realm 包脚手架（依赖 cas、dag-diff）

**Files:**
- Create: `packages/realm/package.json`
- Create: `packages/realm/tsconfig.json`
- Create: `packages/realm/src/index.ts`
- Modify: `package.json` (root) — 在 build:packages 与 test:unit 中在 cas 之后加入 realm

**Step 1:** packages/realm/package.json：name @casfa/realm，dependencies 含 @casfa/cas、@casfa/dag-diff、@casfa/core（或 @casfa/cas-uri 若 path 用其解析）。

**Step 2:** 创建 tsconfig 与 src/index.ts（export 占位）。根 package.json 中在 `cd ../cas` 之后加入 `cd ../realm && bun run build` 与 test:unit。

**Step 3:** `cd packages/realm && bun run build`。Commit: `git add packages/realm package.json && git commit -m "chore(realm): add package scaffold, deps cas and dag-diff"`

---

## Task 9: Realm DepotStore 类型与 RealmService 占位

**Files:**
- Create: `packages/realm/src/types.ts`
- Create: `packages/realm/src/realm-service.ts`
- Create: `packages/realm/src/errors.ts`

**Step 1:** types.ts：Depot { depotId, realmId, parentId | null, mountPath }；DepotStore：getDepot(depotId), getRoot(depotId), setRoot(depotId, nodeKey), listDepots(realmId), 以及创建/关闭 depot 的写入接口（如 insertDepot, removeDepot 或 setClosed）。

**Step 2:** errors.ts：RealmError 含 code: NotFound | InvalidPath | CommitConflict；isRealmError(x)。

**Step 3:** realm-service.ts：RealmService 构造注入 CAS 与 DepotStore；占位方法 createDepot, commitDepot, closeDepot, getNode, hasNode, putNode, gc, info。index 导出类型与 RealmService。

**Step 4:** 单测占位：实例化 RealmService 与内存 CAS、内存 DepotStore，不断言行为。Commit: `git add packages/realm/src/types.ts packages/realm/src/errors.ts packages/realm/src/realm-service.ts packages/realm/src/index.ts ... && git commit -m "feat(realm): DepotStore types and RealmService placeholder"`

---

## Task 10: getNode(depot, path)、hasNode(depot, path)、putNode

**Files:**
- Modify: `packages/realm/src/realm-service.ts`
- Create: `packages/realm/tests/realm-service.test.ts`

**Step 1:** 单测：创建 main depot（root 指向一 d-node），getNode(main, "a") 解析 path 得到子节点；hasNode(main, "b") 为 false；putNode 委托 CAS.putNode。

**Step 2:** 实现 getNode：getRoot(depotId)，用 CAS.getNode 取根，再按 path（name/index）逐段解析（参考 core 或 cas-uri 的 path 解析）。hasNode：解析到存在则为 true。putNode(nodeKey, data)：CAS.putNode(nodeKey, data)。

**Step 3:** 运行测试，通过则 commit。

---

## Task 11: createDepot、commitDepot（乐观锁）

**Files:**
- Modify: `packages/realm/src/realm-service.ts`
- Modify: `packages/realm/tests/realm-service.test.ts`

**Step 1:** 单测：createDepot(parent, path) 从 parent 当前根解析 path，新 depot 的 getRoot 返回该节点 key；commitDepot(depot, newRoot, oldRoot) 当当前根 === oldRoot 时 setRoot(newRoot)，否则返回 CommitConflict。

**Step 2:** 实现 createDepot：getRoot(parent.depotId)，CAS.getNode 解析 path 得到子 node key，insertDepot 新 depot（parentId=parent，mountPath=path，currentRoot=该 key）。实现 commitDepot：getRoot(depotId)，若 !== oldRootKey 则 throw CommitConflict；setRoot(depotId, newRootKey)。（parent commit 后更新子 depot path 放在下一 task。）

**Step 3:** 运行测试，commit。

---

## Task 12: closeDepot（写回 parent）

**Files:**
- Modify: `packages/realm/src/realm-service.ts`
- Modify: `packages/realm/tests/realm-service.test.ts`

**Step 1:** 单测：创建 parent 与 child depot，child 修改后 closeDepot(child)；parent 的 root 在挂载 path 处变为 child 的 current root（即一次 parent 的 commit）。

**Step 2:** 实现 closeDepot：getDepot(depotId)，取 parentId 与 mountPath；getRoot(depotId) 为 childRoot；getRoot(parentId) 为 parentRoot；用 core 的 makeDict/getNode 在 parentRoot 下将 mountPath 替换为 childRoot，得到 newParentRoot；commitDepot(parent, newParentRoot, parentRoot)；然后从开放 depot 列表移除或标记该 depot 已关闭（调用 DepotStore 的 removeDepot 或 setClosed）。

**Step 3:** 运行测试，commit。

---

## Task 13: parent commit 后通过 dag-diff 更新子 depot path

**Files:**
- Modify: `packages/realm/src/realm-service.ts`
- Modify: `packages/realm/tests/realm-service.test.ts`

**Step 1:** 单测：parent 下挂 child 于 path "foo"；parent 执行一次 commit，使原 "foo" 处的节点被 move 到 "bar"；断言 child 的 mountPath 更新为 "bar"（或等效路径表示）。

**Step 2:** 在 commitDepot 成功更新 parent root 后，若 depot 为某子 depot 的 parent，则 listDepots 取该 parent 下所有子 depot；对每个子 depot 的 mountPath，用 dag-diff 比较 parent 的 oldRoot 与 newRoot，若该 path 上的节点在新树中被 move，则更新该子 depot 的 path（调用 DepotStore 的 updateDepotPath 或等价接口）。

**Step 3:** 运行测试，commit。

---

## Task 14: gc(cutOffTime)、info()

**Files:**
- Modify: `packages/realm/src/realm-service.ts`
- Modify: `packages/realm/tests/realm-service.test.ts`

**Step 1:** 单测：多个 depot 各有 root；gc(cutOffTime) 调用 CAS.gc(roots, cutOffTime)，其中 roots = 所有 depot 的 getRoot；info() 聚合 CAS.info() 与 depot 数量等。

**Step 2:** 实现 gc：listDepots(realmId) 或等效取所有 depot，收集 getRoot(depotId)，去重后调用 CAS.gc(roots, cutOffTime)。实现 info：CAS.info() 并可选加上 realm/depot 统计。

**Step 3:** 运行测试，commit。

---

## 执行方式

计划已保存到 `docs/plans/2026-02-28-two-layer-cas-realm-impl.md`。

**两种执行方式：**

1. **本会话内子 agent 驱动** — 按 task 派发子 agent，每 task 后你做 code review，迭代快。
2. **独立会话并行执行** — 在新会话（建议在独立 worktree）中用 executing-plans 按 task 批量执行，在检查点做 review。

你选哪种？若选 1，我会使用 subagent-driven-development skill 在本会话内逐 task 执行；若选 2，我会说明如何在新会话中打开 worktree 并用 executing-plans 执行。
