# Iteration 5 — CAS 特性 + 打磨

**主题**: CAS URI/Hash 展示、depot 历史、批量 rewrite、i18n、暗色模式、响应式、headless hooks 导出

**前置依赖**: Iter 4

**覆盖用例**: C-1~C-6, W-11, U-5~U-9

---

## 目标

迭代结束时，`<CasfaExplorer />` 在 Iter 4 基础上完成所有需求文档功能：
1. CAS Hash 列显示 + 点击复制
2. CAS URI 复制（右键菜单）
3. 相同 hash 文件去重指示
4. Depot 历史时间线 + 只读浏览历史版本
5. 批量 `fs.rewrite()` 优化替代逐个调用
6. 完整 i18n（en-US + zh-CN）
7. 暗色模式适配
8. 响应式布局（桌面/平板/移动端）
9. Headless hooks 全部导出
10. 自定义渲染 slot 验证
11. 性能优化
12. 文档 & 示例

---

## 任务分解

### 5.1 CAS Hash 列

| 任务 | 说明 |
|------|------|
| List view 新增列 | 可选的 "Hash" 列，显示 `nodeKey` 短格式 |
| 短格式 | 前 8 位 + `...` + 后 4 位，如 `nod_3FG7...K2M1` |
| Hover tooltip | 鼠标悬停显示完整 `nodeKey` |
| 点击复制 | 点击 hash 文本复制完整值到剪贴板，显示 "已复制" toast |
| 列显隐 | 工具栏设置菜单中可切换 Hash 列的显示/隐藏 |

```ts
// Hash 格式化
function formatNodeKey(nodeKey: string): string {
  if (nodeKey.length <= 16) return nodeKey;
  return `${nodeKey.slice(0, 12)}...${nodeKey.slice(-4)}`;
}
```

**验收**: Hash 列正确显示缩写，hover 显示完整值，点击复制到剪贴板

### 5.2 CAS URI

| 任务 | 说明 |
|------|------|
| 右键菜单项 | "复制 CAS URI" 菜单项 |
| URI 格式 | `cas://{depotId}/{path}`，使用 `@casfa/cas-uri` 包构建 |
| 剪贴板写入 | `navigator.clipboard.writeText(uri)` |
| 成功提示 | Snackbar "CAS URI 已复制" |

```ts
import { buildCasUri } from '@casfa/cas-uri';

function copyCasUri(depotId: string, path: string): void {
  const uri = buildCasUri({ depotId, path });
  navigator.clipboard.writeText(uri);
}
```

**验收**: 右键 → 复制 CAS URI → 剪贴板内容为正确的 `cas://` 格式

### 5.3 去重指示

| 任务 | 说明 |
|------|------|
| 检测逻辑 | 同一目录中 `nodeKey` 相同的文件分为一组 |
| 视觉标识 | 共享 nodeKey 的文件显示链接图标（🔗 或 MUI `LinkIcon`） |
| Tooltip | "此文件与 N 个其他文件内容相同（CAS 去重）" |
| 跨目录 | 本迭代仅检测同目录内去重，跨目录检测标记为 future |

```ts
// 去重检测
function findDuplicates(items: ExplorerItem[]): Map<string, ExplorerItem[]> {
  const groups = new Map<string, ExplorerItem[]>();
  for (const item of items) {
    if (item.nodeKey && !item.isDirectory) {
      const list = groups.get(item.nodeKey) ?? [];
      list.push(item);
      groups.set(item.nodeKey, list);
    }
  }
  // 仅保留有重复的组
  for (const [key, list] of groups) {
    if (list.length <= 1) groups.delete(key);
  }
  return groups;
}
```

**验收**: 同目录下相同 nodeKey 的文件显示链接图标和去重 tooltip

### 5.4 Depot 历史

| 任务 | 说明 |
|------|------|
| `<DepotHistory>` 面板 | 显示当前 depot 的 root 变更时间线 |
| 数据获取 | 调用 depot 历史 API 获取 root hash + 时间戳列表 |
| 时间线 UI | MUI `Timeline` 或自定义列表，每项显示 root hash（短格式）+ 时间 |
| 历史浏览 | 点击历史版本 → 以只读模式浏览该版本的文件树 |
| 只读标识 | 浏览历史版本时工具栏显示 "只读 — 历史版本" 提示条，隐藏所有写操作 |
| 返回当前 | 提供 "返回当前版本" 按钮 |

