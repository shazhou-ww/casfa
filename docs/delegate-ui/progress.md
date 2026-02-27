# UI Delegate 管理 — 实施进度

根据总纲：[general](./general.md)，帮我执行任务
任务的每个步骤都在此同文件夹中的 step[n].md 有详细的说明。


整体进度如下

| Step | 名称 | 状态 | 说明 |
|------|------|------|------|
| 1 | 基础骨架 — 路由、页面、导航、Store | ✅ 已完成 | 搭建基础框架 |
| 2 | Delegate 列表 — 表格、分页、过滤 | ✅ 已完成 | 核心列表功能 |
| 3 | 创建 Delegate — 表单 + Token 展示 | ✅ 已完成 | 创建流程 + Token 安全展示 |
| 4 | Delegate 详情 — 信息展示 + Chain 可视化 | ✅ 已完成 | 详情页面 |
| 5 | 撤销 Delegate — 确认 + 级联提示 | ✅ 已完成 | 撤销交互 |
| 6 | UI 完善 — 权限可视化、状态指示、打磨 | ✅ 已完成 | 整体完善 |

**状态说明**：⬜ 待开始 / 🔵 进行中 / ✅ 已完成 / ⏸️ 暂停 / ❌ 已取消

根据执行进度，合理安排，并开始任务，执行过程的进度及总结等记录到下方:
- **注意：每次只执行一个 Step，完成后暂定，既不要着急执行下一个 Step，也不要自行提交，需要我review和确认**
- **注意：如果你认为某个 Step 过于复杂，请及时与我商量，我们可以讨论进一步拆分和细化**
- **注意：每个 Step 执行完成后，请务review 一下对应的 step[n].md 确保都执行到位了**


## 涉及文件清单

### 新增文件
- [ ] `apps/server/frontend/src/pages/delegates-page.tsx`
- [ ] `apps/server/frontend/src/stores/delegates-store.ts`
- [ ] `apps/server/frontend/src/components/delegates/delegate-list.tsx`
- [ ] `apps/server/frontend/src/components/delegates/create-delegate-dialog.tsx`
- [ ] `apps/server/frontend/src/components/delegates/token-display.tsx`
- [ ] `apps/server/frontend/src/components/delegates/delegate-detail.tsx`
- [ ] `apps/server/frontend/src/components/delegates/revoke-dialog.tsx`

### 修改文件
- [ ] `apps/server/frontend/src/app.tsx` — 新增路由
- [ ] `apps/server/frontend/src/components/layout.tsx` — 导航入口

---

## 分步记录

### Step 1: 基础骨架

**状态**: ✅ 已完成

- 开始时间：2026-02-24
- 完成时间：2026-02-24
- 执行情况：
  - 新增路由：`/delegates` 和 `/delegates/:delegateId`（app.tsx）
  - Layout 导航：AppBar 中添加 Explorer / Delegates 按钮，fontWeight + borderBottom 指示激活态
  - 页面骨架：`delegates-page.tsx`（Box + Typography）
  - Store 骨架：`delegates-store.ts`（类型定义 + 初始状态 + placeholder actions）
  - 组件目录：`components/delegates/` 下 5 个占位文件
  - `bun run typecheck` 全部通过
- 遇到的问题：无
- 备注：导航按钮的 `flexGrow: 1` 从 Typography 移到了导航 Box 上，保持右侧用户菜单靠右

---

### Step 2: Delegate 列表

**状态**: ✅ 已完成

- 开始时间：2026-02-24
- 完成时间：2026-02-24
- 执行情况：
  - Store 数据获取：实现 `fetchDelegates`（首页）和 `fetchMore`（追加加载），调用 `client.delegates.list()` 并处理 ok/error
  - 列表组件 `delegate-list.tsx`：MUI Table，6 列（Name、Depth、Permissions、Created、Expires、Status）
  - 工具栏：标题 + "Show revoked" Switch + "Create Delegate" 按钮
  - 分页：cursor-based "Load More" 按钮，有 nextCursor 时显示
  - 空状态：KeyIcon + 引导文案 + 创建按钮
  - 加载态：居中 CircularProgress
  - 错误态：Alert severity="error"
  - 状态标签：Active（绿色）、Revoked（灰色 + 行半透明+删除线）、Expired（橙色）
  - 权限图标：CloudUpload + Storage + Tooltip，有权限正常色/无权限灰色
  - 时间格式化：`Intl.DateTimeFormat`（绝对时间）+ 相对到期提示（hover 显示绝对时间）
  - 行点击导航到 `/delegates/:delegateId`
  - DelegatesPage 整合：根据 URL 参数切换列表/详情视图
  - `bun run typecheck` 全部通过
