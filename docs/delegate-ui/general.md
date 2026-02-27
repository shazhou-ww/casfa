# UI Delegate 管理 — 需求理解与实现分析

> 基于对 CASFA 项目代码库的全面研究撰写

---

## 1. 项目背景

CASFA（Content-Addressable Storage for Agents）是一个基于内容寻址存储的 monorepo，核心能力包括 CAS 二进制编解码、B-Tree 节点结构、多存储后端、Delegate Token 授权体系等。

项目使用 **Bun** 作为包管理器和运行时，**React 19 + MUI 6 + Zustand 5** 构建前端，**Hono** 框架提供后端 API，存储层使用 DynamoDB + S3。

当前前端已有：登录页（OAuth）、文件浏览器（`@casfa/explorer`），但 **没有 Delegate 管理界面**。用户只能通过 CLI 或直接调 API 管理 Delegate。

---

## 2. Delegate 体系核心概念

### 2.1 什么是 Delegate

Delegate 是 CASFA 的一等授权实体。每个用户登录后自动获得一个 **Root Delegate**（depth=0），可以基于它创建 **Child Delegate**（depth=1~15），形成委托树。

Delegate 的核心用途：**将自己的部分权限委托给第三方**（如工具、Agent、协作者），同时保持对委托链的完全控制（可随时撤销）。

### 2.2 数据模型

> 来源：`packages/delegate/src/types.ts`

```typescript
interface Delegate {
  // 身份标识
  delegateId: string;        // UUID v7, dlt_CB32 格式
  name?: string;             // 可选的展示名称
  realm: string;             // 数据隔离域 = User ID

  // 层级结构
  parentId: string | null;   // null 仅限 root delegate
  chain: string[];           // 完整委托链 [root, ..., self]
  depth: number;             // 0=root, 最大 15

  // 权限
  canUpload: boolean;        // 能否上传新 CAS 节点
  canManageDepot: boolean;   // 能否管理 Depot（创建/删除/提交）
  delegatedDepots?: string[]; // 父级显式指定的可操作 Depot ID 列表

  // 作用域（互斥）
  scopeNodeHash?: string;    // 单作用域：一个 CAS 节点哈希
  scopeSetNodeId?: string;   // 多作用域：ScopeSetNode ID

  // 生命周期
  expiresAt?: number;        // 可选的过期时间（epoch ms）
  isRevoked: boolean;        // 是否已撤销
  revokedAt?: number;        // 撤销时间
  revokedBy?: string;        // 执行撤销的祖先 ID
  createdAt: number;         // 创建时间

  // Token 哈希（v3 简化版，不再有独立的 TokenRecord 表）
  currentRtHash: string;     // 当前 RT 的 Blake3-128 哈希
  currentAtHash: string;     // 当前 AT 的 Blake3-128 哈希
  atExpiresAt: number;       // AT 过期时间
}
```

### 2.3 委托链（Delegation Chain）

> 来源：`packages/delegate/src/chain.ts`

Chain 是从 root 到 self 的有序 delegateId 数组：

```
Root:        chain = [rootId]                        depth=0
Child:       chain = [rootId, childId]               depth=1
Grandchild:  chain = [rootId, childId, grandchildId] depth=2
```

**关键约束**：`chain.length = depth + 1`，最大 depth = 15。

任何祖先都可以撤销其后代 Delegate，撤销会 **级联到所有子孙**。

### 2.4 Token 机制

> 来源：`packages/delegate-token/`, `apps/server/backend/src/util/delegate-token-utils.ts`

每个 Child Delegate 拥有一对 Token：

| Token | 长度 | 结构 | 用途 |
|-------|------|------|------|
| **Access Token (AT)** | 32 字节 | `[delegateId 16B][expiresAt 8B LE][nonce 8B]` | 调用 API，短期有效（默认 1 小时） |
| **Refresh Token (RT)** | 24 字节 | `[delegateId 16B][nonce 8B]` | 刷新 AT+RT，长期有效 |

- Token 以 base64 编码传输（`Authorization: Bearer {base64}`）
- RT 一次性使用，每次 refresh 都会轮转
- Token 哈希直接存储在 Delegate 实体上（Blake3-128），不存在独立的 TokenRecord

**Root Delegate 特殊**：使用 JWT 认证（来自 OAuth 登录），不需要 RT/AT 机制。

### 2.5 权限模型

