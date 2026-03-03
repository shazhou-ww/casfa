# server-next 缺失功能补全 · 设计

**日期**：2026-03-03  
**状态**：已确认  
**范围**：最小可行 — 文件删除/移动/复制（GUI + MCP）、Branch 完成（MCP）、Usage & GC（GUI）

---

## 1. 范围与交付物

### 1.1 文件删除/移动/复制

- **GUI（必做）**：Explorer 目录树提供删除、移动、复制入口（右键菜单），调用现有 `POST /api/realm/:realmId/fs/rm`、`fs/mv`、`fs/cp`；删除前确认；移动/复制需目标路径（输入或选择）。
- **MCP（必做）**：新增 `fs_rm`、`fs_mv`、`fs_cp`，参数与 REST 一致，仅具 `file_write` 的 Worker/Delegate 可调。

### 1.2 Branch 完成

- **MCP（必做）**：新增 `branch_complete`，语义对应 `POST .../branches/:branchId/complete`，仅 Worker 可完成自己的 branch。
- **GUI**：本阶段不做。

### 1.3 Usage & GC

- **GUI（必做）**：在 Settings 页展示「空间用量」（`GET /api/realm/:realmId/usage`），并提供「运行 GC」按钮（`POST .../gc`），带确认与成功/失败提示。
- 放置：Settings 页（新子 Tab「存储」或与 Delegates 同页的「存储」区块）。

### 1.4 本阶段不做

Branch 切换器、文件上传、MCP Resources/Prompts、`.well-known` 后端实现。

---

## 2. 文件删除/移动/复制（GUI + MCP）

### 2.1 后端与 API

- 使用现有 REST：`POST .../fs/rm`（body: `path`）、`POST .../fs/mv`（body: `from`, `to`）、`POST .../fs/cp`（body: `from`, `to`）。
- 权限：需 `file_write`（User / 具 file_write 的 Delegate / readwrite Worker）。

### 2.2 GUI（Explorer）

- **入口**：目录树每条目右键菜单：「删除」「移动」「复制」。可选：选中条目后工具栏显示相同操作。
- **删除**：确认对话框（含条目名）→ 确认后调用 `fs/rm`，成功刷新列表，失败 Snackbar。
- **移动**：对话框输入目标路径 → `fs/mv(from, to)`，成功刷新列表，失败 Snackbar。
- **复制**：对话框输入目标路径 → `fs/cp(from, to)`，成功刷新列表，失败 Snackbar。
- **前端 API**：`frontend/src/lib/fs-api.ts` 新增 `deletePath(path)`、`movePath(from, to)`、`copyPath(from, to)`。

### 2.3 MCP Tools

- **fs_rm**：参数 `path`（必填）。行为与 REST 一致，权限 `hasFileWrite(auth)`。成功返回 `{ "path" }` 等简要信息。
- **fs_mv**：参数 `from`、`to`（必填）。同上。
- **fs_cp**：参数 `from`、`to`（必填）。同上。
- 路径规范：与现有 `fs_ls`/`fs_read` 一致，由 handler 规范化前后缀 `/`。

---

## 3. Branch 完成（MCP）

- **Tool 名**：`branch_complete`。
- **语义**：与 REST `POST .../branches/:branchId/complete` 一致；仅 Worker 可调。
- **参数**：无（当前 branch 从 `auth.branchId` 取）。
- **权限**：`auth.type === "worker"`；否则返回错误。
- **行为**：复用 branches controller 的 complete 逻辑；成功返回 `{ "branchId", "merged" }` 等；冲突等映射为 MCP 错误。
- **tools/list**：在 `MCP_TOOLS` 中注册。

---

## 4. Usage & GC（GUI）

- **放置**：Settings 页，新增「存储」子 Tab 或同页「存储」区块（与 Delegates 并列）。
- **Usage**：`GET /api/realm/:realmId/usage`，展示 `nodeCount`、`totalBytes`（如「节点数：xxx」「已用：xxx MB」）。进入 Settings 时请求；可选「刷新」按钮。
- **运行 GC**：按钮「运行 GC」→ 确认对话框 → `POST .../gc`（body 可为 `{}`，后端默认 cutOffTime）。成功 Snackbar + 可选刷新 usage；失败 Snackbar。
- **权限**：首版仅 User 登录时展示并可用（Delegate 可不显示或显示「仅主账号可用」）。

---

## 5. 参考

- API： [2026-03-01-server-next-api-design.md](./2026-03-01-server-next-api-design.md)
- 前端设计： [2026-03-02-frontend-design.md](./2026-03-02-frontend-design.md)
- 后端 realm 控制器：`apps/server-next/backend/controllers/realm.ts`（usage 返回 nodeCount、totalBytes；gc 接受 cutOffTime）
