# server-next 前端设计（CASFA Next）

**日期**：2026-03-02  
**状态**：已确认  
**依据**：[需求与用例 2026-03-01](./2026-03-01-requirements-use-cases.md)、[工程框架设计 2026-03-02](./2026-03-02-casfa-next-engineering-design.md)、旧版 `apps/server` 前端 UI 风格

---

## 1. 目标与约束

- **目标**：为 User 提供 Web UI，覆盖文件访问（U-F1～F7）、Branch 管理（U-B1～B3）、Delegate 管理（U-D1～D3）；风格延续旧版 server 前端，不先提取 explorer 为独立 package。
- **约束**：前端位于 `apps/server-next/frontend/`，与后端同栈部署；API 与类型与 `shared/` 对齐；首版仅考虑 User 场景（Delegate/Worker 通过 API/MCP 使用，不在此 UI 范围）。

---

## 2. 信息架构与路由

### 2.1 主导航

- **仅一栏**：整站主内容为 **Explorer**（文件/目录树），无其他顶级 Tab。
- **无顶部 Tab 切换**：不出现「Explorer | Delegates」这类 Tab，与旧版两栏导航区分。

### 2.2 入口结构

| 入口 | 说明 |
|------|------|
| **Explorer** | 默认页 `/`，展示 Realm 当前根的目录树；当前路径存在 Branch 时，可在 Explorer 内切换/查看/创建/撤销 Branch。 |
| **Profile 下拉** | AppBar 右侧：用户标识、复制 userId、**Settings**、登出。 |
| **Settings** | 由 Profile 下拉进入，独立页面（如 `/settings`）；内含子 Tab：**Delegates**（Delegate 列表、创建、撤销、Token 展示）。可预留其他子 Tab（如 Account/General），首版可仅 Delegates。 |

### 2.3 路由约定

```
/                     → Explorer（目录树，可选 branch 切换）
/settings             → Settings 页（默认子 Tab：Delegates）
/settings/delegates   → 同上，显式指定 Delegates 子 Tab（可选）
/login                → 登录
/oauth/callback       → OAuth 回调
/oauth/authorize      → OAuth 授权（若需）
*                     → 重定向至 /
```

（若后续增加 Branches 子 Tab 在 Settings 下，可为 `/settings/branches`；当前 Branch 管理在 Explorer 内，不占 Settings 路由。）

---

## 3. 技术选型

- **框架**：React 18+，React Router v6。
- **UI 库**：MUI (Material UI) v5+，与旧版 server 一致，便于复用主题与组件风格。
- **状态**：本地状态（useState/useReducer）+ 少量全局（如 auth、可选 client 缓存）；无需首版上 Redux。
- **构建**：Vite，输出至 `frontend/dist`，由 Serverless 部署脚本上传至 S3。
- **与后端协作**：通过 `shared/` 的 API 类型与路径约定调用后端；认证使用 OAuth/Cognito（与工程框架设计一致）。

---

## 4. 布局与 Shell

- **整体**：`flex column` 全屏，顶部 AppBar，主区 `flex:1 overflow hidden` 放子路由。
- **AppBar**：左侧 logo/「CASFA」标题；右侧 Profile 下拉（用户名/邮箱/userId、复制 userId、Settings、Sign out）；**无** NavTabs。
- **主题**：延续旧版 server 的 MUI 主题——浅色、zinc 系（如 primary #09090b、divider #e4e4e7）、轻阴影、卡片用 border、`borderRadius: 8`、`textTransform: "none"` 按钮。
- **AuthGuard**：未登录重定向至 `/login`；初始化/loading 时全屏居中 loading。

---

## 5. Explorer 页

### 5.1 主内容

- **目录树**：展示 Realm 当前根下的文件与文件夹；路径即当前浏览路径；支持展开/收起、点击进入目录、面包屑或路径栏（二选一或并存）。
- **操作**：列表/树项上提供文件操作入口（与 U-F1～F7 对应）：列表、下载、上传、详情、整理（重命名/移动/复制/删除/新建文件夹）、空间用量、GC。首版可实现范围可在实施计划中分阶段（例如先列表+导航+下载，再上传+整理+用量+GC）。

