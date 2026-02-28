# Realm 核心层设计（@casfa/realm）

**日期**：2026-02-28  
**状态**：已批准

## 目标

在 @casfa/core（CAS 编解码与 node 结构）之上新增一层业务模型包 **@casfa/realm**，提供：单 realm 单根文件树、delegate 树（绑定路径、创建子 delegate）、按 delegate 的读/写/commit（局部根乐观锁 + 合并）、以及基于「保留集合」的 BlobStore sweep 与 realm GC 接口。本包不实现具体存储，通过策略接口注入 BlobStore 与 DelegateDb。

---

## 1. 架构与边界

- **包**：新建 `packages/realm`，对外 `@casfa/realm`。
- **依赖**：仅依赖 `@casfa/core`（CAS 编解码、KeyProvider、getNode/makeDict 等）、`@casfa/cas-uri`（PathSegment、路径解析）。不依赖任何存储实现、@casfa/protocol 或 server。
- **注入**：调用方注入两类策略：
  - **BlobStore**：按 key 存取 node 二进制；支持 **sweep(keysToRetain)** 做事务性清理（见后）。
  - **DelegateDb**：存取「某 realm 的当前根 node key」以及 Delegate 的 CRUD。
- **职责**：本包只实现单 realm 单根文件树 + delegate 树 + 按路径的局部 commit（含局部根乐观锁与合并）与 GC 接口。不实现 BlobStore/DelegateDb 的后端，也不管认证、token、多租户隔离。

---

## 2. 核心概念与不变性

### 2.1 顶层是 Realm（无 user 概念）

- 顶层实体是 **realm**；本层不出现 user/userId。一个 realm 对应一棵文件树和一棵 delegate 树。

### 2.2 单根文件树

- 每个 realm 对应一棵逻辑文件树，由「当前根 node」唯一决定（一个 node key）。
- 任何修改都是把该 realm 的当前根原子地换成新根；历史通过 DAG 保留，本层只维护「当前根」。

### 2.3 Delegate 树

- 使用者是一棵 **delegate 树**：根为 realm 的 **root delegate**，下可挂 Agent、sub-agents、tools。
- 所有权归 realm；本层不区分「某 delegate 拥有哪些 node」，只区分「绑定路径 + 操作能力」。

### 2.4 Delegate 绑定路径

- 每个 delegate 绑定在一个**路径**上，**绑定后不可改**；要改则删除再建。
- 绑定路径必须是**命名路径**（name segments），解析结果必须是 **d-node 或 f-node**，不能是 s-node。
- Root delegate 绑定在**根路径**（空）。子 delegate 由父创建时给出**相对于父绑定路径的相对路径**，且仅支持**命名路径**（不支持 index），故子绑定目标也是 d-node 或 f-node。
- 每个 delegate **不感知更上层目录**：其「根」即绑定路径指向的 node；读/写/commit 的路径均**相对于该绑定路径**。

### 2.5 路径规则小结

| 场景               | 路径类型       | 说明 |
|--------------------|----------------|------|
| 绑定路径           | 仅命名         | 目标必须是 d-node 或 f-node |
| 创建子 delegate    | 相对、仅命名   | 相对父绑定路径，不支持 index |
| 读                 | 相对           | 支持 index path（如文件内某块） |
| Commit             | 无路径参数     | 固定为该 delegate 的绑定路径（见下） |

### 2.6 Commit 与乐观锁

- **commit(delegateId, baseLocalRoot, newLocalRoot)**：无 relativePath；每次 commit 即「该 delegate 的根」。
- 语义：在当前 realm 根下，把**该 delegate 绑定路径**指向的子树，从 `baseLocalRoot` 替换为 `newLocalRoot`，得到新 realm 根并写回。
- 乐观锁：当前该绑定路径上的 node key 必须等于 `baseLocalRoot` 才执行替换；否则返回 `CommitConflict`。
- 替换由本层用 core 的 makeDict/getNode 等做「单路径替换」，生成新根并原子写入 DelegateDb。

---

## 3. 数据模型与存储接口

### 3.1 ID 格式