- 遇到的问题：无
- 备注："Create Delegate" 按钮 onClick 为空（Step 3 实现对话框）；详情视图为占位文本（Step 4 实现）

---

### Step 3: 创建 Delegate

**状态**: ✅ 已完成

- 开始时间：2026-02-24
- 完成时间：2026-02-24
- 执行情况：
  - 创建对话框 `create-delegate-dialog.tsx`：完整表单（name、canUpload/canManageDepot Switch、Depot Autocomplete 多选、Scope 固定继承、Token TTL Select、Delegate 有效期 Switch+数值+单位）
  - Depot 选择器：仅 canManageDepot=true 时展示，`client.depots.list()` 获取列表，Autocomplete 多选 + Chip 标签，注意 DepotListItem 字段为 `title`（非 `name`）
  - Token TTL vs Delegate 有效期合理性提示：当 tokenTtl > expiresInSeconds 时显示 warning caption
  - 表单提交：调用 `client.delegates.create()`，loading 状态 + 错误展示
  - 表单关闭时自动重置所有字段
  - Token 展示组件 `token-display.tsx`：Alert warning + monospace TextField（只读）+ 复制按钮（Check 图标确认）+ AT 过期时间 + 双击关闭确认
  - 页面整合 `delegates-page.tsx`：管理 createOpen + tokenData 状态，`onCreated` 回调关闭创建对话框 → 打开 Token 展示 → 刷新列表
  - 列表组件 `delegate-list.tsx`：新增 `onCreateClick` prop，Create 按钮和空状态按钮均连接
  - `bun run typecheck` 全部通过
- 遇到的问题：无
- 备注：DepotListItem 使用 `title` 字段（非 step3.md 示例中的 `name`），已在 getOptionLabel 和 renderTags 中修正

---

### Step 4: Delegate 详情

**状态**: ✅ 已完成

- 开始时间：2026-02-24
- 完成时间：2026-02-24
- 执行情况：
  - 详情组件 `delegate-detail.tsx`：通过 `client.delegates.get(delegateId)` 获取数据，含加载/错误状态处理
  - 返回导航：ArrowBack IconButton → `/delegates`
  - 页面标题：delegate name 或截断 ID + Revoked Chip（如已撤销）
  - 基础信息卡片：ID（monospace + CopyButton）、Name、Realm、Depth、Created、Status（Chip）、Expires（绝对时间 + 相对剩余）
  - 权限卡片：Upload Nodes（CloudUpload 图标 + Allowed/Not allowed）、Manage Depots（Storage 图标）、Delegated Depots（Chip 列表）、Scope（scopeNodeHash / scopeSetNodeId / 无限制）
  - Delegation Chain 可视化：Breadcrumbs + Chip，Root 标注（结合 auth-store rootDelegateId）、Current filled 高亮、中间节点可点击跳转详情
  - 撤销信息卡片：仅 isRevoked=true 时显示 revokedAt + revokedBy
  - 子 Delegate 提示：文字引导使用 CLI/API
  - 操作按钮：Revoke（outlined error，通过 onRevokeClick prop 连接 Step 5）+ Copy ID
  - DelegatesPage 整合：替换占位文本为 `<DelegateDetail>`，新增 revokeDialogOpen 状态为 Step 5 预留
  - `bun run typecheck` 全部通过
- 遇到的问题：无
- 备注：Revoke 按钮的 onClick 通过 `onRevokeClick` prop 传入，revokeDialogOpen 状态在 DelegatesPage 中管理（Step 5 会连接 RevokeDialog）

---

### Step 5: 撤销 Delegate

**状态**: ✅ 已完成

- 开始时间：2026-02-24
- 完成时间：2026-02-24
- 执行情况：
  - 撤销确认对话框 `revoke-dialog.tsx`：Warning Alert（级联影响提示）、Delegate name/ID 展示、Revoke 按钮（loading + disabled 状态）、错误展示
  - 列表页操作列 `delegate-list.tsx`：新增 Actions 列，每行含 Revoke IconButton（仅活跃时显示）+ View details IconButton，`e.stopPropagation()` 阻止行点击导航
  - 页面整合 `delegates-page.tsx`：`revokeTarget` 状态管理（替换原 `revokeDialogOpen` boolean），列表和详情页共用 `RevokeDelegateDialog`，撤销成功后 `fetchDelegates()` 刷新列表
  - 批量撤销：按计划初版不实现
  - `bun run typecheck` 全部通过
- 遇到的问题：无
- 备注：详情页撤销时 depth 设为 0（因 URL 参数只有 delegateId，detail 数据在子组件内部获取），不影响对话框显示

---

### Step 6: UI 完善

**状态**: ✅ 已完成

