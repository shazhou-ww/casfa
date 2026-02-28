# 两层业务内核设计：CAS（Level 0）与 Realm（Level 1）

**日期**：2026-02-28  
**状态**：已批准

## 目标

将业务内核分为**两层**，每层一个包、单一职责：

- **Level 0 (CAS)**：CAS 数据结构的增删查（删除通过 GC）、完整性保证与 GC，不承载业务概念。
- **Level 1 (Realm)**：基于 CAS 的 Realm，多个 Depot 通过 current root 迭代；Realm 状态 = 所有 depot 当前根的 vector。

现有 `@casfa/realm` 包删除，由本设计下的新包替代。分层为**逻辑分层**，每层可有自己的 storage 抽象。

---

## 1. Level 0：CAS 层（@casfa/cas）

### 1.1 职责

- CAS 数据结构的**增、查**（put 时校验所有子节点已存在）；**不提供显式删除**，删除通过 **GC** 实现。
- 保证**完整性**：put 前检查 data 中引用到的子 key 均已在 storage 中存在。
- **GC**：调用方传入一组根 key 与截止时间 cutOffTime；从根遍历得到可达集 R，删除「不在 R 内且写入时间 < cutOffTime」的 key；写入时间 ≥ cutOffTime 的节点一律保留。
- **info()**：返回聚合信息（上次 GC 时间、当前 node 数、总字节数等），由本层自维护元数据计算。

### 1.2 Storage 抽象（注入）

- `get(key): Promise<Uint8Array | null>`
- `put(key, value: Uint8Array): Promise<void>`
- `del(key): Promise<void>`

### 1.3 API

- `getNode(nodeKey): Promise<CasNode | null>`
- `putNode(nodeKey, data): Promise<void>`（内部校验子节点存在；nodeKey 与 data 的 content-address 一致）
- `hasNode(nodeKey): Promise<boolean>`
- `gc(nodeKeys: string[], cutOffTime: number): Promise<void>`
- `info(): Promise<CasInfo>`

### 1.4 内部机制

- 使用**固定 key 的 blob** 持久化「上一次 GC 的 keysToRetain」。
- 自维护索引（同一 storage 的约定 namespace 或注入的 meta store）：  
  - 每次 put 记录 key → 写入时间；  
  - 自上次 GC 以来新增的 key 集合（或等价信息）。
- GC 时：从 nodeKeys 遍历得 R；allKeys = 上次 keysToRetain ∪ 自上次 GC 以来新增 key；toDelete = allKeys \ R 且写入时间 < cutOffTime；对 toDelete 逐条 `del(key)`；用 R 更新 keysToRetain 并清空/合并「新增 key」；更新 lastGcTime 等 info 用到的元数据。

### 1.5 依赖

- `@casfa/core`（编解码、KeyProvider）、注入的 Storage（get/put/del）。不依赖 Realm、dag-diff、protocol、server。

---

## 2. Level 1：Realm 层（@casfa/realm）

### 2.1 职责

- 基于 Level 0 CAS 封装 **Realm**；Realm 下有多个 **Depot**，通过各 Depot 的 **current root** 迭代更新状态。
- 不实现存储：CAS 与 Depot 元数据/根均通过**注入**获得。

### 2.2 概念

- **Realm**：逻辑容器。**当前状态 = 所有 depot 的 current root 组成的 vector**（每个 depot 一条）。无独立「realm 根」。
- **Depot**：单节点指针（无 history）。含 depotId、parent（null 表示 main）、挂载 path、currentRootKey。Main depot 在 realm 初始化时存在，挂载 path 为空。
- **父子**：子 depot 创建时指定 parent 与挂载 path；从 parent 当前根解析 path，取该节点作为子 depot 的**初始 root**；之后 parent 的 commit 不改变子 depot 的 root，直到子 **close** 时写回 parent。
- **Parent commit 影响挂载路径**：若 parent 的 commit 导致某子 depot 的挂载 path 被 **move**，只**更新该子 depot 的 path**，子 depot 的 root 不变。通过 **@casfa/dag-diff** 对 parent 的 oldRoot 与 newRoot 做 diff 发现 move 并更新子 depot path。

### 2.3 注入

- **CAS**：Level 0 的接口（getNode、putNode、hasNode、gc、info）。
- **DepotStore**（调用方实现）：  
  - `getDepot(depotId)`、`getRoot(depotId)`、`setRoot(depotId, nodeKey)`、`listDepots(realmId)` 等；  
  - 创建/关闭 depot 的元数据写入。  
  Depot 类型至少含：depotId、realmId、parentId（null = main）、mountPath。

### 2.4 API

- **Node 访问**：`getNode(depot, path)`、`hasNode(depot, path)`、`putNode(nodeKey, data)`（委托 CAS）。
- **Depot 操作**：  
  - `createDepot(parent, path)`：从 parent 当前根解析 path，新 depot 的初始 root = 该节点。  
  - `commitDepot(depot, newRootKey, oldRootKey)`：乐观锁，当前根 === oldRootKey 才设为 newRootKey；若 depot 为 parent，commit 后对挂载在其上的子 depot 用 dag-diff 检测 path 是否被 move，若有则更新子 depot 的 path。  
  - `closeDepot(depot)`：将 depot 的 current root 写回 parent（在 parent 当前根下替换挂载 path 为该 root，得到新 parent 根并 commitDepot(parent, newParentRoot, parentCurrentRoot)）；然后从开放 depot 列表移除或标记已关闭。
- **全局**：`gc(cutOffTime)`（所有 depot 的 current root 作为 roots 调用 CAS.gc）、`info()`。

### 2.5 Path

- 支持 **name** 与 **index**；createDepot 的 path 仅 **name**（挂载到 d-node 或 f-node）。

### 2.6 依赖

- `@casfa/cas`、**@casfa/dag-diff**（parent commit 后根据 diff 更新子 depot path）、`@casfa/core` / `@casfa/cas-uri`（若 path 解析用 cas-uri）；注入 CAS 与 DepotStore。不依赖 protocol、server。

---

## 3. 错误约定

- **Level 0**：如 `ChildMissing`、`KeyMismatch` 等；typed error / Result。
- **Level 1**：`NotFound`、`InvalidPath`、`CommitConflict`；可复用或扩展 Level 0 错误。统一带 code 的 typed error，不抛未分类异常。

---

## 4. 测试策略

- **Level 0**：内存 Storage（get/put/del）；单测覆盖 getNode/putNode/hasNode（含子节点校验）、gc（roots + cutOffTime）、info；验证 keysToRetain 与时间过滤。
- **Level 1**：内存 CAS + 内存 DepotStore；单测覆盖 createDepot、commitDepot（含乐观锁）、closeDepot、getNode/hasNode/putNode、gc；**parent commit 后子 depot path 随 diff 更新**的用例用 dag-diff 或 mock 验证。
- 可选：集成测试用真实 @casfa/cas + 内存 storage 串起两层。

---

## 5. 后续

- 由 writing-plans 产出实现计划与任务拆分。
- 现有 `packages/realm` 删除，新实现按本设计在新包中完成。
