# server-next 缺失功能补全 · 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 补全 server-next 三项缺失功能：文件删除/移动/复制（GUI + MCP）、Branch 完成（MCP）、Usage & GC（GUI）。设计见 [2026-03-03-server-next-missing-features-design.md](./2026-03-03-server-next-missing-features-design.md)。

**Architecture:** 前端在 Explorer 目录树加右键菜单与对话框，调用现有 REST；fs-api 新增 deletePath/movePath/copyPath。MCP handler 新增 fs_rm、fs_mv、fs_cp、branch_complete，复用现有 rootResolver 与权限逻辑；branch_complete 复用后端 complete 业务逻辑（可抽成共享函数）。Settings 页新增「存储」入口，展示 usage 与 GC 按钮。

**Tech Stack:** React 18, MUI, existing Hono backend, MCP JSON-RPC in `backend/mcp/handler.ts`.

---

## Task 1: fs-api 增加 deletePath、movePath、copyPath

**Files:**
- Modify: `apps/server-next/frontend/src/lib/fs-api.ts`

**Step 1: 实现 deletePath**

在 `fs-api.ts` 末尾添加：

```ts
export async function deletePath(path: string): Promise<void> {
  const realmId = useAuthStore.getState().user?.userId;
  if (!realmId) throw new Error("Not authenticated");
  const normalized = !path || path === "/" ? "" : path.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!normalized) throw new Error("Path required");
  const res = await apiFetch(`/api/realm/${realmId}/fs/rm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: normalized }),
  });
  if (!res.ok) {
    const data = (await res.json()) as { message?: string };
    throw new Error(data.message ?? "Delete failed");
  }
}
```

**Step 2: 实现 movePath 和 copyPath**

同上文件，在 `deletePath` 后添加：

```ts
export async function movePath(from: string, to: string): Promise<void> {
  const realmId = useAuthStore.getState().user?.userId;
  if (!realmId) throw new Error("Not authenticated");
  const fromNorm = !from || from === "/" ? "" : from.replace(/^\/+|\/+$/g, "");
  const toNorm = !to || to === "/" ? "" : to.replace(/^\/+|\/+$/g, "");
  if (!fromNorm || !toNorm) throw new Error("from and to required");
  const res = await apiFetch(`/api/realm/${realmId}/fs/mv`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from: fromNorm, to: toNorm }),
  });
  if (!res.ok) {
    const data = (await res.json()) as { message?: string };
    throw new Error(data.message ?? "Move failed");
  }
}

