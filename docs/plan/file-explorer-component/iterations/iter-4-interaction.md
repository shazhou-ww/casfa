# Iteration 4 — 交互增强

**主题**: 剪贴板（复制/移动）、拖拽（DnD）、键盘快捷键、Detail/Preview 面板、上传进度增强

**前置依赖**: Iter 2 + Iter 3

**覆盖用例**: W-3, W-4, W-9, W-10, S-5~S-7, R-1~R-4

---

## 目标

迭代结束时，`<CasfaExplorer />` 在 Iter 2 + 3 基础上新增：
1. 剪贴板功能（剪切/复制/粘贴），调用 `fs.cp` 或 `fs.mv`
2. Ctrl+C / Ctrl+X / Ctrl+V 快捷键
3. 多选增强：Shift+Click 范围选择、Ctrl+Click 切换选择、Ctrl+A 全选
4. 拖拽移动/复制（@dnd-kit/core）
5. 完整键盘导航（方向键、Enter、Backspace、Delete、F2 等）
6. Detail Panel（文件元数据面板）
7. Preview Panel（文件预览面板）
8. 上传进度增强（多文件并行、整体进度）
9. 名称冲突对话框

---

## 任务分解

### 4.1 剪贴板 Store

```ts
interface ClipboardState {
  clipboard: {
    items: ExplorerItem[];
    operation: 'copy' | 'cut';
  } | null;

  cut(items: ExplorerItem[]): void;
  copy(items: ExplorerItem[]): void;
  paste(targetPath: string): Promise<void>;  // 根据 operation 调用 fs.cp 或 fs.mv
  canPaste: boolean;
  clearClipboard(): void;
}
```

| 任务 | 说明 |
|------|------|
| clipboard state | `{ items, operation }` 存入 store |
| `copy()` | 将选中项 + `'copy'` 存入 clipboard |
| `cut()` | 将选中项 + `'cut'` 存入 clipboard，剪切项在 UI 上半透明显示 |
| `paste()` | `operation === 'copy'` → 逐个调用 `client.fs.cp(depotId, src, dst)` |
|  | `operation === 'cut'` → 逐个调用 `client.fs.mv(depotId, src, dst)` |
| 粘贴后处理 | copy: clipboard 保留（可多次粘贴）；cut: clipboard 清空 |
| 名称冲突 | 目标路径已存在同名项时触发 `<ConflictDialog>`（见 4.10） |

**验收**: 复制文件后粘贴到其他目录，原文件不变、目标出现新文件；剪切后粘贴，原位置文件消失

### 4.2 Ctrl+C/X/V 快捷键

| 任务 | 说明 |
|------|------|
| 快捷键绑定 | `Ctrl+C` → `copy(selectedItems)`，`Ctrl+X` → `cut(selectedItems)`，`Ctrl+V` → `paste(currentPath)` |
| 焦点限定 | 仅当 Explorer 组件区域有焦点时生效，不影响页面其他输入框 |
| 实现方式 | `useEffect` + `keydown` 事件监听，检查 `event.target` 是否在组件 ref 内 |
| 菜单项启用 | Iter 2 中 disabled 的剪切/复制/粘贴菜单项现在全部启用 |

**验收**: 快捷键在 Explorer 聚焦时正确触发，不影响其他组件的 Ctrl+C/V 行为

### 4.3 多选增强

```ts
interface SelectionState {
  selectedItems: ExplorerItem[];
  lastSelectedIndex: number | null;   // 用于 Shift+Click 范围选择

  select(item: ExplorerItem): void;               // 单选（清除其他）
  toggleSelect(item: ExplorerItem): void;          // Ctrl+Click 切换
  rangeSelect(item: ExplorerItem): void;           // Shift+Click 范围
  selectAll(): void;                               // Ctrl+A
  clearSelection(): void;
  isSelected(item: ExplorerItem): boolean;
}
```

| 任务 | 说明 |
|------|------|
| Shift+Click | 从 `lastSelectedIndex` 到当前项，范围内所有项选中 |
| Ctrl+Click | 切换单项选中状态，不影响其他已选项 |
| Ctrl+A | 选中当前目录所有已加载项 |
| 视觉反馈 | 选中项背景高亮（MUI `selected` 色），多选时工具栏显示 "已选 N 项" |
| List + Grid | 两种视图共用选择逻辑 |

**验收**: Shift+Click 正确范围选择，Ctrl+Click 切换选择，Ctrl+A 全选

### 4.4 拖拽基础设施

