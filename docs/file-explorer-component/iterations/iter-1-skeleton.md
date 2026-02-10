# Iteration 1 — 骨架 + 列表浏览

**主题**: 搭建包结构、实现 client `fs.*` 方法、core store、基础 List view、depot 选择器

**前置依赖**: 无（首个迭代）

**覆盖用例**: B-1, B-3, B-4, C-3.5, U-1

---

## 目标

迭代结束时，`<CasfaExplorer client={client} />` 可以：
1. 显示 depot 选择器，列出可用 depot
2. 选择 depot 后进入 List view，显示当前目录的文件和文件夹
3. 点击文件夹进入子目录，面包屑可导航
4. 大目录自动分页加载
5. 加载中显示 skeleton

---

## 任务分解

### 1.1 包脚手架

| 任务 | 说明 |
|------|------|
| 创建 `packages/explorer/` | `package.json`, `tsconfig.json`, `tsup.config.ts` |
| 配置 peerDependencies | `react`, `@mui/material`, `@casfa/client` |
| 配置 exports | `src/index.ts` 统一导出 |
| 目录结构 | `src/core/`, `src/components/`, `src/hooks/`, `src/types.ts`, `src/i18n/` |

**验收**: `bun run build` 通过，产出 ESM + CJS

### 1.2 `@casfa/client` 新增 `fs.*` 方法

| 方法 | API 端点 | 说明 |
|------|---------|------|
| `client.fs.stat(depotId, path)` | `GET /fs/stat` | 获取节点元数据 |
| `client.fs.ls(depotId, path, opts?)` | `GET /fs/ls` | 列出目录，支持 `limit` + `cursor` |
| `client.fs.read(depotId, path)` | `GET /fs/read` | 读取文件内容（Blob） |
| `client.fs.write(depotId, path, data)` | `POST /fs/write` | 写入文件 |
| `client.fs.mkdir(depotId, path)` | `POST /fs/mkdir` | 创建目录 |
| `client.fs.rm(depotId, path)` | `POST /fs/rm` | 删除 |
| `client.fs.mv(depotId, src, dst)` | `POST /fs/mv` | 移动/重命名 |
| `client.fs.cp(depotId, src, dst)` | `POST /fs/cp` | 复制 |
| `client.fs.commitRoot(depotId, root)` | `POST /depots/:id/commit` | 提交新 root |

> 本迭代只需 `stat`, `ls`, `commitRoot` 被 explorer 直接使用。其他方法一并实现，后续迭代直接消费。

**验收**: 每个方法有对应单元测试（mock HTTP）

### 1.3 Core Store（Zustand）

```ts
// src/core/explorer-store.ts
interface ExplorerState {
  // 连接
  client: CasfaClient | null;
  depotId: string | null;

  // 目录
  currentPath: string;
  items: ExplorerItem[];
  isLoading: boolean;
  cursor: string | null;   // 分页 cursor
  hasMore: boolean;

  // Actions
  setClient(client: CasfaClient): void;
  setDepot(depotId: string): void;
  navigate(path: string): void;
  loadDirectory(): Promise<void>;
  loadMore(): Promise<void>;
}
```

**验收**: store action 有单元测试

### 1.4 类型定义

```ts
// src/types.ts
interface ExplorerItem {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  contentType?: string;
  nodeKey?: string;        // CAS node ID (nod_XXXX)
}

// ... 其他类型见需求文档
```

### 1.5 `<CasfaExplorer>` 顶层组件

- 接收 `CasfaExplorerProps`
- 创建 Zustand store，注入 Context
- 根据 `depotId` 决定渲染 `<DepotSelector>` 或 `<ExplorerShell>`

**验收**: `<CasfaExplorer client={client} />` 可渲染

### 1.6 `<DepotSelector>` 

- 调用 `client.depots.list()` 获取 depot 列表
- MUI `Card` 或 `List` 展示每个 depot（名称、ID）
- 点击选中 → 调用 `store.setDepot()`
- 支持搜索过滤（前端）
- 空列表显示空态

**验收**: 选择 depot 后切换到文件浏览视图

### 1.7 `<ExplorerToolbar>` （基础版）

本迭代只包含：
- 面包屑导航 `<Breadcrumb>`（点击段跳转）
- 刷新按钮

**验收**: 面包屑随目录变化更新，点击可跳转

### 1.8 `<FileList>` — List View

- MUI `Table` + `@tanstack/react-virtual` 虚拟滚动
- 列: 图标 | 名称 | 大小 | 类型
- 点击文件夹 → `store.navigate()`
- 文件夹排在前面
- 滚动到底自动 `store.loadMore()`（分页）
- Loading skeleton

**验收**: 能浏览多层目录，大目录（>200 项）滚动加载

### 1.9 `<StatusBar>` （基础版）

- 显示当前目录项数
- 显示当前 depot ID

---

## 文件结构（迭代结束时）

```
packages/explorer/
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── src/
    ├── index.ts
    ├── types.ts
    ├── core/
    │   └── explorer-store.ts
    ├── hooks/
    │   └── use-explorer-context.ts
    ├── i18n/
    │   ├── en-US.ts
    │   └── zh-CN.ts
    └── components/
        ├── CasfaExplorer.tsx
        ├── DepotSelector.tsx
        ├── ExplorerShell.tsx
        ├── ExplorerToolbar.tsx
        ├── Breadcrumb.tsx
        ├── FileList.tsx
        └── StatusBar.tsx
```

---

## 风险 & 注意事项

1. **`@casfa/client` 改动范围**: 新增 `fs.*` namespace 需要和现有 client 结构兼容，注意不要 break 现有 API
2. **虚拟滚动 + 分页**: `@tanstack/react-virtual` 和 cursor-based 分页的交互需要仔细处理，确保 scroll position 在加载更多时不跳动
3. **Depot 列表权限**: delegate 可能只有部分 depot 的访问权，`depots.list()` 返回的是 delegate 可见的列表