```ts
interface DepotHistoryEntry {
  rootHash: string;
  timestamp: string;       // ISO 8601
  commitMessage?: string;
}

// Store 扩展
interface HistoryState {
  historyEntries: DepotHistoryEntry[];
  isViewingHistory: boolean;
  viewingRootHash: string | null;
  fetchHistory(): Promise<void>;
  viewHistoryVersion(rootHash: string): void;
  exitHistoryView(): void;
}
```

**验收**: 可查看 depot 历史时间线，点击历史版本进入只读浏览模式，可返回当前版本

### 5.5 批量 Rewrite

| 任务 | 说明 |
|------|------|
| 替换逐个调用 | 批量删除/移动/复制时，使用 `client.fs.rewrite(depotId, entries, deletes)` 代替多次独立调用 |
| 100 条限制 | `rewrite` API 单次最多 100 entries，超过时自动分批 |
| 事务性 | 每批 rewrite 是原子的，批次间非原子 — 需在 UI 上体现进度 |
| 回退兼容 | 如果 rewrite API 不可用（老版本 server），fallback 到逐个调用 |

```ts
// 分批 rewrite
async function batchRewrite(
  client: CasfaClient,
  depotId: string,
  entries: RewriteEntry[],
  deletes: string[],
  batchSize = 100
): Promise<void> {
  // 分批处理 entries
  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);
    const batchDeletes = i === 0 ? deletes.slice(0, batchSize - batch.length) : [];
    await client.fs.rewrite(depotId, batch, batchDeletes);
  }
  // 处理剩余的 deletes
  for (let i = 0; i < deletes.length; i += batchSize) {
    const batch = deletes.slice(i, i + batchSize);
    await client.fs.rewrite(depotId, [], batch);
  }
}
```

**验收**: 批量删除 50 个文件使用 1 次 rewrite 调用而非 50 次 rm 调用；超过 100 条自动分批

### 5.6 i18n 完善

| 任务 | 说明 |
|------|------|
| 完整翻译文件 | `en-US.ts` 和 `zh-CN.ts` 覆盖所有 `ExplorerTextKey` |
| `ExplorerTextKey` 导出 | 枚举类型作为包的公开 API 导出 |
| `locale` prop | 切换 `"en-US"` / `"zh-CN"` |
| `i18n` decorator | 修饰函数正确包裹内置翻译 |
| 文档 | i18n 使用指南：覆盖个别 key、接入宿主 i18n 框架、添加新语言 |
| 插值支持 | `t("dialog.confirmDelete.body", { count: 3 })` → "删除 3 个项目？" |

```ts
// 完整翻译文件结构
const zhCN: Record<ExplorerTextKey, string> = {
  "toolbar.createFolder": "新建文件夹",
  "toolbar.upload": "上传",
  "toolbar.download": "下载",
  "toolbar.delete": "删除",
  "toolbar.rename": "重命名",
  "toolbar.refresh": "刷新",
  "toolbar.search": "搜索文件...",
  "context.open": "打开",
  "context.cut": "剪切",
  "context.copy": "复制",
  "context.paste": "粘贴",
  "context.copyCasUri": "复制 CAS URI",
  "context.properties": "属性",
  "dialog.confirmDelete.title": "确认删除",
  "dialog.confirmDelete.body": "确定要删除 {count} 个项目吗？此操作不可撤销。",
  "dialog.newFolder.title": "新建文件夹",
  "dialog.newFolder.placeholder": "文件夹名称",
  "dialog.rename.title": "重命名",
  "dialog.conflict.title": "名称冲突",
  "dialog.conflict.overwrite": "覆盖",
  "dialog.conflict.rename": "重命名",
  "dialog.conflict.skip": "跳过",
  "status.emptyFolder": "此文件夹为空",
  "status.dropFiles": "拖拽文件到此处上传",
  "status.uploadSuccess": "已上传 {count} 个文件",
  "status.deleteSuccess": "已删除 {count} 个项目",
  "error.network": "网络不可用",
  "error.permissionDenied": "权限不足",
  "error.fileTooLarge": "文件过大（最大 4MB）",
  "error.authExpired": "认证已过期，请重新登录",
  "depot.select": "选择仓库",
  "depot.empty": "暂无可用仓库",
  // ... 更多 key
};
```

