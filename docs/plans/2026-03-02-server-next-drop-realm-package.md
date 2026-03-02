# server-next 移除 @casfa/realm 依赖，直接使用 CAS

**日期**：2026-03-02  
**状态**：设计  
**目标**：让 server-next 直接依赖 `@casfa/cas` 与 `@casfa/core`，不再依赖 `@casfa/realm`；Realm 当前根与 Branch 语义在 server-next 内用 CAS + 自管存储实现。

---

## 1. 背景与目标

- **结论**：realm package 与 [2026-03-01-requirements-use-cases.md](./2026-03-01-requirements-use-cases.md) 中的 Root Branch / Branch / Delegate 术语与语义已不对齐，且 server-next 实际只用到「当前根解析、Branch CRUD、GC、info」。
- **目标**：删除对 `@casfa/realm` 的依赖，在 server-next 内实现：
  - **Realm 当前根**：每个 realm 一个根 node key，按需创建空 dict 并持久化。
  - **Branch**：任务型分支，有 parent、mountPath、当前根、TTL；complete 时合并回 parent 并失效。
  - **GC / info**：基于 CAS 与 Branch 列表实现。

不改变现有 Dynamo 表结构（仍用当前「delegate」表存 root + branch），仅将类型与实现从 realm 包迁入 server-next，并统一术语（Branch / realm root）。

---

## 2. 数据与类型（server-next 内定义）

### 2.1 Branch（任务型分支）

与需求文档一致：有 TTL，complete 后合并回 parent 并失效。

```ts
// backend/db/branch-store.ts 或 backend/types/branch.ts

export type Branch = {
  branchId: string;
  realmId: string;
  parentId: string | null;   // null = 挂载在 realm 根下（即 parent 是 realm root）
  mountPath: string;
  expiresAt: number;         // 仅此一种：Branch 必有 TTL
};
```

- **Root Branch**：需求中「每个 Realm 唯一、持有当前根、不签发 token」的 Root Branch，在实现上对应「每个 realm 一条 root 记录」（见下），不再用「root delegate」这个类型名；逻辑上仍是一个「持有当前根」的占位。
- **Branch token**：继续用 `base64url(branchId)` 作为 token；校验时查 Branch 是否存在且未过期，不再依赖 realm 的 accessTokenHash。

### 2.2 Realm 当前根

- **存储**：每个 realm 一个「当前根」node key。
- **实现选择**：沿用现有 Dynamo 表，用「parentId === null 的一条 delegate 形记录」存 root（即现有 root delegate 行），不新增表或 GSI。该记录的 `getRoot(branchId)` 即 realm 当前根；`setRoot(branchId, nodeKey)` 即更新 realm 当前根。因此无需数据迁移。
- **API**：
  - `getRealmRoot(realmId): Promise<string | null>`：查 parentId=null 的那条记录的 ROOT sk，得到 nodeKey。
  - `setRealmRoot(realmId, nodeKey): Promise<void>`：通过 getRealmRootRecord 得到 root 的 branchId，再对该 id 写 ROOT sk（与 setBranchRoot 同形）。
  - 若 getRealmRoot 为 null，则创建空 dict 根（`encodeDictNode({ children: [], childNames: [] })`），put 到 CAS，再 `ensureRealmRoot(realmId, emptyRootKey)` 落库并返回 key。

### 2.3 BranchStore（替代 DelegateStore）

- **表结构不变**：仍为 `PK=DLG#branchId`，`SK=METADATA|ROOT`，GSI1 `gsi1pk=REALM#realmId`，`gsi1sk=PARENT#parentId`（root 为 `PARENT#ROOT`）。现有 item 字段（如 lifetime、accessTokenHash、expiresAt/accessExpiresAt）保留不动，以便与已有数据兼容；应用层只使用 `Branch` 类型（expiresAt 从 item 的 limited→expiresAt / unlimited→accessExpiresAt 映射）；写入新 Branch 时仍按原形状写入（例如 lifetime: "limited", expiresAt）。
- **类型**：存储层仍可保留「root 一条 + 多条 branch」的同一结构；对外只暴露 Branch 型（root 那条不当作 Branch 返回给「列出 Branch」）。
- **接口**（在 server-next 内定义，如 `backend/db/branch-store.ts`）：

