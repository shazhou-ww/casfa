# server-next 移除 @casfa/realm 依赖 — 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 移除 server-next 对 `@casfa/realm` 的依赖，用 CAS + 自管 BranchStore/Realm 根解析实现相同行为。

**Architecture:** 在 server-next 内定义 Branch 类型与 BranchStore 接口；Dynamo 表结构不变，将现有 dynamo-delegate-store 重写为 dynamo-branch-store 并实现 BranchStore；root-resolver 与 controllers 改为依赖 BranchStore 与 CAS；删除 realm 包引用与 realm.ts 服务。

**Tech Stack:** Bun, TypeScript, Hono, DynamoDB, @casfa/cas, @casfa/core.

**Design ref:** [2026-03-02-server-next-drop-realm-package.md](./2026-03-02-server-next-drop-realm-package.md)

---

## Task 1: 定义 Branch 类型与 BranchStore 接口

**Files:**
- Create: `apps/server-next/backend/types/branch.ts`
- Create: `apps/server-next/backend/db/branch-store.ts`（仅类型与内存实现，供单测用）

**Step 1: 添加 Branch 类型与 BranchStore 接口**

在 `backend/types/branch.ts` 中：

```ts
export type Branch = {
  branchId: string;
  realmId: string;
  parentId: string | null;
  mountPath: string;
  expiresAt: number;
};
```

在 `backend/db/branch-store.ts` 中定义接口与内存实现（与现有 createMemoryDelegateStore 行为对齐：getRealmRoot = root 记录的 root key；listBranches 只返回 parentId !== null；ensureRealmRoot 若无 root 则插入一条 parentId=null、mountPath=""、expiresAt=0 的记录并 setRoot）：

```ts
import type { Branch } from "../types/branch.ts";

export type BranchStore = {
  getBranch(branchId: string): Promise<Branch | null>;
  getRealmRoot(realmId: string): Promise<string | null>;
  getRealmRootRecord(realmId: string): Promise<{ branchId: string } | null>;
  setRealmRoot(realmId: string, nodeKey: string): Promise<void>;
  ensureRealmRoot(realmId: string, emptyRootKey: string): Promise<void>;
  getBranchRoot(branchId: string): Promise<string | null>;
  setBranchRoot(branchId: string, nodeKey: string): Promise<void>;
  listBranches(realmId: string): Promise<Branch[]>;
  insertBranch(branch: Branch): Promise<void>;
  removeBranch(branchId: string): Promise<void>;
  purgeExpiredBranches(expiredBefore: number): Promise<number>;
};

export function createMemoryBranchStore(): BranchStore { ... }
```

实现 createMemoryBranchStore：用 Map<branchId, Branch>、Map<branchId, rootKey>，以及「root 记录」用 parentId=null 的 branch 存在同一 Map 中，listBranches 过滤 parentId !== null。

**Step 2: 运行 typecheck**

Run: `cd apps/server-next && bun run typecheck`  
Expected: PASS

**Step 3: Commit**

```bash
git add apps/server-next/backend/types/branch.ts apps/server-next/backend/db/branch-store.ts
git commit -m "feat(server-next): add Branch type and BranchStore with memory impl"
```

---

## Task 2: Dynamo BranchStore 实现

**Files:**
- Create: `apps/server-next/backend/db/dynamo-branch-store.ts`（从 dynamo-delegate-store 拷贝并改写）
- Modify: 使用 `Branch` 与 `BranchStore`，保留 PK/SK/GSI 与 item 形状；修复原文件中重复的 listDelegates 块；getRealmRoot = Query GSI gsi1pk=REALM#realmId, gsi1sk=PARENT#ROOT，取第一条的 pk 再 Get ROOT sk；listBranches = Query GSI 后过滤 sk=METADATA 且 parentId !== null；insertBranch 写入 METADATA + ROOT（root 记录同样形状）；ensureRealmRoot 若 getRealmRootRecord 为 null 则 insertBranch({ branchId: uuid(), realmId, parentId: null, mountPath: "", expiresAt: 0 }) 并 setBranchRoot(id, emptyRootKey)。