**验收**: 切换 `locale="zh-CN"` 后所有 UI 文案为中文；`i18n` decorator 可覆盖个别 key

### 5.7 暗色模式

| 任务 | 说明 |
|------|------|
| MUI theme 适配 | 所有组件使用 `theme.palette` 取色，不硬编码颜色值 |
| 自定义样式审查 | 排查所有 `sx` 和 CSS-in-JS 中的硬编码色值，替换为 theme token |
| 覆盖层/拖拽 | `UploadOverlay`、`DragPreview` 等自定义覆盖层适配暗色 |
| 图标颜色 | 文件类型图标在暗色模式下可辨识 |
| 测试 | light/dark 两套模式下全面视觉验证 |

```tsx
// 正确做法
<Box sx={{ bgcolor: 'background.paper', color: 'text.primary', borderColor: 'divider' }}>

// 错误做法 ❌
<Box sx={{ bgcolor: '#ffffff', color: '#333333', borderColor: '#e0e0e0' }}>
```

**验收**: 在 MUI `ThemeProvider` 设置 `palette.mode: 'dark'` 时，所有组件正确渲染暗色主题

### 5.8 响应式布局

| 断点 | 适配策略 |
|------|---------|
| `≥ 1024px` (桌面) | 完整布局：侧边栏 + 主面板 + Detail Panel |
| `768px ~ 1023px` (平板) | 侧边栏默认折叠，Detail Panel 变为 overlay |
| `< 768px` (移动端) | 隐藏侧边栏，Grid view 自适应列数（2-3列），工具栏折叠为 overflow menu，Detail Panel 变为全屏 dialog |

| 任务 | 说明 |
|------|------|
| MUI `useMediaQuery` | 检测当前断点 |
| 工具栏响应式 | 小屏时按钮折叠为 `IconButton` + `Menu` (overflow) |
| Grid 自适应 | `minmax()` 随容器宽度自动调整列数 |
| Detail 全屏 | 小屏时 `<DetailPanel>` 替换为 `<Dialog fullScreen>` |
| 面包屑截断 | 小屏时面包屑只显示最后 2 级 + `...` |

```tsx
// 响应式 hook
function useResponsiveLayout() {
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const isTablet = useMediaQuery('(min-width: 768px) and (max-width: 1023px)');
  const isMobile = useMediaQuery('(max-width: 767px)');

  return {
    showSidebar: isDesktop,
    sidebarOverlay: isTablet,
    detailMode: isMobile ? 'fullscreen' : 'drawer',
    toolbarCompact: isMobile,
    breadcrumbMaxSegments: isMobile ? 2 : Infinity,
  };
}
```

**验收**: 在 768px 以下宽度，侧边栏隐藏、工具栏折叠、Grid 列数自适应

### 5.9 Headless Hooks 导出

| Hook | 签名 | 说明 |
|------|------|------|
| `useDepots` | `(client) → { depots, isLoading, refresh }` | Depot 列表 |
| `useDirectory` | `(path) → { items, isLoading, hasMore, loadMore, refresh }` | 目录浏览 |
| `useDirectoryTree` | `(rootPath) → { tree, expandNode, collapseNode }` | 树形数据 |
| `useFileOperations` | `() → { upload, download, mkdir, rm, mv, cp, rename }` | 文件操作 |
| `useSelection` | `() → { selected, select, deselect, toggleSelect, selectAll, clearSelection }` | 选择 |
| `useClipboard` | `() → { clipboard, cut, copy, paste, canPaste }` | 剪贴板 |
| `useNavigation` | `() → { currentPath, navigate, goBack, goForward, goUp, canGoBack, canGoForward }` | 导航 |
| `useSearch` | `() → { searchTerm, setSearchTerm, filteredItems }` | 搜索 |
| `useUploadQueue` | `() → { queue, addFiles, cancelUpload, retryUpload, progress }` | 上传队列 |

| 任务 | 说明 |
|------|------|
| 独立可用 | 每个 hook 不依赖 Explorer UI 组件，可在自定义 UI 中单独使用 |
| Context 依赖 | hooks 需要 `<ExplorerProvider client={client}>` 包裹 |
| Provider 导出 | 导出 `<ExplorerProvider>` 供 headless 使用 |
| 文档 | 每个 hook 的 JSDoc + README 示例 |
| 测试 | 每个 hook 有独立单元测试（`renderHook`） |

