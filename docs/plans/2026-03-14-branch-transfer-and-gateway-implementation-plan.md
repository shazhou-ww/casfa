# Branch Transfer & Gateway Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 drive branch 原语改造为 `create_branch + transfer_paths + close_branch`，并实现一个 server-side gateway，统一管理 servers/tools 与极简 binding 翻译，隐藏 agent 的 branch 细节。

**Architecture:** drive 侧去掉 branch 挂载语义，不再通过 `mountPath` 描述分支；跨 branch 数据移动统一为批量原子 `transfer_paths`。gateway 作为独立 cell 提供控制面工具（`list_servers/search_servers/add_server/remove_server/get_tools/load_tools`）和运行时翻译层，基于 `tools/list` 返回的极简 `x-binding`（`branchUrl + inputs + outputs`）自动创建执行 branch、准备输入、调用 raw tool、发布输出并关闭 branch。遵循 @superpowers:test-driven-development，小步提交。

**Tech Stack:** Bun, TypeScript, Hono, Zod, DynamoDB store, MCP JSON-RPC。

---

### Task 1: 重构 Branch 数据模型（去 mountPath，保留 close 生命周期）

**Files:**
- Modify: `cells/drive/backend/types/branch.ts`
- Modify: `cells/drive/backend/db/branch-store.ts`
- Modify: `cells/drive/backend/db/dynamo-branch-store.ts`
- Test: `cells/drive/backend/db/branch-store.test.ts` (create if missing)

**Step 1: Write the failing test**

```ts
it("stores branch without mountPath", async () => {
  await store.insertBranch({ branchId: "b1", realmId: "r1", parentId: "root", expiresAt: Date.now() + 60_000 });
  const branch = await store.getBranch("b1");
  expect(branch?.branchId).toBe("b1");
  expect((branch as { mountPath?: unknown }).mountPath).toBeUndefined();
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test:unit -- backend/db/branch-store.test.ts`  
Expected: FAIL（类型或持久化仍依赖 `mountPath`）。

**Step 3: Write minimal implementation**

```ts
export type Branch = {
  branchId: string;
  realmId: string;
  parentId: string | null;
  expiresAt: number;
  accessVerification?: { value: string; expiresAt: number };
};
```

**Step 4: Run test to verify it passes**

Run: `bun run test:unit -- backend/db/branch-store.test.ts`  
Expected: PASS。

**Step 5: Commit**

```bash
git add cells/drive/backend/types/branch.ts cells/drive/backend/db/branch-store.ts cells/drive/backend/db/dynamo-branch-store.ts cells/drive/backend/db/branch-store.test.ts
git commit -m "refactor(drive): remove mountPath from branch model"
```

---

### Task 2: 引入统一 TransferSpec（create initialTransfers 与 transfer_paths 共用）

**Files:**
- Create: `cells/drive/backend/types/transfer.ts`
- Create: `cells/drive/backend/services/transfer-paths.ts`
- Test: `cells/drive/backend/__tests__/services/transfer-paths.test.ts`

**Step 1: Write the failing test**

```ts
it("rejects parent-child conflicts in target paths", async () => {
  const spec = {
    source: "b-src",
    target: "b-tgt",
    mapping: { "a.png": "out", "b.png": "out/sub/b.png" },
    mode: "replace",
  } as const;
  await expect(executeTransfer(spec, deps)).rejects.toThrow("target paths must not be ancestor/descendant");
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test:unit -- backend/__tests__/services/transfer-paths.test.ts`  
Expected: FAIL（服务不存在或未做冲突检查）。

**Step 3: Write minimal implementation**

```ts
export type TransferSpec = {
  source: string;
  target: string;
  mapping: Record<string, string>;
  mode?: "replace" | "fail_if_exists" | "merge_dir";
};
```

**Step 4: Run test to verify it passes**

Run: `bun run test:unit -- backend/__tests__/services/transfer-paths.test.ts`  
Expected: PASS（含路径规范化、重复/父子冲突校验）。

**Step 5: Commit**

```bash
git add cells/drive/backend/types/transfer.ts cells/drive/backend/services/transfer-paths.ts cells/drive/backend/__tests__/services/transfer-paths.test.ts
git commit -m "feat(drive): add TransferSpec and preflight conflict validation"
```

---

### Task 3: 扩展 create_branch 支持 initialTransfers（同参数结构）

**Files:**
- Modify: `cells/drive/backend/controllers/branches.ts`
- Modify: `cells/drive/backend/mcp/handler.ts`
- Test: `cells/drive/tests/branches.test.ts`

**Step 1: Write the failing test**

```ts
it("create_branch applies initialTransfers atomically", async () => {
  // create source branch with test file; create target via initialTransfers
  // assert transferred file exists in target root after create
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test:e2e -- tests/branches.test.ts`  
Expected: FAIL（create 接口不识别 initialTransfers）。

**Step 3: Write minimal implementation**

```ts
type CreateBranchBody = {
  ttl?: number;
  parentBranchId?: string;
  initialTransfers?: TransferSpec;
};
```