```ts
export type BranchStore = {
  getBranch(branchId: string): Promise<Branch | null>;
  /** Realm 的「当前根」占位：parentId=null 的那条记录的 root key；无则 null */
  getRealmRoot(realmId: string): Promise<string | null>;
  /** 仅用于内部：取存 root 的那条记录的 id（用于 setRealmRoot 更新） */
  getRealmRootRecord(realmId: string): Promise<{ branchId: string } | null>;
  setRealmRoot(realmId: string, nodeKey: string): Promise<void>;
  ensureRealmRoot(realmId: string, emptyRootKey: string): Promise<void>;

  getBranchRoot(branchId: string): Promise<string | null>;
  setBranchRoot(branchId: string, nodeKey: string): Promise<void>;

  listBranches(realmId: string): Promise<Branch[]>;  // 仅 parentId !== null
  insertBranch(branch: Branch): Promise<void>;
  removeBranch(branchId: string): Promise<void>;

  purgeExpiredBranches(expiredBefore: number): Promise<number>;
};
```

- `ensureRealmRoot(realmId, emptyRootKey)`：若该 realm 尚无 root 记录，则插入一条 parentId=null、mountPath=""、root=emptyRootKey 的记录（并可选 expiresAt 设很大或 0，表示永不过期），保证后续 getRealmRoot 有值。

---

## 3. 服务层

### 3.1 RealmRootService（或合入 root-resolver）

- **职责**：解析「当前根」node key；必要时创建空根并调用 BranchStore.ensureRealmRoot。
- **依赖**：CasFacade, KeyProvider, BranchStore。
- **核心**：
  - `getCurrentRoot(auth): Promise<string | null>`  
    - User/Delegate：`getRealmRoot(realmId)`，若 null 则 `ensureEmptyRootInCas()` + `ensureRealmRoot(realmId, key)` 再返回 key。  
    - Worker：`getBranchRoot(auth.branchId)`。
  - 原 root-resolver 的 `getEffectiveDelegateId` 改为「用于 commit 的 id」：User/Delegate 用 realm root 那条记录的 branchId（内部用），Worker 用 branchId。commit 时 User/Delegate 调 `setRealmRoot(realmId, newKey)`，Worker 调 `setBranchRoot(branchId, newKey)` 或 complete 合并到 parent。

### 3.2 BranchService（已有 controller，补全/抽取逻辑）

- **职责**：创建 Branch、列出 Branch、撤销、Complete。
- **创建**：  
  - 从 realm 根创建：取 realm root key，resolvePath(rootKey, mountPath) 得到 childRootKey，insertBranch + setBranchRoot，返回 branchId（token = base64url(branchId)）。  
  - 从父 Branch 创建：getBranchRoot(parentBranchId)，resolvePath(parentRoot, mountPath)，同上。
- **Complete**：与现有一致：replaceSubtreeAtPath(cas, key, parentRootKey, segments, childRootKey)，然后 setRealmRoot 或 setBranchRoot(parentId, newParentRootKey)，removeBranch(branchId)。

### 3.3 RealmInfoService（替代 RealmFacade.info / gc）

- **info(realmId)**：`cas.info()` 取 nodeCount、totalBytes、lastGcTime；branchCount = `(await listBranches(realmId)).length`；delegateCount 来自 DelegateGrantStore（长期授权数）。
- **gc(realmId, cutOffTime)**：reachableKeys = [getRealmRoot(realmId), ...(await listBranches(realmId)).map(b => getBranchRoot(b.branchId))].filter(Boolean)，然后 `cas.gc(reachableKeys, cutOffTime)`。

---

## 4. 依赖与入口变更