> 来源：`packages/delegate/src/validation.ts`

创建 Child Delegate 时的校验规则：

1. **权限不可升级**：`child.canUpload ≤ parent.canUpload`，`child.canManageDepot ≤ parent.canManageDepot`
2. **深度限制**：`child.depth = parent.depth + 1 ≤ 15`
3. **过期时间约束**：若 parent 有过期时间，child 也必须设，且 `child.expiresAt ≤ parent.expiresAt`
4. **Depot 范围约束**：child 的 `delegatedDepots` 必须是 parent 可管理 Depot 的子集
5. **Scope 约束**：child 的作用域通过相对路径（如 `"."`, `"0:1:2"`）从 parent scope 派生

### 2.6 Scope（作用域）

> 来源：`apps/server/backend/src/util/scope.ts`

Scope 定义了 Delegate 能访问哪些 CAS 节点：

- **单 Scope**：`scopeNodeHash` — 直接指向一个 CAS 节点
- **多 Scope**：`scopeSetNodeId` — 指向一个 ScopeSetNode（包含多个子哈希，引用计数管理）

创建 child 时通过相对索引路径指定 scope：
- `"."` → 继承 parent 的所有 scope roots
- `"0:1:2"` → 从 parent scope root[0] 出发，按 B-Tree 索引逐级深入

### 2.7 Realm 与 Depot

- **Realm** = User ID（`usr_` 格式），是数据隔离的基本单位
- **Depot** = 一个文件系统根（类似 Git 仓库），有 `depotId`、`name`、`root`（当前根哈希）、`history`
- Delegate 通过 `delegatedDepots` 限定能操作哪些 Depot

---

## 3. 已有基础设施

### 3.1 后端 API（已完成）

> 来源：`apps/server/backend/src/controllers/delegates.ts`, `router.ts`

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | `/api/realm/{realmId}/delegates` | 创建 child delegate，返回 delegate 信息 + RT + AT |
| GET | `/api/realm/{realmId}/delegates` | 列出当前 delegate 的直接子级（支持分页、过滤已撤销） |
| GET | `/api/realm/{realmId}/delegates/:delegateId` | 获取 delegate 详情（需要是其祖先） |
| POST | `/api/realm/{realmId}/delegates/:delegateId/revoke` | 撤销 delegate（级联撤销所有后代） |

**注意事项**：
- `list` 只返回**直接子级**（通过 DynamoDB GSI2 `PARENT#{parentId}` 查询），不递归
- `get` 会校验调用者是否在目标 delegate 的 chain 中（祖先验证）
- `revoke` 会递归撤销所有后代（`revokeDescendants` 递归遍历子级）

### 3.2 客户端 API 方法（已完成）

> 来源：`packages/client/src/client/delegates.ts`

```typescript
type DelegateMethods = {
  create: (params: CreateDelegateRequest) => Promise<FetchResult<CreateDelegateResponse>>;
  list: (params?: ListDelegatesQuery) => Promise<FetchResult<ListDelegatesResponse>>;
  get: (delegateId: string) => Promise<FetchResult<DelegateDetail>>;
  revoke: (delegateId: string) => Promise<FetchResult<RevokeDelegateResponse>>;
  claimNode: (nodeKey: string, pop: boolean) => Promise<FetchResult<...>>; // 节点 claim（本需求不涉及）
};
```

通过 `AppClient` 单例获取，自动处理 AT 认证和刷新。

> **注意**：`lib/client.ts` 中 `getClient` / `resetClient` 已标记为 deprecated alias，新代码应统一使用 `getAppClient()` / `resetAppClient()`。

### 3.3 Protocol 类型定义（已完成）

> 来源：`packages/protocol/src/delegate.ts`

已定义完备的 Zod schema：
- `CreateDelegateRequestSchema` — 创建请求（name, canUpload, canManageDepot, delegatedDepots, scope, tokenTtlSeconds, expiresIn）
- `CreateDelegateResponseSchema` — 创建响应（delegate 信息 + refreshToken + accessToken + accessTokenExpiresAt）
- `DelegateDetailSchema` — 详情（含 chain, scope, revocation 信息）
- `DelegateListItemSchema` — 列表项（精简字段）
- `ListDelegatesQuerySchema` — 查询参数（limit, cursor, includeRevoked）
- `RevokeDelegateResponseSchema` — 撤销响应

### 3.4 前端现状

> 来源：`apps/server/frontend/src/`