**Step 4: Run test to verify it passes**

Run: `bun run test:e2e -- tests/branches.test.ts`  
Expected: PASS（initialTransfers 成功时 branch 创建成功；失败时整体失败）。

**Step 5: Commit**

```bash
git add cells/drive/backend/controllers/branches.ts cells/drive/backend/mcp/handler.ts cells/drive/tests/branches.test.ts
git commit -m "feat(drive): support initialTransfers in create_branch"
```

---

### Task 4: 新增 transfer_paths API 与 MCP 工具

**Files:**
- Modify: `cells/drive/backend/controllers/branches.ts`
- Modify: `cells/drive/backend/app.ts`
- Modify: `cells/drive/backend/mcp/handler.ts`
- Test: `cells/drive/tests/branches.test.ts`
- Test: `cells/drive/tests/mcp.test.ts`

**Step 1: Write the failing test**

```ts
it("transfer_paths moves mapped files atomically", async () => {
  // call POST /api/realm/me/branches/:branchId/transfer-paths
  // assert all mappings applied or none applied
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test:e2e -- tests/branches.test.ts tests/mcp.test.ts`  
Expected: FAIL（route/tool 不存在）。

**Step 3: Write minimal implementation**

```ts
app.post("/api/realm/:realmId/branches/:branchId/transfer-paths", (c) => branches.transferPaths(c));
// MCP tool: branch_transfer_paths(spec)
```

**Step 4: Run test to verify it passes**

Run: `bun run test:e2e -- tests/branches.test.ts tests/mcp.test.ts`  
Expected: PASS。

**Step 5: Commit**

```bash
git add cells/drive/backend/controllers/branches.ts cells/drive/backend/app.ts cells/drive/backend/mcp/handler.ts cells/drive/tests/branches.test.ts cells/drive/tests/mcp.test.ts
git commit -m "feat(drive): add transfer_paths api and mcp tool"
```

---

### Task 5: 新增 close_branch（替代 discard/revoke 语义）

**Files:**
- Modify: `cells/drive/backend/controllers/branches.ts`
- Modify: `cells/drive/backend/app.ts`
- Modify: `cells/drive/backend/mcp/handler.ts`
- Test: `cells/drive/tests/branches.test.ts`

**Step 1: Write the failing test**

```ts
it("close_branch invalidates branch token without reverting transferred data", async () => {
  // transfer data to target branch, close source branch
  // assert source branch unavailable and target data remains
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test:e2e -- tests/branches.test.ts`  
Expected: FAIL（close 接口不存在）。

**Step 3: Write minimal implementation**

```ts
// POST /api/realm/:realmId/branches/:branchId/close
await deps.branchStore.removeBranch(branchId);
return c.json({ closed: branchId }, 200);
```

**Step 4: Run test to verify it passes**

Run: `bun run test:e2e -- tests/branches.test.ts`  
Expected: PASS。

**Step 5: Commit**

```bash
git add cells/drive/backend/controllers/branches.ts cells/drive/backend/app.ts cells/drive/backend/mcp/handler.ts cells/drive/tests/branches.test.ts
git commit -m "feat(drive): add close_branch lifecycle api"
```

---

### Task 6: 新建 gateway cell 并实现控制面（servers/tools）与用户级 OAuth 状态

**Files:**
- Create: `cells/gateway/cell.yaml`
- Create: `cells/gateway/backend/services/server-registry.ts`
- Create: `cells/gateway/backend/services/server-oauth-state.ts`
- Create: `cells/gateway/backend/services/tool-discovery.ts`
- Create: `cells/gateway/backend/app.ts`
- Test: `cells/gateway/backend/__tests__/gateway-server-management.test.ts`

**Step 1: Write the failing test**

```ts
it("list_servers returns per-user registered servers only", async () => {
  // userA add_server -> visible to userA, not userB
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test:unit -- backend/__tests__/gateway-server-management.test.ts` (in `cells/gateway`)
Expected: FAIL（服务不存在）。

**Step 3: Write minimal implementation**

```ts
// tools: list_servers/search_servers/add_server/remove_server/get_tools/load_tools
// oauth state keyed by {userId, serverId}
```

**Step 4: Run test to verify it passes**

Run: `bun run test:unit -- backend/__tests__/gateway-server-management.test.ts` (in `cells/gateway`)
Expected: PASS。

**Step 5: Commit**

```bash
git add cells/gateway/cell.yaml cells/gateway/backend/services/server-registry.ts cells/gateway/backend/services/server-oauth-state.ts cells/gateway/backend/services/tool-discovery.ts cells/gateway/backend/app.ts cells/gateway/backend/__tests__/gateway-server-management.test.ts
git commit -m "feat(agent-gateway): add per-user server registry and oauth state"
```

---

### Task 7: 在 get_tools / tools/list 暴露极简 x-binding 元数据

**Files:**
- Modify: `cells/gateway/backend/services/tool-discovery.ts`
- Create: `cells/gateway/backend/services/tool-binding-registry.ts`
- Test: `cells/gateway/backend/__tests__/gateway-tool-binding.test.ts`