```tsx
// Headless 使用示例
import { ExplorerProvider, useDirectory, useNavigation } from '@casfa/explorer';

function MyCustomExplorer({ client }: { client: CasfaClient }) {
  return (
    <ExplorerProvider client={client} depotId="dpt_XXXX">
      <MyFileList />
    </ExplorerProvider>
  );
}

function MyFileList() {
  const { items, isLoading } = useDirectory('/');
  const { navigate } = useNavigation();

  return (
    <ul>
      {items.map(item => (
        <li key={item.path} onClick={() => item.isDirectory && navigate(item.path)}>
          {item.name}
        </li>
      ))}
    </ul>
  );
}
```

**验收**: 用户可使用 headless hooks + 自定义 UI 构建完全定制的文件浏览器

### 5.10 自定义渲染 Slot

| Slot | Props | 说明 |
|------|-------|------|
| `renderEmptyState` | `() → ReactNode` | 自定义空目录显示内容 |
| `renderBreadcrumb` | `(segments: PathSegment[]) → ReactNode` | 自定义面包屑渲染 |
| `renderNodeIcon` | `(item: ExplorerItem) → ReactNode` | 自定义文件/文件夹图标 |

| 任务 | 说明 |
|------|------|
| 默认实现 | 三个 slot 都有内置默认实现 |
| 条件渲染 | 传入自定义 render 时使用自定义版本，否则 fallback 默认 |
| 类型安全 | `PathSegment` 等类型作为公开 API 导出 |
| 文档 + 示例 | 每个 slot 的使用示例 |

```ts
interface PathSegment {
  label: string;       // 显示名称
  path: string;        // 完整路径
  isLast: boolean;     // 是否为最后一段（当前目录）
}
```

**验收**: 三个自定义渲染 slot 传入自定义函数时正确渲染，不传时使用默认实现

### 5.11 性能优化

| 任务 | 说明 |
|------|------|
| `React.memo` | 对 `FileListItem`、`FileGridItem`、`TreeNode` 等频繁渲染组件包裹 memo |
| `useMemo` / `useCallback` | store selector、排序/过滤结果、事件处理函数用 memo 缓存 |
| 虚拟滚动验证 | 10,000+ 项目录加载和滚动流畅（60fps） |
| Bundle size | 审查 tree-shaking，确保未使用的组件不被打包 |
| Lighthouse | 集成页面 Lighthouse Performance 评分 ≥ 90 |
| Profiler | React DevTools Profiler 验证无不必要的重渲染 |

```tsx
// 组件 memo 示例
const FileListItem = React.memo<FileListItemProps>(({ item, isSelected, onClick }) => {
  return (
    <TableRow selected={isSelected} onClick={onClick}>
      <TableCell>{item.name}</TableCell>
      <TableCell>{item.formattedSize}</TableCell>
      <TableCell>{item.contentType}</TableCell>
    </TableRow>
  );
});

// Store selector 优化
const items = useExplorerStore(useShallow(state => state.items));
```

**验收**: 10K 项目录滚动无卡顿，React Profiler 无多余重渲染

### 5.12 文档 & 示例

| 任务 | 说明 |
|------|------|
| `README.md` | 安装、基本用法、完整 Props API 参考、Headless hooks 参考 |
| API 文档 | 所有公开类型的 TSDoc 注释 |
| 使用示例 | 最小用法、指定 depot、自定义右键菜单、自定义预览器、headless hooks、i18n |
| `CHANGELOG.md` | 各迭代的变更记录 |
| Storybook（可选） | 如果时间允许，创建核心组件的 Storybook stories |

**验收**: README 完整且可按文档成功集成组件

---

## 文件结构（最终）