| 任务 | 说明 |
|------|------|
| 依赖安装 | `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` |
| `DndContext` | 在 `<ExplorerShell>` 中包裹 `<DndContext>` |
| Draggable | 文件/文件夹 item 作为 draggable，id = `item.path` |
| Droppable | 文件夹 item、树节点、面包屑段作为 droppable |
| `DragOverlay` | 拖拽时显示预览：单文件显示文件名 + 图标，多文件显示 "N 个项目" |
| 拖拽 handle | 整个 item 行/卡片可拖拽 |

```tsx
// DndContext 配置
<DndContext
  sensors={sensors}
  collisionDetection={closestCenter}
  onDragStart={handleDragStart}
  onDragOver={handleDragOver}
  onDragEnd={handleDragEnd}
>
  {/* FileList / FileGrid / DirectoryTree */}
  <DragOverlay>
    {activeDragItem && <DragPreview items={dragItems} />}
  </DragOverlay>
</DndContext>
```

**验收**: 可拖起文件/文件夹，拖拽时显示预览覆盖层

### 4.5 拖拽操作

| 任务 | 说明 |
|------|------|
| 拖入文件夹 | drop 到文件夹 → `client.fs.mv(depotId, srcPath, dstFolder + '/' + name)` |
| Alt+拖拽 → 复制 | 按住 Alt 键拖拽时使用 `client.fs.cp()` 替代 `fs.mv()` |
| 拖到树节点 | 树形侧边栏的文件夹节点也是合法 drop target |
| 拖到面包屑 | 面包屑的每一段也是合法 drop target，拖入对应目录 |
| 视觉反馈 | 合法 drop target 高亮（蓝色边框），不合法目标（自身、自身子目录）显示禁止图标 |
| 不可拖入文件 | 文件不是 droppable，仅文件夹可接收 drop |
| 循环检测 | 不允许将文件夹拖入自身或其子目录 |

**验收**: 拖拽文件到目标文件夹后自动移动；Alt+拖拽实现复制；不合法拖拽有禁止反馈

### 4.6 键盘导航

| 快捷键 | 操作 | 说明 |
|--------|------|------|
| `↑` / `↓` | 移动焦点 | 在列表/网格中上下/左右移动焦点高亮 |
| `Enter` | 打开 | 文件夹 → 进入，文件 → 触发 `onFileOpen` |
| `Backspace` / `Alt+↑` | 返回上级 | 等同 `goUp()` |
| `Delete` | 删除 | 触发删除确认对话框 |
| `F2` | 重命名 | 触发重命名对话框 |
| `Ctrl+C` | 复制 | 见 4.2 |
| `Ctrl+X` | 剪切 | 见 4.2 |
| `Ctrl+V` | 粘贴 | 见 4.2 |
| `Ctrl+A` | 全选 | 见 4.3 |
| `Ctrl+D` | 下载 | 触发文件下载 |
| `Ctrl+Shift+N` | 新建文件夹 | 打开创建文件夹对话框 |
| `Ctrl+U` | 上传 | 触发文件上传 |
| `Ctrl+F` | 搜索 | 聚焦搜索框 |
| `F5` | 刷新 | 刷新当前目录 |
| `Esc` | 取消 | 清除选择 / 关闭面板 / 退出搜索 |

| 任务 | 说明 |
|------|------|
| focusIndex state | 维护当前焦点项索引，与选中项独立 |
| 方向键处理 | List view: ↑↓ 上下移动；Grid view: ↑↓←→ 矩阵移动 |
| `useKeyboardNavigation` hook | 统一键盘事件处理，注册在组件根 div 上 |
| 焦点可视化 | 焦点项显示虚线边框（区别于选中项的背景色） |

**验收**: 纯键盘可完成浏览、打开、选择、删除、重命名等全部操作

### 4.7 Detail Panel

| 任务 | 说明 |
|------|------|
| `<DetailPanel>` | 右侧浮动面板，MUI `Drawer` (persistent variant) |
| 触发方式 | 工具栏 ℹ️ 按钮 toggle 显隐，或选中文件后自动显示 |
| 显示内容 | 文件名、大小（格式化）、内容类型、nodeKey (CAS Hash)、完整路径、创建/修改时间 |
| 文件夹详情 | 文件夹显示：名称、路径、子项数量 |
| 多选时 | 显示 "已选 N 项" + 汇总大小 |
| 无选中时 | 显示当前目录信息 |
| 可折叠 | 面板右上角关闭按钮 |

```tsx
// DetailPanel 数据结构
interface DetailInfo {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  formattedSize?: string;      // "2.1 KB", "48 MB"
  contentType?: string;
  nodeKey?: string;             // nod_XXXX
  itemCount?: number;           // 文件夹子项数
}
```

