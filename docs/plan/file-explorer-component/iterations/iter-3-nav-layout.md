# Iteration 3 — 导航 + 布局

**主题**: 树形侧边栏、Grid view、前进/后退、路径输入、搜索、列排序

**前置依赖**: Iter 1

**覆盖用例**: B-2, B-5~B-10, S-1~S-3

---

## 目标

迭代结束时，`<CasfaExplorer />` 在 Iter 1 基础上新增：
1. 左侧可折叠的树形目录侧边栏，懒加载展开
2. Grid view 视图（图标/缩略图 + 文件名）
3. List / Grid 视图切换
4. 前进/后退/上级导航按钮 + 历史栈
5. 面包屑可切换为路径输入框，直接输入跳转
6. 搜索过滤（前端模糊匹配当前目录）
7. List view 列头排序（名称/大小/类型）
8. 侧边栏宽度可拖拽调整

---

## 任务分解

### 3.1 树形侧边栏

| 任务 | 说明 |
|------|------|
| `<DirectoryTree>` 组件 | 左侧面板，仅显示文件夹节点 |
| MUI `TreeView` | 使用 `@mui/x-tree-view` 或 `react-arborist`，支持展开/折叠 |
| 懒加载 | 展开节点时调用 `client.fs.ls()` 获取子目录，缓存已加载结果 |
| 点击导航 | 点击树节点 → `store.navigate(path)`，主面板切换到对应目录 |
| 高亮当前路径 | 当前浏览路径对应的节点高亮 + 自动展开祖先节点 |
| 可折叠 | 侧边栏顶部折叠按钮，折叠后仅显示窄条图标 |

```ts
// 树节点类型
interface TreeNode {
  path: string;
  name: string;
  children: TreeNode[] | null;  // null 表示未加载
  isExpanded: boolean;
  isLoading: boolean;
}
```

**验收**: 树形侧边栏正确展示目录结构，点击节点切换主面板目录，展开节点时懒加载子目录

### 3.2 Grid View

| 任务 | 说明 |
|------|------|
| `<FileGrid>` 组件 | CSS Grid 布局，每项显示图标/缩略图 + 文件名 |
| 图标映射 | 按 `contentType` 和 `isDirectory` 映射图标（文件夹、图片、文档、音视频、代码等） |
| 虚拟滚动 | `@tanstack/react-virtual` 实现 grid 虚拟化，支持大目录 |
| 交互一致 | 保持与 List view 相同的：单击选中、双击打开、右键菜单、拖拽（Iter 4） |
| 响应式列数 | 根据容器宽度自动计算列数（`auto-fill, minmax(120px, 1fr)`） |

```tsx
// Grid 项渲染
<Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 1 }}>
  {items.map(item => (
    <GridItem key={item.path} item={item} />
  ))}
</Box>
```

**验收**: Grid view 正确渲染文件图标和名称，大目录虚拟滚动流畅，选中/打开等交互与 List view 一致

### 3.3 视图切换

| 任务 | 说明 |
|------|------|
| Toolbar toggle | MUI `ToggleButtonGroup`，两个选项：列表图标 / 网格图标 |
| Store 状态 | `viewMode: 'list' | 'grid'` 存入 store |
| 条件渲染 | `<ExplorerBody>` 根据 `viewMode` 渲染 `<FileList>` 或 `<FileGrid>` |
| 快捷键 | `Ctrl+Shift+1` 切换列表，`Ctrl+Shift+2` 切换网格 |

**验收**: 切换按钮正确切换视图，状态持久化在 store 中

### 3.4 前进/后退导航

```ts
// Store 扩展
interface NavigationState {
  pathHistory: string[];       // 完整路径历史
  historyIndex: number;        // 当前位置

  goBack(): void;
  goForward(): void;
  goUp(): void;

  // 只读计算属性
  canGoBack: boolean;
  canGoForward: boolean;
  canGoUp: boolean;
}
```

| 任务 | 说明 |
|------|------|
| 历史栈 | `pathHistory: string[]` + `historyIndex`，`navigate()` 时 push 新路径并截断前进栈 |
| `goBack()` | `historyIndex--`，加载对应路径目录 |
| `goForward()` | `historyIndex++`，加载对应路径目录 |
| `goUp()` | 导航到 `currentPath` 的父目录（去掉最后一段） |
| Toolbar 按钮 | ← → ↑ 三个图标按钮，disabled 状态绑定 `canGoBack` / `canGoForward` / `canGoUp` |