| 文件 | 说明 |
|------|------|
| `app.tsx` | 路由定义：`/login`, `/oauth/callback`, `/`（Explorer）, `/depot/:depotId` |
| `components/layout.tsx` | 顶部 AppBar（标题、用户菜单、登出），主内容区用 `<Outlet />` |
| `components/auth-guard.tsx` | 认证守卫 |
| `lib/client.ts` | AppClient 单例工厂（包装 CasfaClient + 同步管理） |
| `stores/auth-store.ts` | Zustand auth 状态（user 信息、login/logout） |
| `pages/explorer-page.tsx` | 文件浏览器页面（薄包装层，渲染 `<CasfaExplorer />`） |

**目前没有任何 Delegate 相关的 UI 组件。**

---

## 4. 需求分析

根据 `docs/TODO.md`，UI Delegate 管理需要实现以下功能：

### 4.1 Delegate 列表页面

展示当前 Realm 下所有 Delegate。

**可用数据**（来自 `DelegateListItem`）：
- `delegateId` — ID
- `name` — 展示名称（可选）
- `depth` — 层级深度
- `canUpload` / `canManageDepot` — 权限摘要
- `createdAt` — 创建时间
- `expiresAt` — 过期时间（可选）
- `isRevoked` — 是否已撤销

**技术要点**：
- 当前 `list` API 只返回调用者的直接子级，要展示"所有 Delegate"需要递归获取（前端 BFS/DFS）或后端新增扁平化列表 API
- 支持分页（`cursor` 参数）
- 支持过滤已撤销的 Delegate（`includeRevoked` 参数）
- Root Delegate 用 JWT 认证，其直接子级是 depth=1 的 Delegate

### 4.2 创建 Delegate

表单 UI，对应 `CreateDelegateRequest`：

| 字段 | 类型 | UI 组件建议 |
|------|------|-------------|
| `name` | string (1-64) | 文本输入框 |
| `canUpload` | boolean | 开关/复选框 |
| `canManageDepot` | boolean | 开关/复选框 |
| `delegatedDepots` | string[] | Depot 多选器（需先获取可用 Depot 列表） |
| `scope` | string[] | Scope 选择器（相对路径，较复杂） |
| `tokenTtlSeconds` | number | 数字输入 + 预设选项（1h/6h/24h/7d/30d） |
| `expiresIn` | number | 日期时间选择器 或 持续时间输入 |

**技术要点**：
- 权限选项需受当前 delegate 权限限制（如 parent canUpload=false 则 child 不可设 true）
- Depot 列表需从 depots API 获取
- Scope 选择器是最复杂的部分 — 需要理解相对索引路径，可能需要树形浏览器让用户选择节点
- 过期时间需要校验不超过 parent 的 expiresAt

### 4.3 Delegate 详情

查看单个 Delegate 的完整信息。

**可用数据**（来自 `DelegateDetail`）：
- 基础信息：delegateId, name, realm, depth, createdAt
- 权限：canUpload, canManageDepot, delegatedDepots
- 层级：parentId, chain（完整委托链）
- 作用域：scopeNodeHash 或 scopeSetNodeId
- 状态：expiresAt, isRevoked, revokedAt, revokedBy

**Delegation Chain 可视化**：展示从 root 到当前 delegate 的完整路径，每个节点显示名称/ID 和 depth。

### 4.4 撤销 Delegate

- 单个撤销：调用 `POST /revoke`
- 批量撤销：前端循环调用（后端目前没有批量撤销 API）
- **级联影响提示**：撤销一个 delegate 会递归撤销其所有后代。UI 需要在确认对话框中展示将受影响的子 delegate 数量

### 4.5 Token 展示

创建成功后一次性显示 RT 和 AT：
- `refreshToken`（base64 编码）
- `accessToken`（base64 编码）
- `accessTokenExpiresAt`

**关键 UX**：
- 只在创建成功后展示一次，之后无法再次获取
- 提供"复制"按钮
- 醒目的警告提示："离开此页面后将无法再次查看这些 Token"
- 考虑以 `code` 样式展示，支持一键复制整段

### 4.6 权限可视化

以树形或表格方式直观展示 Delegate 的 scope 和 quota：
- 布尔权限以图标/标签形式展示
- Depot 列表以 chip/tag 形式展示
- Scope 以树形结构展示（如果可行）
- 委托链以面包屑或流程图形式展示

