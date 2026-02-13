# CASFA TODO

> 更新日期: 2026-02-13

当前已完成的核心功能：CAS 二进制格式编解码、B-Tree 节点结构、多存储后端（S3/FS/Memory）、Delegate Token 授权体系（Root/Child Delegate、AT/RT）、OAuth 登录、Realm 隔离、Depot 管理、文件系统操作 API、File Explorer 组件（`@casfa/explorer`）、后台异步同步（两层同步模型）、Redis 缓存层、Token 简化（消除 TokenRecord）、CLI 工具、Service Worker Client 架构（`@casfa/client-sw` + `@casfa/client-bridge`）。

以下是尚未完成的主要需求。

---

## 1. UI Delegate 管理

**优先级**: 高  
**涉及模块**: `apps/server/frontend`, `packages/explorer`

### 现状

后端 Delegate API 已实现（`POST /api/realm/{realmId}/delegates` 创建、`DELETE` 撤销等），但前端没有对应的管理界面。用户目前只能通过 CLI 或直接调 API 来管理 Delegate。

### 需求

- [ ] **Delegate 列表页面** — 展示当前 Realm 下所有 Delegate（ID、depth、权限摘要、创建时间、过期时间、状态）
- [ ] **创建 Delegate** — 表单 UI，支持配置：
  - 授权 Realm
  - Token 类型（re-delegation / access）
  - Depot 管理权限 (`canManageDepot`)
  - 上传权限 (`canUpload`)
  - 读权限 Scope（选择 depot + 路径）
  - 写配额 Quota
  - TTL / 过期时间
- [ ] **Delegate 详情** — 查看单个 Delegate 的完整权限配置、delegation chain（父→子层级）
- [ ] **撤销 Delegate** — 支持单个撤销和批量撤销，显示级联影响（子 Delegate 一并失效）
- [ ] **Token 展示** — 创建成功后一次性显示 RT/AT，支持复制，提示"离开后无法再次查看"
- [ ] **权限可视化** — 以树形或表格方式直观展示 Delegate 的 scope 和 quota

---

## 2. Usage 统计

**优先级**: 中  
**涉及模块**: `apps/server/backend`, `apps/server/frontend`

### 需求

- [ ] **后端数据采集**
  - [ ] 存储用量统计 — 每个 Realm / Depot 的节点数量、总大小
  - [ ] API 调用统计 — 按 Delegate 维度统计请求次数、流量
  - [ ] Quota 消耗跟踪 — 已用 vs 配额上限
  - [ ] 时间序列存储 — 支持按天/周/月聚合
- [ ] **后端 API**
  - [ ] `GET /api/realm/{realmId}/usage` — Realm 级别用量
  - [ ] `GET /api/realm/{realmId}/delegates/{delegateId}/usage` — Delegate 级别用量
  - [ ] `GET /api/admin/usage` — 全局用量概览（Admin）
- [ ] **前端仪表盘**
  - [ ] Realm 存储用量概览（已用空间、节点数）
  - [ ] Delegate 维度的流量和请求统计
  - [ ] Quota 使用进度条
  - [ ] 用量趋势图表（折线图 / 柱状图）

---

## 3. GC（垃圾回收）

**优先级**: 高  
**涉及模块**: `apps/server/backend`, `packages/storage-s3`, `packages/storage-fs`

### 背景

CAS 系统中，节点是 content-addressed 且 immutable 的。当 Depot 指针更新后，旧的 root 引用链上可能存在不再被任何 Depot 引用的孤儿节点，需要 GC 回收存储空间。

### 需求

- [ ] **可达性分析**
  - [ ] 从所有活跃 Depot 的当前 root 出发，遍历引用图，标记所有可达节点
  - [ ] 对比 ownership 表，识别不可达的孤儿节点
- [ ] **GC 策略**
  - [ ] Mark-and-Sweep — 全量扫描，适合定期执行
  - [ ] 宽限期 — 新创建的节点在一定时间内（如 24h）不被回收，避免误删正在上传的数据
  - [ ] 引用计数（可选）— 在 put/claim 时维护引用计数，快速判断是否可回收