**验收**: 多层目录浏览后，前进/后退按钮正确回溯历史路径

### 3.5 路径输入栏

| 任务 | 说明 |
|------|------|
| 切换模式 | 点击面包屑旁的编辑图标（或双击面包屑区域）→ 面包屑变为 `TextField` |
| 输入跳转 | 输入完整路径后回车 → `store.navigate(inputPath)` |
| 取消 | `Escape` 键恢复面包屑显示 |
| 路径自动补全 | 输入时调用 `client.fs.ls()` 获取匹配的子目录名，MUI `Autocomplete` 下拉提示 |
| 路径校验 | 不存在的路径给出错误提示，不执行跳转 |

**验收**: 输入有效路径回车后跳转到目标目录；输入无效路径时显示错误

### 3.6 搜索过滤

| 任务 | 说明 |
|------|------|
| Toolbar 搜索框 | MUI `TextField` + 搜索图标，`Ctrl+F` 快捷键聚焦 |
| 前端过滤 | 模糊匹配当前目录已加载的 `items`，按名称筛选 |
| 高亮匹配 | 搜索结果中高亮匹配的文本片段 |
| Store 状态 | `searchTerm: string`，`filteredItems` 为计算值 |
| 清除 | 搜索框右侧清除按钮，`Escape` 也清除搜索词 |
| 空结果 | 无匹配时显示 "未找到匹配项" 空态 |

```ts
// 过滤逻辑
const filteredItems = useMemo(() => {
  if (!searchTerm) return items;
  const lower = searchTerm.toLowerCase();
  return items.filter(item => item.name.toLowerCase().includes(lower));
}, [items, searchTerm]);
```

**验收**: 输入搜索词后列表实时过滤，匹配文本高亮显示

### 3.7 列排序

| 任务 | 说明 |
|------|------|
| 表头可点击 | List view 的 Name / Size / Type 列头添加排序指示器（MUI `TableSortLabel`） |
| 排序逻辑 | 点击切换：升序 → 降序 → 默认（文件夹优先 + 名称升序） |
| 文件夹置顶 | 无论排序条件如何，文件夹始终排在文件之前 |
| Store 状态 | `sortField: 'name' | 'size' | 'type' | null`，`sortDirection: 'asc' | 'desc'` |

```ts
// 排序状态
interface SortState {
  sortField: 'name' | 'size' | 'type' | null;
  sortDirection: 'asc' | 'desc';
  setSort(field: string): void;  // 点击同一列 toggle，不同列重置为 asc
}
```

**验收**: 点击列头切换排序方式，文件夹始终在文件之前

### 3.8 Resizable 面板

| 任务 | 说明 |
|------|------|
| 分割线 | 侧边栏与主面板之间的竖线，CSS `resize` 或自定义拖拽 |
| 拖拽调整 | 鼠标按住分割线左右拖拽，调整侧边栏宽度 |
| 最小/最大宽度 | 侧边栏最小 180px，最大 40% 容器宽度 |
| 持久化 | 宽度值存入 store（可选 localStorage） |
| 光标样式 | 悬停分割线时显示 `col-resize` 光标 |

```tsx
// 简化实现思路
const [sidebarWidth, setSidebarWidth] = useState(240);

const handleMouseDown = useCallback((e: React.MouseEvent) => {
  const startX = e.clientX;
  const startWidth = sidebarWidth;

  const onMouseMove = (e: MouseEvent) => {
    const newWidth = Math.max(180, Math.min(startWidth + e.clientX - startX, maxWidth));
    setSidebarWidth(newWidth);
  };

  const onMouseUp = () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  };

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}, [sidebarWidth]);
```

**验收**: 拖拽分割线可调整侧边栏宽度，有最小/最大限制

---

## Store 扩展（汇总）