**验收**: 选中文件后右侧面板显示完整元数据，切换选择时面板实时更新

### 4.8 Preview Panel

| 任务 | 说明 |
|------|------|
| 集成 `previewProviders` | 按优先级匹配用户自定义 provider，fallback 到内置预览器 |
| 内置: `image/*` | `<img>` 标签，支持缩放 |
| 内置: `text/*` | 等宽字体渲染，显示行号，限制前 200 行 |
| 内置: `audio/*` | HTML5 `<audio>` 播放器 |
| 内置: `video/*` | HTML5 `<video>` 播放器 |
| 其他类型 | 显示大图标 + 文件元数据 + "不支持预览" 文案 |
| 加载策略 | 双击文件或在 Detail Panel 中点击 "预览" 按钮触发 |
| 内容获取 | 调用 `client.fs.read()` 获取 Blob，传入 provider 的 `render()` |

```ts
// 内置预览器注册
const builtinProviders: PreviewProvider[] = [
  {
    match: (file) => file.contentType?.startsWith('image/') ?? false,
    render: (file, blob) => <ImagePreview blob={blob} alt={file.name} />,
    label: 'Image',
  },
  {
    match: (file) => file.contentType?.startsWith('text/') ?? false,
    render: (file, blob) => <TextPreview blob={blob} maxLines={200} />,
    label: 'Text',
  },
  {
    match: (file) => file.contentType?.startsWith('audio/') ?? false,
    render: (file, blob) => <AudioPreview blob={blob} />,
    label: 'Audio',
  },
  {
    match: (file) => file.contentType?.startsWith('video/') ?? false,
    render: (file, blob) => <VideoPreview blob={blob} />,
    label: 'Video',
  },
];
```

**验收**: 双击图片文件显示图片预览，文本文件显示代码渲染，自定义 provider 优先于内置

### 4.9 上传进度增强

| 任务 | 说明 |
|------|------|
| 并行上传 | 可配置并发数（默认 3），使用 Promise 并发池 |
| 整体进度 | 显示 "已完成 5/10 (50%)" 汇总进度条 |
| 自动关闭 | 全部完成后延迟 3s 自动折叠进度面板 |
| 失败处理 | 失败项保留在队列中，显示重试按钮 |
| 取消全部 | "取消全部" 按钮取消所有 pending 项 |

```ts
// 并发池实现
async function uploadWithConcurrency(
  files: UploadQueueItem[],
  concurrency: number,
  uploadFn: (item: UploadQueueItem) => Promise<void>
): Promise<void> {
  const pool: Promise<void>[] = [];
  for (const file of files) {
    const p = uploadFn(file).then(() => {
      pool.splice(pool.indexOf(p), 1);
    });
    pool.push(p);
    if (pool.length >= concurrency) {
      await Promise.race(pool);
    }
  }
  await Promise.all(pool);
}
```

**验收**: 多文件上传时并行处理（可观察到多个同时 uploading），整体进度准确

### 4.10 `<ConflictDialog>`

| 任务 | 说明 |
|------|------|
| 触发时机 | 上传/复制/移动时目标路径已存在同名文件 |
| 选项 | 覆盖(overwrite)、跳过(skip)、重命名(rename，自动追加 `(1)` 后缀) |
| 批量应用 | "对所有冲突项应用此选择" checkbox |
| 预览 | 显示源文件与目标文件的名称、大小对比 |

```ts
interface ConflictResolution {
  action: 'overwrite' | 'skip' | 'rename';
  applyToAll: boolean;
}

// 冲突检测
async function checkConflict(depotId: string, targetPath: string): Promise<boolean> {
  try {
    await client.fs.stat(depotId, targetPath);
    return true;  // 文件存在 → 冲突
  } catch (e) {
    return false;  // 404 → 无冲突
  }
}
```

**验收**: 上传同名文件时弹出冲突对话框，三种选项均正确执行

---

## Store 扩展（汇总）

```ts
// 在 Iter 2 + 3 基础上新增
interface ExplorerStateIter4 {
  // 剪贴板
  clipboard: { items: ExplorerItem[]; operation: 'copy' | 'cut' } | null;
  cut(items: ExplorerItem[]): void;
  copy(items: ExplorerItem[]): void;
  paste(targetPath: string): Promise<void>;
  canPaste: boolean;

  // 多选增强
  lastSelectedIndex: number | null;
  toggleSelect(item: ExplorerItem): void;
  rangeSelect(item: ExplorerItem): void;
  selectAll(): void;

  // 焦点
  focusIndex: number | null;
  setFocusIndex(index: number): void;

  // Detail Panel
  detailPanelOpen: boolean;
  toggleDetailPanel(): void;

  // 上传并发
  uploadConcurrency: number;
  overallUploadProgress: { completed: number; total: number };
}
```