### 5.2 Branch 在 Explorer 中的表现

- **数据**：根据后端 API，按「当前路径」或「Realm 下所有 Branch」获取 Branch 列表（由 API 设计决定：例如「当前路径下挂载的 Branch」或「Realm 下活跃 Branch 列表」）。
- **展示**：当**当前路径**存在其他 Branch 时，在 Explorer 内提供 **Branch 切换/列表** 控件（例如工具栏下拉「Branches at this path」或侧边面板），可切换「当前视图」到某一 Branch 在该路径下的内容，或显示「主树」与「Branch」的区分。
- **操作**：在同一上下文中支持 **创建 Branch**（当前路径 + mountPath、TTL）、**撤销 Branch**、**查看 Branch 列表**（U-B1～B3）；创建成功后如需展示 Branch token，可用对话框或 Snackbar 提示并支持复制。

（具体交互：工具栏 vs 侧边面板、主树与 Branch 视图的切换方式，可在实现时与 API 一起细化。）

---

## 6. Settings 页

- **进入**：Profile 下拉 → Settings，路由 `/settings`（及可选的 `/settings/delegates`）。
- **布局**：页面标题「Settings」，子 Tab 至少：**Delegates**。
- **Delegates 子 Tab**（对应 U-D1～D3）：
  - 列表：已授权 Delegate（client_id/名称、创建时间、过期等）；支持「显示已撤销」开关；行操作：查看详情、撤销。
  - 创建：按钮打开「增加 Delegate」对话框（OAuth 申请流程或用户主动创建限时 token，依后端能力二选一或都做）。
  - Token 展示：创建成功后展示 token（及过期时间），支持复制，与旧版 server 的 TokenDisplay 行为一致。
- **其他子 Tab**：可预留 Account/General，首版可不实现。

---

## 7. 认证与用户信息

- **登录**：登录页 `/login`，OAuth 流程与 Cognito 与工程框架一致；回调 `/oauth/callback`，授权页若需则 `/oauth/authorize`。
- **用户信息**：AuthGuard 初始化时解析/刷新 token，得到 userId、name、email 等用于 AppBar Profile 展示与复制 userId；登出清除本地状态并跳转登录。

---

## 8. 错误处理与加载

- **加载**：列表/树加载中显示统一 loading（如 CircularProgress）；Explorer 初次加载可整块 loading。
- **错误**：接口错误用 Snackbar 或 Alert 提示；AuthGuard 层未登录统一跳转登录；不泄露敏感信息。

---

## 9. 与旧版的差异小结

| 项目 | 旧版 (server) | 新版 (server-next) |
|------|----------------|--------------------|
| 主导航 | Explorer + Delegates 两栏 Tab | 仅 Explorer，无顶部 Tab |
| Delegate 管理 | 独立页 /delegates | Settings 下子 Tab /settings/delegates |
| Branch 管理 | 无 | Explorer 内，当前路径有 Branch 时可切换/创建/撤销 |
| 文件模型 | Depot 多仓库 | 单一 Realm 当前根 |
| Explorer 组件 | @casfa/explorer 包 | 本仓库内实现，不先拆包 |

---

## 10. 实施时可选分阶段

- **Phase A**：Shell（AppBar、Profile、Settings 入口）+ 登录 + Explorer 仅目录树（列表+导航+路径）+ Settings 壳与 Delegates 子 Tab（列表+创建+撤销+Token）。
- **Phase B**：Explorer 内 Branch 切换与创建/撤销/列表（U-B1～B3）+ 文件操作补全（上传、整理、详情、用量、GC）。
- **Phase C**：体验优化（面包屑、键盘快捷键、空状态、错误态等）。

以上分阶段仅建议，具体以实施计划为准。

---

**下一步**：确认本设计后，编写 `2026-03-02-frontend-impl.md` 实施计划（writing-plans）。