**Step 1: 复制并改写**

从 `dynamo-delegate-store.ts` 复制为 `dynamo-branch-store.ts`，import 改为 `../types/branch` 的 Branch 与 `./branch-store` 的 BranchStore；Delegate -> Branch；delegateId -> branchId；去掉 lifetime/accessTokenHash/refreshTokenHash/accessExpiresAt，只保留 expiresAt（root 用 0）；listDelegates -> listBranches 且只返回 parentId !== null 的项；实现 getRealmRoot、getRealmRootRecord、setRealmRoot、ensureRealmRoot。

**Step 2: 运行 typecheck**

Run: `cd apps/server-next && bun run typecheck`  
Expected: PASS

**Step 3: Commit**

```bash
git add apps/server-next/backend/db/dynamo-branch-store.ts
git commit -m "feat(server-next): add DynamoDB BranchStore implementation"
```

---

## Task 3: Realm 根解析与 ensureEmptyRoot

**Files:**
- Modify: `apps/server-next/backend/services/root-resolver.ts`
- Modify: `apps/server-next/backend/services/cas.ts`（若无 ensureEmptyRoot 则在此或 root-resolver 依赖里实现）

**Step 1: 修改 root-resolver 依赖与 getCurrentRoot**

- RootResolverDeps: 移除 realm、delegateStore；加入 branchStore: BranchStore, cas, key。
- getCurrentRoot(auth)：若 user/delegate，realmId = auth.userId | auth.realmId；rootKey = await deps.branchStore.getRealmRoot(realmId)；若 rootKey === null，则调用 ensureEmptyRoot(cas, key) 得到 emptyKey，再 branchStore.ensureRealmRoot(realmId, emptyKey)，rootKey = emptyKey；return rootKey。若 worker，return deps.branchStore.getBranchRoot(auth.branchId)。
- getEffectiveDelegateId：改为 getEffectiveRootOwner：user/delegate 时返回 (await deps.branchStore.getRealmRootRecord(realmId))?.branchId 或确保 ensure 后必有；worker 返回 auth.branchId。用于 commit 时决定调 setRealmRoot 还是 setBranchRoot。

**Step 2: 实现 ensureEmptyRoot**

在 root-resolver 或单独 util：`async function ensureEmptyRoot(cas: CasFacade, key: KeyProvider): Promise<string>`：encodeDictNode({ children: [], childNames: [] })，putNode(hashToKey(encoded.hash), streamFromBytes(encoded.bytes))，return hashToKey(encoded.hash)。在 getCurrentRoot 的 null 分支中调用。

**Step 3: 运行 root-resolver 单测**

Run: `cd apps/server-next && bun test backend/__tests__/services/root-resolver.test.ts`  
需先更新该测试：用 createMemoryBranchStore、不再 createRealmFacade；准备 branchStore 的 root（ensureRealmRoot）和 branch 数据。  
Expected: 修改测试后 PASS

**Step 4: Commit**

```bash
git add apps/server-next/backend/services/root-resolver.ts apps/server-next/backend/__tests__/services/root-resolver.test.ts
git commit -m "refactor(server-next): root-resolver use BranchStore and ensureEmptyRoot"
```

---

## Task 4: Realm info 与 GC 服务

**Files:**
- Create: `apps/server-next/backend/services/realm-info.ts`
- Modify: `apps/server-next/backend/controllers/realm.ts`

**Step 1: 实现 realm-info 服务**

- deps: cas, branchStore, delegateGrantStore。
- info(realmId): cas.info() 得 nodeCount, totalBytes, lastGcTime；branchCount = (await branchStore.listBranches(realmId)).length；delegateCount = (await delegateGrantStore.list(realmId)).length；return { lastGcTime, nodeCount, totalBytes, branchCount, delegateCount }。
- gc(realmId, cutOffTime): rootKey = await branchStore.getRealmRoot(realmId)；branches = await branchStore.listBranches(realmId)；keys = [rootKey, ...(await Promise.all(branches.map(b => branchStore.getBranchRoot(b.branchId))))].filter(Boolean)；await cas.gc(keys, cutOffTime)。