- **移除**：`@casfa/realm` 从 `apps/server-next/package.json` 的 dependencies 中删除。
- **保留**：`@casfa/cas`、`@casfa/core`（以及现有 storage、jose、hono 等）。
- **AppDeps**：不再有 `realm: RealmFacade`、`delegateStore: DelegateStore`；改为 `branchStore: BranchStore`，以及可选 `realmRootService` / 将「当前根解析 + ensureEmptyRoot」合入 root-resolver 的 deps（cas, key, branchStore）。
- **入口**（index.ts / lambda.ts）：不再 `createRealmFacadeFromConfig`；改为 `createBranchStore`（Dynamo 实现，形状与现 dynamo-delegate-store 一致），并传入 root-resolver、branches、realm controller、auth middleware。

---

## 5. 文件级改动清单

| 文件 | 变更 |
|------|------|
| `package.json` | 删除 `@casfa/realm` 依赖 |
| `backend/db/dynamo-delegate-store.ts` | 重命名/重写为 `backend/db/dynamo-branch-store.ts`，实现 `BranchStore`，类型用本地 `Branch`，保留现有 PK/SK/GSI 与 item 形状；并修复现有重复 `listDelegates` 实现错误 |
| `backend/db/branch-store.ts` 或 `backend/types/branch.ts` | 定义 `Branch`、`BranchStore` 类型（及可选 `createMemoryBranchStore()` 用于单测） |
| `backend/services/realm.ts` | 删除；逻辑由 RealmInfoService（info/gc）与 root-resolver + BranchStore 替代 |
| `backend/services/root-resolver.ts` | 依赖 `BranchStore` 而非 RealmFacade/DelegateStore；`getCurrentRoot` 用 getRealmRoot/getBranchRoot，null 时调 ensureRealmRoot + 空根创建 |
| `backend/services/realm-info.ts`（新建） | 实现 info(realmId)、gc(realmId, cutOffTime)，用 cas + branchStore + delegateGrantStore |
| `backend/controllers/realm.ts` | 依赖 RealmInfoService（或直接 cas + branchStore + delegateGrantStore），不再 realm.info/realm.gc |
| `backend/controllers/branches.ts` | 使用 BranchStore 与本地 Branch 类型；创建子 branch 时用 resolvePath + insertBranch + setBranchRoot，不再 realm.getRootDelegate/createChildDelegate；complete 逻辑已存在，改为调 branchStore |
| `backend/middleware/auth.ts` | 依赖 `BranchStore`，用 getBranch(branchId)、expiresAt 校验 Worker token，不再 DelegateStore/Delegate |
| `backend/app.ts` | AppDeps 改为 branchStore（+ 可选 realmInfoService）；不再 realm、delegateStore |
| `backend/index.ts` | 创建 BranchStore（Dynamo），不再 createRealmFacadeFromConfig、delegateStore；传入 createApp |
| `backend/lambda.ts` | 同上 |
| `backend/mcp/handler.ts` | 创建 Branch 等逻辑用 BranchStore，类型用 Branch |
| `backend/__tests__/**` | 用 createMemoryBranchStore() 或等价 mock，去掉 @casfa/realm |
| `tests/setup.ts` | E2E 用 Dynamo BranchStore，不再 createRealmFacadeFromConfig、createDynamoDelegateStore（改为 createDynamoBranchStore） |
| `README.md` | 文档中「Branch 对应 @casfa/realm 的 Delegate」改为「Branch 由 server-next 的 BranchStore 管理」 |

---

## 6. 兼容性与迁移

- **Dynamo**：不改变表名、PK/SK/GSI、item 字段名；仅代码侧改类型与接口名，因此无需数据迁移。
- **Branch token**：仍为 base64url(branchId)，客户端无变化。
- **API 行为**：Realm info/usage/gc、Branch CRUD、文件读写、MCP 行为保持不变。

---

## 7. 后续可选

- 若希望「Root Branch 不占一条 delegate 形记录」，可再引入独立 `RealmRootStore`（例如 PK=REALM#realmId, SK=ROOT），并迁移现有 root 行到新键，再弃用 root delegate 行；本设计不强制这一步。