```ts
// 在 Iter 1 基础上新增
interface ExplorerStateIter3 extends ExplorerState {
  // 视图
  viewMode: 'list' | 'grid';
  setViewMode(mode: 'list' | 'grid'): void;

  // 导航历史
  pathHistory: string[];
  historyIndex: number;
  goBack(): void;
  goForward(): void;
  goUp(): void;
  canGoBack: boolean;
  canGoForward: boolean;
  canGoUp: boolean;

  // 树
  treeNodes: Map<string, TreeNode>;
  expandTreeNode(path: string): Promise<void>;
  collapseTreeNode(path: string): void;

  // 搜索
  searchTerm: string;
  setSearchTerm(term: string): void;

  // 排序
  sortField: 'name' | 'size' | 'type' | null;
  sortDirection: 'asc' | 'desc';
  setSort(field: string): void;

  // 选择（基础版，Iter 4 增强）
  selectedItems: ExplorerItem[];
  select(item: ExplorerItem): void;
  clearSelection(): void;

  // 布局
  sidebarWidth: number;
  setSidebarWidth(width: number): void;
  sidebarCollapsed: boolean;
  toggleSidebar(): void;
}
```

---

## 文件结构（迭代结束时）

```
packages/explorer/src/
├── index.ts
├── types.ts                          # 扩展 TreeNode, SortState 等
├── core/
│   └── explorer-store.ts             # 扩展: viewMode, navigation, tree, search, sort
├── hooks/
│   ├── use-explorer-context.ts
│   ├── use-upload.ts                 # (from Iter 2)
│   ├── use-navigation.ts             # [NEW] 导航相关 hook
│   └── use-search.ts                 # [NEW] 搜索过滤 hook
├── i18n/
│   ├── en-US.ts
│   └── zh-CN.ts
├── utils/
│   ├── sort.ts                        # [NEW] 排序工具函数
│   └── icon-map.ts                    # [NEW] contentType → 图标映射
└── components/
    ├── CasfaExplorer.tsx
    ├── DepotSelector.tsx
    ├── ExplorerShell.tsx
    ├── ExplorerToolbar.tsx            # 扩展: 导航按钮, 搜索框, 视图切换
    ├── Breadcrumb.tsx                 # 扩展: 可切换为路径输入
    ├── FileList.tsx                   # 扩展: 列头排序
    ├── FileGrid.tsx                   # [NEW] 网格视图
    ├── DirectoryTree.tsx              # [NEW] 树形侧边栏
    ├── NavigationButtons.tsx          # [NEW] 前进/后退/上级按钮
    ├── SearchBox.tsx                  # [NEW] 搜索框
    ├── ViewToggle.tsx                 # [NEW] List/Grid 切换
    ├── PathInput.tsx                  # [NEW] 路径输入框(含自动补全)
    ├── ResizableSplitter.tsx          # [NEW] 可拖拽分割线
    ├── StatusBar.tsx
    ├── UploadOverlay.tsx              # (from Iter 2)
    ├── UploadProgress.tsx             # (from Iter 2)
    ├── ContextMenu.tsx                # (from Iter 2)
    ├── ConfirmDialog.tsx              # (from Iter 2)
    ├── RenameDialog.tsx               # (from Iter 2)
    ├── CreateFolderDialog.tsx         # (from Iter 2)
    └── ErrorSnackbar.tsx              # (from Iter 2)
```

---

## 风险 & 注意事项

1. **树懒加载缓存一致性**: 文件操作（Iter 2）修改目录结构后，树缓存需要同步更新。需在 `store.refresh()` 中清除受影响节点的缓存
2. **虚拟滚动 Grid**: `@tanstack/react-virtual` 的 grid 虚拟化需要固定行高和列数，自适应列数变化时需重新计算布局
3. **路径自动补全性能**: 每次按键触发 `fs.ls()` 会产生大量请求，需要 debounce（300ms+）并缓存最近结果
4. **前进/后退与外部导航**: 宿主应用通过 `onNavigate` 回调监听路径变化，但浏览器的前进/后退按钮不应与组件历史栈冲突
5. **排序与分页**: 排序在前端执行，仅对已加载的数据排序。如果目录有分页数据，排序可能不够准确——需在 UI 上说明 "当前排序仅针对已加载项"
6. **Iter 2 / Iter 3 并行开发**: 两个迭代都依赖 Iter 1，可以并行开发，但最终合并时需注意 store 扩展的合并冲突