- 所有本层定义的 ID 符合 **`${pfx}_${crockford32(128bit)}`**（与现有 nod_、dpt_ 一致）。
- **delegateId**：前缀 `dlg_`。
- **realmId**：若本层生成则前缀 `rlm_`；若调用方传入则为任意唯一 string。

### 3.2 BlobStore

- **get(key: string): Promise<Uint8Array | null>**
- **put(key: string, value: Uint8Array): Promise<void>**
- **sweep(keysToRetain: Set<string>): Promise<void>**  
  - 保留且仅保留 `keysToRetain` 中的 key；其余由 BlobStore 内部清除，**保证事务性**（全部成功或全部回滚）。不做单条 delete，不暴露 listKeys。

### 3.3 DelegateDb

- **当前根**：`getRoot(realmId): Promise<string | null>`；`setRoot(realmId, nodeKey): Promise<void>`。可选：`compareAndSetRoot(realmId, expected, newKey): Promise<boolean>` 以强化原子性。
- **Delegate**：`getDelegate(delegateId): Promise<Delegate | null>`；`insertDelegate(delegate): Promise<void>`。
- **Delegate 类型**（本包定义）：至少含 `delegateId`、`realmId`、`parentId`（null 表示 root）、`boundPath`（name-only PathSegment[] 或序列化形式）；可选 `name`、`createdAt` 等。

### 3.4 路径表示

- 绑定路径：name-only PathSegment[]（或与 cas-uri 一致）。创建子 delegate 时只接受 name segment。读/commit 时的相对路径允许含 index segment。

---

## 4. API 行为与入参

- **RealmService**（或等价入口）：构造时注入 BlobStore、DelegateDb、KeyProvider；方法接收 `delegateId` 等。

### 4.1 创建 Delegate

- **createRootDelegate(realmId, options?)**：在 realm 下创建 root delegate；boundPath 为空。返回新 delegate（含 delegateId）。
- **createChildDelegate(parentDelegateId, relativePath, options?)**：relativePath 仅命名路径；解析父绑定路径 + relativePath，目标须为 d-node 或 f-node。新 delegate 的 boundPath = 父路径拼接 relativePath，realmId/parentId 继承父。

### 4.2 读

- **read(delegateId, relativePath)**：支持 name + index。以该 delegate 绑定路径为逻辑根解析，返回内容或 node 信息。路径不存在或非法类型时返回明确错误。

### 4.3 写（Put）

- **put(delegateId, relativePath, payload)**：在绑定路径下的 relativePath 写入新 node 到 BlobStore；不直接改当前根；需通过 **commit** 将某路径指向新 node 才会改变树。

### 4.4 Commit

- **commit(delegateId, baseLocalRoot, newLocalRoot)**：将该 delegate 绑定路径下的子树从 baseLocalRoot 替换为 newLocalRoot；乐观锁校验；成功后写回新 realm 根。

### 4.5 GC

- **listReachableKeys(realmId): Promise<Set<string>>**：从该 realm 当前根出发遍历 DAG，返回可达 node key 集合（只读）。
- **gcSweep(realmId)**：调用 `listReachableKeys(realmId)` 得到 R，再调用 `BlobStore.sweep(R)`。多 realm 共用同一 BlobStore 时，调用方需合并多 realm 的可达集再 sweep，或保证一 store 一 realm。

---

## 5. 错误类型

- **NotFound**：delegate 不存在、realm 无根、或路径解析某段不存在。
- **InvalidPath**：绑定/创建子 delegate 时路径解析到 s-node 或非法格式（如用了 index）。
- **CommitConflict**：commit 时当前绑定路径上的 node key ≠ baseLocalRoot。
- **NoRoot**：需要当前根但该 realm 尚无根。

使用 Result 类型或带 code 的 typed error，不抛未分类异常。

---

## 6. 测试策略

- **单元测试**：内存 BlobStore + 内存 DelegateDb；覆盖 createRootDelegate、createChildDelegate、read（含 index）、put、commit（成功与冲突）、listReachableKeys、gcSweep。
- **集成**：可选；接 core + storage-memory 验证与编解码、路径解析一致。

---

## 7. 后续

- 由 writing-plans 产出实现计划与任务拆分。