- [ ] **GC 执行**
  - [ ] 后台任务 / 定时触发（Lambda scheduled event 或 cron）
  - [ ] 支持 dry-run 模式（只报告可回收量，不实际删除）
  - [ ] 分批删除，避免长时间阻塞
  - [ ] GC 过程中的并发安全（正在进行的 put/flush 不受影响）
- [ ] **Ownership 清理**
  - [ ] 删除不可达节点对应的 DynamoDB ownership 记录
  - [ ] 清理 Redis 缓存中对应的 `own:*` 和 `node:meta:*` key
- [ ] **监控**
  - [ ] GC 执行日志（扫描节点数、回收节点数、回收空间大小）
  - [ ] Admin API 查看 GC 状态和历史
  - [ ] 告警机制（GC 失败或回收量异常）

---

## 4. Service Worker `/cas/` 路由覆盖

**优先级**: 中  
**涉及模块**: `apps/server/frontend/src/sw/`, `packages/client-sw`, `packages/client-bridge`

### 背景

已有 `@casfa/client-sw`（SW 内运行 CasfaClient）和 `@casfa/client-bridge`（主线程↔SW RPC 通信）的基础架构。需要在此基础上实现 Service Worker 对 `/cas/` 路径的 fetch 拦截，使浏览器可以像访问普通 URL 一样访问 CAS 内容。

### 需求

- [ ] **路由拦截**
  - [ ] SW 拦截 `/cas/{nodeHash}` 请求
  - [ ] 根据 nodeHash 从 CachedStorage（IndexedDB）或远端获取 CAS 节点
  - [ ] 对 file 节点返回 blob 内容，设置正确的 `Content-Type`
  - [ ] 对 dict 节点返回目录列表（JSON 或 HTML 索引页）
- [ ] **路径解析**
  - [ ] 支持 `/cas/{rootHash}/path/to/file` 形式的路径解析
  - [ ] 逐级遍历 B-Tree dict 节点，定位目标文件
  - [ ] 支持 `index.html` 自动回退（访问目录时）
- [ ] **缓存策略**
  - [ ] CAS 节点天然 immutable，命中 IndexedDB 缓存则直接返回
  - [ ] Cache-Control: immutable 响应头
  - [ ] 大文件流式返回（避免内存爆炸）
- [ ] **与现有 SW 集成**
  - [ ] 与 `SyncCoordinator`（后台同步）共存
  - [ ] 复用现有的 `CasfaClient` 单实例
- [ ] **应用场景**
  - [ ] `<img src="/cas/{hash}">` — 直接嵌入 CAS 图片
  - [ ] `<iframe src="/cas/{rootHash}/index.html">` — 嵌入 CAS 上托管的网页
  - [ ] 文件预览（PDF、视频等）直接使用浏览器原生能力

---

## 5. Admin 管理

**优先级**: 中  
**涉及模块**: `apps/server/backend`, `apps/server/frontend`

### 现状

后端已有基础 Admin API（`GET /api/admin/users`、`PATCH /api/admin/users/:userId`），但功能有限且前端没有管理界面。

### 需求

- [ ] **用户管理 UI**
  - [ ] 用户列表 — 显示所有用户（ID、角色、邮箱、创建时间）
  - [ ] 角色管理 — 修改用户角色（admin / authorized / suspended）
  - [ ] 用户详情 — 查看用户的 Realm、Delegate、用量信息
  - [ ] 用户搜索和筛选
- [ ] **Realm 管理**
  - [ ] 全局 Realm 列表 — 查看所有用户的 Realm
  - [ ] Realm 用量统计 — 每个 Realm 的存储占用、Depot 数量
  - [ ] Realm 配额设置 — 设定 per-user 的存储上限
- [ ] **系统监控**
  - [ ] 服务健康状态面板
  - [ ] 全局存储用量总览
  - [ ] 活跃 Delegate 数量
  - [ ] GC 状态和上次执行时间（依赖 GC 功能完成）