- 开始时间：2026-02-24
- 完成时间：2026-02-24
- 执行情况：
  - **6.1 权限可视化增强**：
    - 列表：Permissions 列从图标改为 Chip 组合（canUpload → `Upload` primary Chip，canManageDepot → `Depot` secondary Chip，两者都无 → `Read only` Chip）
    - 详情：Upload/Manage Depots 用 `Allowed`(success) / `Denied`(default) Chip 替代纯文字
    - 详情：Delegated Depots 截断 ID（前16字符+`…`）+ Storage 图标 + Tooltip 完整 ID + click-to-copy
  - **6.2 状态指示**：列表行透明度 `opacity: status === "active" ? 1 : 0.6`（expired 也降低透明度），`textDecoration` 仅 revoked 时 line-through
  - **6.3 Scope 展示**：结构化展示 — 无限制 → "No scope restriction (full access)"（text.secondary），scopeNodeHash → "Single scope" + monospace Chip（截断24字符 + Tooltip + click-to-copy），scopeSetNodeId → "Multi-scope set" + 同样处理
  - **6.4 Snackbar 统一通知**：DelegatesPage 层新增 `<Snackbar>` + `<Alert>`（autoHideDuration=4000），创建成功/撤销成功/Copy ID/Depot ID copy 等场景触发
  - **6.5 ID 复制**：详情页 Copy ID 按钮 + Delegated Depots Chip + Scope Chip 均通过 `onNotify` prop 触发 Snackbar 通知
  - **6.6 响应式**：列表 Created 列在小屏幕隐藏（`xs: "none", md: "table-cell"`）
  - **6.7 键盘导航**：TableRow 添加 `tabIndex={0}` + `onKeyDown` Enter 跳转详情
  - `bun run typecheck` 全部通过
- 遇到的问题：无
- 备注：详情页权限展示保留了现有 InfoRow 布局（而非 step6.md 示例的独立 Table），与整体详情页风格更一致

---

## 技术决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| 列表模式 | 扁平表格（直接子级） | 初版简化，API 只返回直接子级，避免递归获取的复杂度 |
| Scope 选择 | 仅支持 "继承全部"（`"."`） | 相对索引路径对用户不直观，初版简化 |
| 日期格式化 | `Intl.DateTimeFormat` | 项目无日期库，用浏览器原生 API 避免引入新依赖 |
| 状态管理 | Zustand store | 与项目现有模式一致（auth-store, explorer-store） |
| UI 组件 | MUI 6 Table/Dialog/Form | 项目已有依赖，不引入 DataGrid 等额外包 |
| 批量撤销 | 初版不实现 | 后端无批量 API，前端串行调用体验差，后续优化 |
| 子级递归展示 | 初版不实现 | 需要 token 切换或后端新增 API，初版仅展示 depth=1 |

---

## 待解决问题

- [ ] 是否需要在后端新增 "列出 Realm 下所有 Delegate" API（使用 GSI1 realm-index）？
- [ ] Scope 选择器的 UX 设计（后续优化）
- [ ] 是否需要支持多层级树形展示？
- [ ] 批量撤销是否需要后端支持？

---

## 变更日志

| 日期 | 变更内容 |
|------|----------|
| 2026-02-14 | 初始化实施计划，创建 step1-6.md 和 progress.md |
| 2026-02-24 | Review & 方案优化：更新 MUI 主题描述（primary 已从蓝色改为近黑色，AppBar 浅色化）；Step 1 导航按钮 active 样式从 opacity 改为 fontWeight+borderBottom；Step 3 增加 tokenTtl vs expiresIn 合理性提示；Step 4 chain 可视化从 Stepper 改为 Breadcrumbs+Chip（更轻量）；补充 claimNode 方法、getAppClient 命名规范、rootDelegateId 可用性等信息 |
| 2026-02-24 | Step 2 完成：实现 Delegate 列表（Store 数据获取、MUI Table、工具栏、分页、空状态、状态/权限可视化） |
| 2026-02-24 | Step 3 完成：实现创建 Delegate 对话框（表单+提交）和 Token 一次性展示组件（复制+二次确认关闭），整合到 DelegatesPage |
| 2026-02-24 | Step 4 完成：实现 Delegate 详情页（基础信息、权限、Chain Breadcrumbs 可视化、撤销信息、操作按钮），整合到 DelegatesPage |
| 2026-02-24 | Step 5 完成：实现撤销确认对话框（Warning 级联提示 + API 调用），列表页新增 Actions 操作列（Revoke + View details），页面整合共用 RevokeDialog |
| 2026-02-24 | Step 6 完成：权限 Chip 可视化、expired 行透明度、Scope 结构化展示、Snackbar 统一通知、ID 截断+复制、响应式 Created 列隐藏、键盘导航 |