**Step 2: 修改 realm controller**

- 依赖改为 realmInfoService（或直接传 cas, branchStore, delegateGrantStore 在 app 里建 realmInfo 对象）；info/usage/gc 调 realmInfo 的 info 与 gc。

**Step 3: 运行 typecheck 与 realm 相关单测**

Run: `cd apps/server-next && bun run typecheck && bun test backend/__tests__/controllers/me.test.ts`（若存在 realm 单测则一并跑）  
Expected: PASS

**Step 4: Commit**

```bash
git add apps/server-next/backend/services/realm-info.ts apps/server-next/backend/controllers/realm.ts
git commit -m "feat(server-next): realm info and gc using cas and BranchStore"
```

---

## Task 5: Branches controller 与 complete 使用 BranchStore

**Files:**
- Modify: `apps/server-next/backend/controllers/branches.ts`
- Modify: `apps/server-next/backend/app.ts`（deps 与注入）

**Step 1: branches 控制器改用 BranchStore**

- 移除 `import type { Delegate } from "@casfa/realm"`；改用 `Branch` 与 BranchStore。
- create（从 realm 根）：getRealmRoot(realmId)，resolvePath(cas, rootKey, mountPath) 得 childRootKey；insertBranch({ branchId, realmId, parentId: null, mountPath, expiresAt })；setBranchRoot(branchId, childRootKey)；返回 branchId 与 base64url(branchId)。
- create（从父 branch）：auth 须为 worker 且 parentBranchId === auth.branchId；getBranch(parentBranchId)、getBranchRoot(parentBranchId)；resolvePath(cas, parentRootKey, mountPath)；insertBranch({ branchId, realmId, parentId: parentBranchId, mountPath, expiresAt })；setBranchRoot(branchId, childRootKey)；返回同上。
- list：branchStore.listBranches(realmId)；worker 只返回当前 branch。
- revoke：branchStore.removeBranch(branchId)。
- complete：getBranch(branchId)；parentId 为 null 则 400；getBranchRoot(branchId)、getBranchRoot(parentId) 或 getRealmRoot(realmId)；replaceSubtreeAtPath；setRealmRoot 或 setBranchRoot(parentId, newKey)；removeBranch(branchId)。

**Step 2: app.ts 依赖**

- AppDeps：移除 realm、delegateStore；加入 branchStore；realm controller 与 branches、root-resolver、auth 均用 branchStore。
- 创建 realmInfo 对象（或 createRealmInfoService(cas, branchStore, delegateGrantStore)）并传给 realm controller。

**Step 3: 运行 typecheck 与 branches 单测**

Run: `cd apps/server-next && bun run typecheck && bun test backend/ --testPathPattern=branch`  
Expected: 修改测试中 @casfa/realm 为 branchStore 后 PASS

**Step 4: Commit**

```bash
git add apps/server-next/backend/controllers/branches.ts apps/server-next/backend/app.ts
git commit -m "refactor(server-next): branches controller use BranchStore"
```

---

## Task 6: Auth middleware 使用 BranchStore

**Files:**
- Modify: `apps/server-next/backend/middleware/auth.ts`
- Modify: `apps/server-next/backend/__tests__/middleware/auth.test.ts`

**Step 1: auth 中间件**

- AuthMiddlewareDeps：delegateStore -> branchStore: BranchStore。
- Branch token 校验：getBranch(branchId)；若 null 则 401；若 Date.now() > branch.expiresAt 则 401；否则 set auth = { type: "worker", realmId: branch.realmId, branchId: branch.branchId, access: "readwrite" }。

**Step 2: 单测**

- 用 createMemoryBranchStore；插入 branch 与 root 记录；验证 Bearer base64url(branchId) 得到 worker auth；过期或不存在返回 401。

**Step 3: 运行 auth 单测**

Run: `cd apps/server-next && bun test backend/__tests__/middleware/auth.test.ts`  
Expected: PASS

**Step 4: Commit**