- [ ] **后端 API 扩展**
  - [ ] `GET /api/admin/realms` — 全局 Realm 列表
  - [ ] `GET /api/admin/stats` — 系统级统计
  - [ ] `POST /api/admin/gc` — 手动触发 GC
  - [ ] `DELETE /api/admin/users/:userId` — 删除用户（级联清理）

---

## 6. User Settings

**优先级**: 低  
**涉及模块**: `apps/server/frontend`, `apps/server/backend`

### 需求

- [ ] **个人资料**
  - [ ] 显示用户名、邮箱（来源于 OAuth Provider）
  - [ ] 头像设置（可选）
- [ ] **安全设置**
  - [ ] 查看活跃 Delegate 列表（关联 Delegate 管理）
  - [ ] 一键撤销所有 Delegate
  - [ ] 登录历史 / 会话管理
- [ ] **偏好设置**
  - [ ] Explorer 默认视图（list / grid）
  - [ ] 主题偏好（亮色 / 暗色 / 跟随系统）
  - [ ] 语言切换（中文 / English）
- [ ] **用量信息**
  - [ ] 个人存储用量概览
  - [ ] Quota 剩余情况
- [ ] **后端支持**
  - [ ] `GET /api/me` — 获取当前用户信息
  - [ ] `PATCH /api/me/settings` — 更新用户偏好设置
  - [ ] 用户设置存储（DynamoDB user 表扩展字段 或 独立 settings 表）

---

## 7. 前端界面美化

**优先级**: 低  
**涉及模块**: `apps/server/frontend`, `packages/explorer`

### 现状

前端目前有基础的登录页、OAuth 回调页、Explorer 文件浏览页面，使用 MUI 组件库，但整体 UI 较为粗糙。

### 需求

- [ ] **整体视觉**
  - [ ] 统一设计语言 — 定义颜色、字体、间距的 Design Token
  - [ ] 响应式布局 — 适配桌面和移动端
  - [ ] 暗色模式支持
  - [ ] 加载状态和骨架屏
- [ ] **登录页**
  - [ ] 品牌 Logo 和项目简介
  - [ ] OAuth 按钮样式优化
  - [ ] 登录中状态动画
- [ ] **导航和布局**
  - [ ] 侧边栏导航（Explorer / Delegates / Settings / Admin）
  - [ ] 面包屑导航
  - [ ] 顶部工具栏（用户头像、通知、快捷操作）
- [ ] **Explorer 美化**
  - [ ] 文件图标（按 content-type 显示不同图标）
  - [ ] 拖拽上传区域样式
  - [ ] 文件预览面板（侧栏 or 弹窗）
  - [ ] 操作成功 / 失败的 Toast 通知
  - [ ] 同步状态指示器（同步中 / 已同步 / 离线）
- [ ] **交互体验**
  - [ ] 键盘快捷键支持
  - [ ] 右键上下文菜单优化
  - [ ] 空状态引导（首次使用提示）
  - [ ] 错误页面和 404 页面

---

## 依赖关系

```
GC ──────────────────────────────────────┐
                                         ▼
Usage 统计 ◄────────────── Admin 管理（系统监控）
                                         │
Delegate 管理 UI ◄───────── User Settings（安全设置 → 查看 Delegate）
     │
     ▼
前端界面美化（侧边栏导航需要知道有哪些页面）
     ▲
     │
SW /cas/ 路由覆盖（Explorer 文件预览依赖 /cas/ 路由）
```

## 建议优先级排序

| 阶段 | 任务 | 理由 |
|------|------|------|
| **Phase 1** | Delegate 管理 UI、GC | 核心功能闭环，安全和存储健康 |
| **Phase 2** | SW `/cas/` 路由覆盖、Usage 统计 | 用户体验提升，运营数据支撑 |
| **Phase 3** | Admin 管理、User Settings | 管理和个性化 |
| **Phase 4** | 前端界面美化 | 整体打磨 |