**Step 1: Write the failing test**

```ts
it("returns x-binding with branchUrl and input/output args", async () => {
  // get_tools("artist") should include x-binding for flux_image/flux_image_edit
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test:unit -- backend/__tests__/gateway-tool-binding.test.ts` (in `cells/gateway`)
Expected: FAIL（未返回绑定信息）。

**Step 3: Write minimal implementation**

```ts
type MinimalBinding = {
  branchUrl: string;
  inputs: string[];
  outputs: string[];
};
```

**Step 4: Run test to verify it passes**

Run: `bun run test:unit -- backend/__tests__/gateway-tool-binding.test.ts` (in `cells/gateway`)
Expected: PASS。

**Step 5: Commit**

```bash
git add cells/gateway/backend/services/tool-discovery.ts cells/gateway/backend/services/tool-binding-registry.ts cells/gateway/backend/__tests__/gateway-tool-binding.test.ts
git commit -m "feat(agent-gateway): expose minimal x-binding in get_tools"
```

---

### Task 8: Gateway 运行时翻译执行器（artist flux_image / flux_image_edit 首批接入）

**Files:**
- Create: `cells/gateway/backend/services/tool-runtime-executor.ts`
- Modify: `cells/gateway/backend/services/tool-binding-registry.ts`
- Test: `cells/gateway/backend/__tests__/tool-runtime-executor-artist.test.ts`

**Step 1: Write the failing test**

```ts
it("translates image_edit path args into branch flow and publishes output", async () => {
  // assert runtime calls: create_branch -> transfer_paths(input) -> raw tool -> transfer_paths(output) -> close_branch
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test:unit -- backend/__tests__/tool-runtime-executor-artist.test.ts` (in `cells/gateway`)
Expected: FAIL（执行器未实现）。

**Step 3: Write minimal implementation**

```ts
// default pipeline:
// 1) create exec branch
// 2) prepare input transfers
// 3) invoke raw tool with branchUrl and rewritten input/output args
// 4) publish output transfers
// 5) close exec branch
```

**Step 4: Run test to verify it passes**

Run: `bun run test:unit -- backend/__tests__/tool-runtime-executor-artist.test.ts` (in `cells/gateway`)
Expected: PASS。

**Step 5: Commit**

```bash
git add cells/gateway/backend/services/tool-runtime-executor.ts cells/gateway/backend/services/tool-binding-registry.ts cells/gateway/backend/__tests__/tool-runtime-executor-artist.test.ts
git commit -m "feat(agent-gateway): add runtime translation pipeline for artist image tools"
```

---

### Task 9: 文档与端到端验收

**Files:**
- Modify: `docs/casfa-system-intro.md`
- Create: `docs/plans/2026-03-14-branch-transfer-and-gateway-design.md`
- Modify: `cells/gateway/README.md` (if exists, otherwise create)
- Test: `cells/drive/tests/branches.test.ts` + `cells/gateway/backend/__tests__/tool-runtime-executor-artist.test.ts`

**Step 1: Write the failing validation checklist**

```md
- [ ] image_generate: outputPath 写入成功
- [ ] image_edit: inputPath -> outputPath 转换成功
- [ ] transfer_paths 冲突规则生效（父子路径拒绝）
- [ ] close_branch 后 token 失效
```

**Step 2: Run validation commands**

Run:
- `bun run test:e2e -- tests/branches.test.ts` (in `cells/drive`)
- `bun run test:unit -- backend/__tests__/tool-runtime-executor-artist.test.ts` (in `cells/gateway`)

Expected: 当前先 FAIL（实现未全完成）→ 完成后全 PASS。

**Step 3: Write minimal documentation updates**

```md
记录三原语：create_branch / transfer_paths / close_branch；
记录极简 binding：branchUrl + inputs + outputs；
记录 gateway 控制面工具：list/search/add/remove/get/load。
```

**Step 4: Re-run validation**

Run:
- `bun run test:e2e -- tests/branches.test.ts`
- `bun run test:unit -- backend/__tests__/tool-runtime-executor-artist.test.ts` (in `cells/gateway`)

Expected: PASS。

**Step 5: Commit**

```bash
git add docs/casfa-system-intro.md docs/plans/2026-03-14-branch-transfer-and-gateway-design.md cells/gateway/README.md
git commit -m "docs: describe branch transfer primitives and gateway binding flow"
```

---

## 执行前检查清单

- 确认 `transfer_paths` 的默认 `mode`（建议 `fail_if_exists`）。
- 确认 `close_branch` 是否允许重复调用（建议幂等返回 `closed: true`）。
- 确认 gateway 对 `add_server/remove_server` 的权限模型（建议管理员或显式用户确认）。

---

## 回滚策略

- drive 原语异常时：保留旧 `complete` 路径一个版本周期，gateway fallback 到旧路径。
- gateway 绑定异常时：对单个 tool 关闭 `x-binding`，回退 raw tool 直接模式（仅内部调试可见）。