---

## 文件结构（迭代结束时）

```
packages/explorer/src/
├── index.ts
├── types.ts
├── core/
│   └── explorer-store.ts             # 扩展: clipboard, selection, focus, detailPanel
├── hooks/
│   ├── use-explorer-context.ts
│   ├── use-upload.ts                  # 扩展: 并行上传, 冲突检测
│   ├── use-navigation.ts             # (from Iter 3)
│   ├── use-search.ts                 # (from Iter 3)
│   ├── use-clipboard.ts              # [NEW] 剪贴板 hook
│   ├── use-selection.ts              # [NEW] 多选逻辑 hook
│   ├── use-keyboard-navigation.ts    # [NEW] 键盘导航 hook
│   └── use-dnd.ts                    # [NEW] 拖拽逻辑 hook
├── i18n/
│   ├── en-US.ts                      # 新增预览/剪贴板/冲突相关文案
│   └── zh-CN.ts
├── utils/
│   ├── sort.ts
│   ├── icon-map.ts
│   ├── format-size.ts                # [NEW] 文件大小格式化 (bytes → "2.1 KB")
│   └── concurrent-pool.ts            # [NEW] 并发池工具
├── preview/
│   ├── builtin-providers.ts           # [NEW] 内置预览器注册
│   ├── ImagePreview.tsx               # [NEW]
│   ├── TextPreview.tsx                # [NEW]
│   ├── AudioPreview.tsx               # [NEW]
│   └── VideoPreview.tsx               # [NEW]
└── components/
    ├── CasfaExplorer.tsx
    ├── DepotSelector.tsx
    ├── ExplorerShell.tsx              # 扩展: DndContext 包裹
    ├── ExplorerToolbar.tsx
    ├── Breadcrumb.tsx                 # 扩展: droppable
    ├── FileList.tsx                   # 扩展: draggable + droppable + 多选 + 焦点
    ├── FileGrid.tsx                   # 扩展: draggable + droppable + 多选 + 焦点
    ├── DirectoryTree.tsx              # 扩展: droppable
    ├── NavigationButtons.tsx
    ├── SearchBox.tsx
    ├── ViewToggle.tsx
    ├── PathInput.tsx
    ├── ResizableSplitter.tsx
    ├── StatusBar.tsx                  # 扩展: 显示选中数量
    ├── UploadOverlay.tsx
    ├── UploadProgress.tsx             # 扩展: 并行进度, 整体百分比
    ├── ContextMenu.tsx                # 扩展: 剪切/复制/粘贴 启用
    ├── ConfirmDialog.tsx
    ├── RenameDialog.tsx
    ├── CreateFolderDialog.tsx
    ├── ConflictDialog.tsx             # [NEW] 名称冲突对话框
    ├── DetailPanel.tsx                # [NEW] 文件详情面板
    ├── PreviewPanel.tsx               # [NEW] 文件预览面板
    ├── DragPreview.tsx                # [NEW] 拖拽预览覆盖层
    └── ErrorSnackbar.tsx
```

---

## 风险 & 注意事项

1. **@dnd-kit 与虚拟滚动兼容性**: `@dnd-kit` 依赖 DOM 节点测量，虚拟化列表中不可见的 DOM 节点被回收后可能导致拖拽异常。需确保 `DragOverlay` 独立于虚拟列表渲染
2. **剪贴板与系统剪贴板冲突**: `Ctrl+C/V` 在 Explorer 聚焦时拦截浏览器默认行为，需确保在文本输入框（搜索框、重命名框）中不拦截
3. **大文件预览内存**: 预览大图片/视频时需注意内存消耗，应设置文件大小上限（如 >10MB 不自动预览），并在关闭预览时 revoke ObjectURL
4. **循环拖拽检测**: 将文件夹拖入自身子目录会导致逻辑错误，需在 `onDragOver` 中检查目标路径是否是源路径的子路径
5. **并行上传与 root 变更**: 每次 `fs.write` 都会产生新的 root hash，并行上传时多个请求可能基于不同的 root，需确保 server 端正确处理
6. **Shift+Click 范围选择**: 在排序/过滤后，`lastSelectedIndex` 对应的视觉位置可能变化，需要基于当前渲染列表的索引而非原始数据索引