export async function copyPath(from: string, to: string): Promise<void> {
  const realmId = useAuthStore.getState().user?.userId;
  if (!realmId) throw new Error("Not authenticated");
  const fromNorm = !from || from === "/" ? "" : from.replace(/^\/+|\/+$/g, "");
  const toNorm = !to || to === "/" ? "" : to.replace(/^\/+|\/+$/g, "");
  if (!fromNorm || !toNorm) throw new Error("from and to required");
  const res = await apiFetch(`/api/realm/${realmId}/fs/cp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from: fromNorm, to: toNorm }),
  });
  if (!res.ok) {
    const data = (await res.json()) as { message?: string };
    throw new Error(data.message ?? "Copy failed");
  }
}
```

**Step 3: 验证**

运行 `cd apps/server-next/frontend && bun run build`，应通过。

**Step 4: Commit**

```bash
git add apps/server-next/frontend/src/lib/fs-api.ts
git commit -m "feat(server-next): add deletePath, movePath, copyPath to fs-api"
```

---

## Task 2: Explorer 目录树右键菜单与删除/移动/复制对话框

**Files:**
- Modify: `apps/server-next/frontend/src/components/explorer/directory-tree.tsx`
- Modify: `apps/server-next/frontend/src/lib/fs-api.ts`（已具备 deletePath/movePath/copyPath）

**Step 1: 在 directory-tree 中引入 Menu、Dialog 与 fs-api**

在文件顶部 import 中增加：`Menu`, `MenuItem`（来自 MUI），以及 `deletePath`, `movePath`, `copyPath` 来自 `../../lib/fs-api`。

**Step 2: 添加右键菜单状态与目标条目**

- 状态：`contextMenuAnchor: null | { x: number; y: number }`，`contextMenuEntry: FsEntry | null`。
- 列表项：在 `ListItemButton` 上增加 `onContextMenu={(e) => { e.preventDefault(); setContextMenuAnchor({ x: e.clientX, y: e.clientY }); setContextMenuEntry(entry); }}`。
- 渲染 `Menu open={!!contextMenuAnchor} anchorReference="anchorPosition" anchorPosition={contextMenuAnchor ?? undefined} onClose={() => { setContextMenuAnchor(null); setContextMenuEntry(null); }}`，内含 `MenuItem`「删除」「移动」「复制」（禁用条件：无 `contextMenuEntry` 时禁用）。点击「删除」打开删除确认对话框；点击「移动」/「复制」打开目标路径对话框。

**Step 3: 删除确认对话框**

- 状态：`deleteDialogOpen: boolean`，`deleteEntry: FsEntry | null`。
- 菜单点「删除」→ `setDeleteEntry(contextMenuEntry); setDeleteDialogOpen(true);` 并关闭菜单。
- Dialog：标题「删除」或「确认删除」，内容显示「确定要删除 xxx 吗？」（`deleteEntry?.name`），取消/确定。确定时调用 `deletePath(deleteEntry.path)`，成功则 `setRefreshKey(k=>k+1)`、关闭对话框、Snackbar 成功；失败 Snackbar 错误。关闭对话框时清空 `deleteEntry`。

**Step 4: 移动/复制目标路径对话框**

- 状态：`moveCopyDialog: { open: boolean; mode: 'move' | 'copy'; entry: FsEntry | null; targetPath: string }`。
- 菜单点「移动」→ `setMoveCopyDialog({ open: true, mode: 'move', entry: contextMenuEntry, targetPath: '' })`；点「复制」同理 `mode: 'copy'`。
- Dialog：标题「移动」或「复制」，TextField  label="目标路径" value={targetPath} onChange，取消/确定。确定时：move 调用 `movePath(entry.path, targetPath)`，copy 调用 `copyPath(entry.path, targetPath)`，成功则刷新、关闭、Snackbar；失败 Snackbar。路径需规范化（可去掉首尾 `/` 后与 entry.path 校验不能相同）。

**Step 5: 菜单关闭后点击外部**

`Menu` 的 `onClose` 已清理 anchor 和 entry；Dialog 的 `onClose` 清理各自状态。

**Step 6: 验证**

本地 `bun run dev`，在 Explorer 中右键文件/文件夹，执行删除（确认）、移动（输入目标路径）、复制，确认列表刷新且无报错。

**Step 7: Commit**

```bash
git add apps/server-next/frontend/src/components/explorer/directory-tree.tsx
git commit -m "feat(server-next): Explorer context menu for delete, move, copy"
```

---

## Task 3: MCP 增加 fs_rm、fs_mv、fs_cp

**Files:**
- Modify: `apps/server-next/backend/mcp/handler.ts`

**Step 1: 在 MCP_TOOLS 中注册三个 tool**

在现有 `fs_read` 之后追加：

```ts
{
  name: "fs_rm",
  description: "Remove a file or directory at the given path. Requires file_write.",
  inputSchema: {
    type: "object" as const,
    properties: { path: { type: "string" as const, description: "Path to remove" } },
    required: ["path"] as string[],
  },
},
{
  name: "fs_mv",
  description: "Move or rename a file or directory. Requires file_write.",
  inputSchema: {
    type: "object" as const,
    properties: {
      from: { type: "string" as const, description: "Source path" },
      to: { type: "string" as const, description: "Destination path" },
    },
    required: ["from", "to"] as string[],
  },
},
{
  name: "fs_cp",
  description: "Copy a file or directory to a new path. Requires file_write.",
  inputSchema: {
    type: "object" as const,
    properties: {
      from: { type: "string" as const, description: "Source path" },
      to: { type: "string" as const, description: "Destination path" },
    },
    required: ["from", "to"] as string[],
  },
},
```

**Step 2: 在 handleToolsCall 中实现 fs_rm**

在 `fs_mkdir` 分支之后、`// fs_ls, fs_stat, fs_read` 注释之前，增加对 `fs_rm` 的处理：

- 检查 `hasFileWrite(auth)`，否则返回 MCP_INVALID_PARAMS。
- `pathStr = args.path` 规范化（trim、去掉首尾 `/`），必填。
- `rootKey = await getCurrentRoot(auth, deps)`，null 则返回 "Realm not initialized"。
- 调用 `removeEntryAtPath(deps.cas, deps.key, rootKey, pathStr)` 得到 newRootKey；`getEffectiveDelegateId` 后 `deps.branchStore.setBranchRoot(delegateId, newRootKey)`。
- 需从 handler 顶部 import `removeEntryAtPath`（来自 `../services/tree-mutations.ts`）。
- 成功返回 `mcpSuccess(id, { content: [{ type: "text", text: JSON.stringify({ path: pathStr }) }] })`。
- 错误（如 path not found）catch 后返回 mcpError MCP_INVALID_PARAMS。

**Step 3: 在 handleToolsCall 中实现 fs_mv 和 fs_cp**

- fs_mv：取 `args.from`、`args.to` 规范化；getCurrentRoot；`resolvePath(deps.cas, rootKey, fromStr)` 得 nodeKey，null 则 "from path not found"；`removeEntryAtPath` 再 `addOrReplaceAtPath(..., toStr, nodeKey)`；setBranchRoot。
- fs_cp：同上，但先 `resolvePath` 取 nodeKey 后直接 `addOrReplaceAtPath(rootKey, toStr, nodeKey)`，不先 remove。
- 两者失败时与现有 fs_mkdir 一样捕获 BAD_REQUEST 类 message 返回 MCP_INVALID_PARAMS。

**Step 4: 单元测试（可选）**

若有 `tests/mcp.test.ts`，可为 fs_rm/fs_mv/fs_cp 增加用例（Worker 或 Delegate 带 file_write 调用 tools/call，断言成功或 400 错误）。无则跳过。

**Step 5: 运行测试**

`cd apps/server-next && bun run test:unit`，通过。

**Step 6: Commit**

```bash
git add apps/server-next/backend/mcp/handler.ts
git commit -m "feat(server-next): MCP tools fs_rm, fs_mv, fs_cp"
```

---

## Task 4: Branch 完成逻辑共享与 MCP branch_complete

**Files:**
- Create or Modify: `apps/server-next/backend/services/branch-complete.ts`（新建，抽取逻辑）
- Modify: `apps/server-next/backend/controllers/branches.ts`
- Modify: `apps/server-next/backend/mcp/handler.ts`

**Step 1: 抽取 completeBranch 函数**

新建 `apps/server-next/backend/services/branch-complete.ts`：

- 导出 `completeBranch(branchId: string, deps: BranchesControllerDeps): Promise<{ completed: string }>`。
- 将 `branches.ts` 中 `complete(c)` 从 “const auth = ...” 到 “return c.json({ completed: branchId })” 的业务逻辑移入此函数（参数为 branchId 与 deps，deps 需包含 branchStore、cas、key）。逻辑中不再使用 `c.req.param`，直接使用传入的 branchId。
- 需要从 `tree-mutations` 引入 `replaceSubtreeAtPath`；从 `../types/branch` 或 branchStore 获取 Branch 类型（若需）。

**Step 2: 在 branches controller 中调用 completeBranch**

在 `complete(c)` 中：保留 auth 与 branchId 解析（param "me" 用 auth.branchId）；校验 worker 与 own branch；然后 `const result = await completeBranch(branchId, deps); return c.json(result, 200);`。错误仍由 completeBranch 抛出，controller 的 onError 或 try/catch 返回 403/404/400。

**Step 3: MCP 注册 branch_complete tool**

在 `handler.ts` 的 MCP_TOOLS 中增加：

```ts
{
  name: "branch_complete",
  description: "Complete the current branch (Worker only): merge into parent and invalidate this branch.",
  inputSchema: { type: "object" as const, properties: {}, required: [] as string[] },
},
```

**Step 4: MCP handleToolsCall 中实现 branch_complete**

- 若 `name === "branch_complete"`：若 `auth.type !== "worker"` 返回 mcpError "Only Worker can complete a branch"。
- 调用 `completeBranch(auth.branchId, deps)`。deps 需包含 branchStore、cas、key；若 completeBranch 在 service 中需要 config，从 handler 的 deps.config 传入。
- 成功返回 mcpSuccess(id, { content: [{ type: "text", text: JSON.stringify({ completed: auth.branchId }) }] })。
- 失败（如 branch not found、cannot complete root）catch 后返回 mcpError MCP_INVALID_PARAMS 与 message。

**Step 5: 依赖类型**

确保 `BranchesControllerDeps`（或新命名 `BranchCompleteDeps`）包含 branchStore、cas、key；若 complete 逻辑里用到了 config 可省略。MCP 的 deps 当前是 `RootResolverDeps & { config }`，没有 config 则 branch-complete 里不读 config；若有 maxTtl 等可后续加。

**Step 6: 运行测试**

`bun run test:unit` 与 `bun run test`（含 E2E）通过。

**Step 7: Commit**

```bash
git add apps/server-next/backend/services/branch-complete.ts apps/server-next/backend/controllers/branches.ts apps/server-next/backend/mcp/handler.ts
git commit -m "feat(server-next): branch_complete MCP tool and shared completeBranch logic"
```

---

## Task 5: Settings 存储区块 — Usage 与 GC

**Files:**
- Modify: `apps/server-next/frontend/src/pages/settings-page.tsx`
- Create: `apps/server-next/frontend/src/components/settings/storage-tab.tsx`（或内联到 settings-page 的「存储」区块）

**Step 1: 新增「存储」入口**

在 Settings 左侧 List 中增加一项「存储」（图标可用 Storage 或 Folder），与 Delegates 并列；点击后 `tabValue` 或 path 为 `storage`，路由可用 `/settings/storage` 或仅本地 state（与当前 Delegates 一致，仅 state 也可）。

**Step 2: 创建 Storage 内容组件**

新建 `apps/server-next/frontend/src/components/settings/storage-tab.tsx`：

- 状态：`usage: { nodeCount?: number; totalBytes?: number } | null`，`loading: boolean`，`error: string | null`，`gcLoading: boolean`，`gcDialogOpen: boolean`。
- 请求：`GET /api/realm/${realmId}/usage`，realmId 从 useAuthStore 取；解析 JSON 为 `{ nodeCount, totalBytes }`，设入 usage。
- 展示：Typography 显示「节点数：{nodeCount}」「已用：{totalBytes} MB」（或 KB，按 totalBytes/1024/1024 计算）。加载中显示 CircularProgress；错误显示 Alert。可选「刷新」按钮重新请求。
- GC：按钮「运行 GC」点击后 `setGcDialogOpen(true)`。确认对话框说明「将清理未被引用的节点，可能耗时」，确定后 `setGcLoading(true)`，`POST /api/realm/${realmId}/gc` body `{}`，成功则 Snackbar 成功、关闭对话框、重新请求 usage；失败 Snackbar 错误。取消关闭对话框。

**Step 3: 在 Settings 页中挂载 Storage 内容**

在 settings-page 右侧内容区：当 `tabValue === 'storage'` 时渲染 `<StorageTab />`（或内联的存储区块）。确保未登录或无 userId 时不请求 usage（或请求后 403 显示「仅主账号可用」）。

**Step 4: 路由（可选）**

若希望 URL 为 `/settings/storage`，在 App.tsx 增加 Route `/settings/storage` 指向 SettingsPage；Settings 内根据 pathname 或 search 设 tabValue。当前设计可为仅侧边点「存储」切换 tab，不强制改路由。

**Step 5: 验证**

登录后进入 Settings → 存储，应看到 usage；点击「运行 GC」确认后应收到 200 并刷新 usage（或 Snackbar）。

**Step 6: Commit**

```bash
git add apps/server-next/frontend/src/pages/settings-page.tsx apps/server-next/frontend/src/components/settings/storage-tab.tsx
git commit -m "feat(server-next): Settings storage tab with usage and GC"
```

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-03-03-server-next-missing-features-impl.md`.

**Two execution options:**

1. **Subagent-Driven (this session)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Parallel Session (separate)** — Open a new session with executing-plans, batch execution with checkpoints.

Which approach do you prefer?