```bash
git add apps/server-next/backend/middleware/auth.ts apps/server-next/backend/__tests__/middleware/auth.test.ts
git commit -m "refactor(server-next): auth middleware use BranchStore"
```

---

## Task 7: 入口与 MCP 去掉 realm

**Files:**
- Modify: `apps/server-next/backend/index.ts`
- Modify: `apps/server-next/backend/lambda.ts`
- Modify: `apps/server-next/backend/mcp/handler.ts`
- Modify: `apps/server-next/package.json`
- Delete: `apps/server-next/backend/services/realm.ts`

**Step 1: index.ts / lambda.ts**

- 移除 createRealmFacadeFromConfig、createDynamoDelegateStore；改为 createDynamoBranchStore(config)（表名仍用 config.dynamodbTableDelegates）；不再 realm、delegateStore；传入 branchStore；若 app 需要 realmInfo，用 cas + branchStore + delegateGrantStore 构造。

**Step 2: mcp/handler.ts**

- 创建 branch 等逻辑改为使用 deps.branchStore；类型 Branch 从 types/branch 引入；移除 @casfa/realm。

**Step 3: 删除 realm 服务与依赖**

- 删除 `backend/services/realm.ts`。
- package.json 中删除 `"@casfa/realm": "workspace:*"`。

**Step 4: 运行全量单测与 typecheck**

Run: `cd apps/server-next && bun run typecheck && bun run test:unit`  
Expected: PASS

**Step 5: Commit**

```bash
git add apps/server-next/backend/index.ts apps/server-next/backend/lambda.ts apps/server-next/backend/mcp/handler.ts apps/server-next/package.json
git rm apps/server-next/backend/services/realm.ts
git commit -m "chore(server-next): remove @casfa/realm dependency and realm service"
```

---

## Task 8: E2E 与 README

**Files:**
- Modify: `apps/server-next/tests/setup.ts`
- Modify: `apps/server-next/README.md`

**Step 1: E2E setup**

- 使用 createDynamoBranchStore 替代 createDynamoDelegateStore；不再 createRealmFacadeFromConfig；createApp 传入 branchStore；helpers 不变（API 行为一致）。

**Step 2: README**

- 将「Branch 对应 @casfa/realm 的 Delegate」改为「Branch 由 server-next 的 BranchStore 管理，直接基于 CAS 与 DynamoDB」。

**Step 3: 运行 E2E**

Run: `cd apps/server-next && bun run test:e2e`  
Expected: PASS（若环境具备 DynamoDB/S3 或 serverless-offline）

**Step 4: Commit**

```bash
git add apps/server-next/tests/setup.ts apps/server-next/README.md
git commit -m "docs(server-next): e2e and README after dropping realm package"
```

---

## Task 9: 删除 dynamo-delegate-store 与收尾

**Files:**
- Delete: `apps/server-next/backend/db/dynamo-delegate-store.ts`（已被 dynamo-branch-store 替代）
- Modify: 任何仍引用 dynamo-delegate-store 的路径改为 dynamo-branch-store（index.ts、lambda.ts、tests/setup.ts 已在前面改过；确认无遗漏）

**Step 1: 删除旧文件并确认引用**

- grep 确认无 import 来自 dynamo-delegate-store。
- 删除 dynamo-delegate-store.ts。

**Step 2: 运行 typecheck 与 test**

Run: `cd apps/server-next && bun run typecheck && bun run test:unit`  
Expected: PASS

**Step 3: Commit**

```bash
git rm apps/server-next/backend/db/dynamo-delegate-store.ts
git commit -m "chore(server-next): remove dynamo-delegate-store in favor of dynamo-branch-store"
```

---

## 执行选项

计划已保存到 `docs/plans/2026-03-02-server-next-drop-realm-implementation.md`。

**两种执行方式：**

1. **本会话内分步执行** — 按 Task 1～9 依次实现，每步跑测试并 commit。
2. **新会话中执行** — 在新会话中用 executing-plans skill 按任务批量执行并做检查点。

你更倾向哪一种？若选 1，我可以从 Task 1 开始在本会话内逐步实现。