---

## 5. 关键技术考量

### 5.1 列表层级问题

**核心问题**：后端 `list` API 设计为只返回直接子级（通过 GSI2 parent-index 查询），不支持递归获取所有后代。

**方案选择**：

| 方案 | 优点 | 缺点 |
|------|------|------|
| **A. 前端递归获取** | 无需改后端 | 请求数多，多层级时性能差 |
| **B. 后端新增扁平列表 API** | 一次获取全部，高效 | 需要后端改动（GSI1 realm-index 已可支持） |
| **C. 树形懒加载** | 按需获取，交互自然 | 实现复杂度较高，但契合委托树的层级结构 |

**推荐方案 C**：树形展示最贴合 Delegate 的层级概念，懒加载减少初始请求，展开节点时用 `list` API 获取子级即可。

### 5.2 Scope 选择器

Scope 使用相对索引路径（如 `"."`, `"0:1:2"`），对用户不友好。需要一个抽象层：

- 在创建表单中提供简化选项：
  - "继承全部权限"（对应 scope = `["."]`）
  - "选择特定 Depot/路径"（需要 Depot 选择器 + 路径浏览器）
- 详情页中将 `scopeNodeHash` / `scopeSetNodeId` 解析为可读的路径展示

**初期可简化**：只支持 "继承全部"（`"."`），高级 scope 配置作为后续优化。

### 5.3 Root Delegate 的特殊性

- Root Delegate 使用 JWT 认证，不显示在 delegate 列表中（depth=0，是系统自动创建的）
- 前端操作 delegate API 时用的是 Root Delegate 的身份（JWT → Root Delegate → 调用 delegate API）
- 列表中展示的是 depth≥1 的 child delegates

### 5.4 Token 安全

- RT 和 AT 只在创建时返回，之后无法从服务器获取
- 前端需要在创建成功后立即展示，且不应将 token 存入持久化存储（如 localStorage）
- token 展示组件应支持一键复制，并在用户离开页面前给出提醒

### 5.5 已撤销 Delegate 的展示

- 默认列表不包含已撤销的 Delegate（`includeRevoked=false`）
- 提供切换开关让用户选择是否显示已撤销的
- 已撤销的 Delegate 用不同的视觉样式区分（如灰色、删除线、标签）

---

## 6. 前端集成点

### 6.1 需要新增/修改的文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `frontend/src/app.tsx` | 修改 | 新增 `/delegates` 路由 |
| `frontend/src/components/layout.tsx` | 修改 | 顶栏添加导航入口（或未来添加侧边栏） |
| `frontend/src/pages/delegates-page.tsx` | 新增 | Delegate 管理主页面 |
| `frontend/src/components/delegates/` | 新增 | Delegate 相关组件目录 |

### 6.2 可复用的模式

从现有代码中可参考的模式：

- **API 调用**：通过 `getAppClient()` 获取 `AppClient` 单例，调用 `client.delegates.create/list/get/revoke`（`lib/client.ts`）
- **状态管理**：参考 `@casfa/explorer` 的 Zustand store 模式
- **UI 组件**：MUI 6 组件库（Dialog, Table, Card, Chip, IconButton 等）
- **Auth 信息**：通过 `useAuthStore()` 获取当前用户信息（`stores/auth-store.ts`）

### 6.3 外部依赖

前端已有的依赖足以支持此需求，无需引入新库：

- **MUI 6**：表格（DataGrid 或 Table）、表单控件、Dialog、Chip、Breadcrumbs
- **React Router 7**：路由、参数传递
- **Zustand 5**：状态管理（如 delegate 列表缓存）
- **date-fns** 或手动格式化：时间显示（需确认项目是否已有日期工具库）

---

## 7. 与其他 TODO 的依赖关系

```
Delegate 管理 UI（本需求）
    │
    ├──► User Settings（安全设置模块需要展示活跃 Delegate 列表、一键撤销）
    │
    └──► 前端界面美化（侧边栏导航需要知道有 Delegates 页面）
```

本需求是 Phase 1 的核心任务之一，优先级高，且是其他前端功能的基础。

---

## 8. 总结

**已就绪**：
- 后端 4 个 Delegate API（创建、列表、详情、撤销）
- 客户端封装（`client.delegates.*`）
- 完备的 TypeScript 类型和 Zod schema