```
packages/explorer/
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── README.md                          # [NEW] 完整文档
├── CHANGELOG.md                       # [NEW] 变更记录
└── src/
    ├── index.ts                       # 统一导出: 组件 + hooks + types + i18n
    ├── types.ts                       # 完整公开类型
    ├── core/
    │   └── explorer-store.ts          # 扩展: history, rewrite
    ├── hooks/
    │   ├── use-explorer-context.ts
    │   ├── use-upload.ts
    │   ├── use-navigation.ts
    │   ├── use-search.ts
    │   ├── use-clipboard.ts
    │   ├── use-selection.ts
    │   ├── use-keyboard-navigation.ts
    │   ├── use-dnd.ts
    │   ├── use-depots.ts              # [NEW] Depot 列表 hook
    │   ├── use-directory.ts           # [NEW] 目录浏览 hook
    │   ├── use-directory-tree.ts      # [NEW] 树形数据 hook
    │   ├── use-file-operations.ts     # [NEW] 文件操作 hook
    │   ├── use-upload-queue.ts        # [NEW] 上传队列 hook
    │   └── use-responsive.ts          # [NEW] 响应式布局 hook
    ├── i18n/
    │   ├── en-US.ts                   # 完整翻译
    │   ├── zh-CN.ts                   # 完整翻译
    │   ├── types.ts                   # ExplorerTextKey 枚举导出
    │   └── index.ts                   # i18n 工具函数
    ├── utils/
    │   ├── sort.ts
    │   ├── icon-map.ts
    │   ├── format-size.ts
    │   ├── concurrent-pool.ts
    │   ├── format-node-key.ts         # [NEW] Hash 格式化
    │   ├── find-duplicates.ts         # [NEW] 去重检测
    │   └── batch-rewrite.ts           # [NEW] 分批 rewrite
    ├── preview/
    │   ├── builtin-providers.ts
    │   ├── ImagePreview.tsx
    │   ├── TextPreview.tsx
    │   ├── AudioPreview.tsx
    │   └── VideoPreview.tsx
    └── components/
        ├── CasfaExplorer.tsx
        ├── ExplorerProvider.tsx        # [NEW] Headless provider
        ├── DepotSelector.tsx
        ├── DepotHistory.tsx            # [NEW] Depot 历史时间线
        ├── ExplorerShell.tsx
        ├── ExplorerToolbar.tsx         # 扩展: 响应式折叠
        ├── Breadcrumb.tsx              # 扩展: 响应式截断, renderBreadcrumb slot
        ├── FileList.tsx                # 扩展: Hash 列, renderNodeIcon slot, memo
        ├── FileGrid.tsx                # 扩展: renderNodeIcon slot, 响应式列数, memo
        ├── DirectoryTree.tsx
        ├── NavigationButtons.tsx
        ├── SearchBox.tsx
        ├── ViewToggle.tsx
        ├── PathInput.tsx
        ├── ResizableSplitter.tsx
        ├── StatusBar.tsx               # 扩展: root hash 显示
        ├── UploadOverlay.tsx
        ├── UploadProgress.tsx
        ├── ContextMenu.tsx             # 扩展: CAS URI 菜单项
        ├── ConfirmDialog.tsx
        ├── RenameDialog.tsx
        ├── CreateFolderDialog.tsx
        ├── ConflictDialog.tsx
        ├── DetailPanel.tsx             # 扩展: 响应式 fullscreen
        ├── PreviewPanel.tsx
        ├── DragPreview.tsx
        ├── DuplicateIndicator.tsx      # [NEW] 去重标识组件
        ├── HistoryBanner.tsx           # [NEW] 历史版本提示条
        └── ErrorSnackbar.tsx
```

---

## 风险 & 注意事项

1. **`@casfa/cas-uri` 兼容性**: 确认 `buildCasUri` 的参数格式与当前 `cas-uri` 包一致，URI scheme 可能有更新
2. **Depot 历史 API**: 需确认 server 端是否已实现 depot history 查询接口；若未实现，该功能需推迟或 mock
3. **`fs.rewrite()` 事务边界**: 分批 rewrite 在批次间不是原子的，如果中间批次失败，前面已执行的批次不会回滚。需在 UI 上明确提示进度
4. **暗色模式覆盖率**: MUI 组件本身支持 dark mode，但自定义的 overlay、DragPreview 等需逐一审查。建议创建 dark mode checklist
5. **响应式断点测试**: 需在真实设备（或 Chrome DevTools Device Mode）上测试各断点，纯 CSS media query 可能在某些 edge case 下表现不一致
6. **Headless hooks 的 Context 依赖**: hooks 必须在 `<ExplorerProvider>` 内使用，需在文档中明确说明，并在 hook 内部添加缺失 Context 时的友好错误提示
7. **性能回归**: 添加去重检测、Hash 列等功能后需确保不影响大目录浏览性能。`findDuplicates` 在 10K 项时需 O(n) 时间，应缓存结果
8. **Bundle size 监控**: 新增 i18n 翻译文件、预览器等会增加包体积。考虑翻译文件按需加载（dynamic import），预览器通过 code splitting 懒加载