**需要实现**：
- 前端路由和页面结构
- Delegate 列表（树形或表格）
- 创建表单（含权限配置、Depot 选择、Scope、TTL）
- 详情视图（含 chain 可视化）
- 撤销交互（含级联影响提示）
- Token 一次性展示组件
- 权限可视化

**最大挑战**：
1. Scope 选择器的用户体验设计（相对索引路径对用户不直观）
2. 层级列表的数据获取策略（当前 API 只返回直接子级）
3. Token 安全展示（一次性、不可恢复）

---

## 9. 深入研究补充

### 9.1 AppClient 使用模式

前端通过 `getAppClient()` 获取单例，参考 `explorer-page.tsx` 的模式：
- 异步初始化：`useState` + `useEffect` + `getAppClient().then(setAppClient)`
- 事件订阅：返回取消函数，在 `useEffect` cleanup 中调用
- 认证：AppClient 内部自动处理 JWT → AT 的转换和刷新

### 9.2 后端数据库层关键限制

- `listChildren(parentId)` 使用 GSI2 (parent-index) 查询，**只返回直接子级**
- `getRootByRealm(realm)` 使用 GSI1 (realm-index) 但只过滤 depth=0
- **不存在** "列出 Realm 下全部 Delegate" 的方法，虽然 GSI1 理论上可支持
- 分页使用 DynamoDB `ExclusiveStartKey`，base64 编码后作为 cursor 返回

### 9.3 Depot 列表获取

创建 Delegate 表单中的 Depot 选择器需要 Depot 列表：
- `client.depots.list({ limit: 100 })` 返回 `{ depots: DepotListItem[], nextCursor?: string }`
- `DepotListItem` 包含 `depotId`, `name`, `root`, `createdAt`, `updatedAt`

### 9.4 MUI 主题

> ⚠️ 2026-02-24 更新：主题已于方案编写当日（2026-02-14）大幅重设计

项目使用自定义主题（定义在 `frontend/src/main.tsx`），核心设计语言：

| 属性 | 值 | 说明 |
|------|-----|------|
| `primary.main` | `#09090b` | 近黑色，非蓝色 |
| `secondary.main` | `#71717a` | 中灰色 |
| `text.primary` | `#09090b` | 深色文字 |
| `text.secondary` | `#71717a` | 次要文字 |
| `divider` | `#e4e4e7` | 分割线 |
| `background.default` | `#ffffff` | 白色背景 |
| AppBar | 背景 `#fafafa`，文字 `#09090b`，底部 `1px solid #e4e4e7` | **浅色顶栏** |
| Card | `elevation: 0`，`border: 1px solid #e4e4e7` | 用 border 替代阴影 |
| Button | `disableElevation: true`，`textTransform: "none"` | 全局默认 |
| shadows | 大部分为 `none`，仅 3/8/16/24 有值 | 极简阴影 |
| `shape.borderRadius` | `8` | 圆角 8px |
| `typography.fontFamily` | `system-ui, -apple-system, ...` | 系统字体栈 |

**新组件设计原则**：
- 优先用 `border: 1px solid divider` 而非阴影来区分层级
- 按钮无需手动设 `textTransform: "none"`（已是全局默认）
- AppBar 是浅色的，导航按钮应使用深色文字，active 状态用 `fontWeight` 或 `borderBottom` 区分（**不要用 opacity**）

### 9.5 项目无日期库

前端没有 `date-fns` 或 `dayjs`，使用 `Intl.DateTimeFormat` 进行时间格式化。

### 9.6 auth-store 中已有 rootDelegateId

`auth-store.ts` 的 `UserInfo` 类型包含 `rootDelegateId?: string | null`，可在 Delegate 列表/详情中使用此信息标注 root delegate 身份，无需额外请求。

---

## 10. 实施计划

详细实施计划已拆分为 6 个步骤，见同目录下的 `step[1-6].md`。进度追踪见 `progress.md`。

| Step | 内容 | 关键交付物 |
|------|------|-----------|
| 1 | 基础骨架 | 路由、页面、导航、Store 定义 |
| 2 | Delegate 列表 | 表格、分页、过滤、空状态 |
| 3 | 创建 Delegate | 表单对话框 + Token 一次性展示 |
| 4 | Delegate 详情 | 信息展示 + Chain 可视化 |
| 5 | 撤销 Delegate | 确认对话框 + 级联影响提示 |
| 6 | UI 完善 | 权限可视化、状态指示、交互打磨 |
