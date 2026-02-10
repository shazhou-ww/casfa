# Iteration 2 — 文件操作

**主题**: 上传、创建文件夹、删除、重命名、右键菜单、权限感知、错误处理

**前置依赖**: Iter 1

**覆盖用例**: W-1~W-8, S-4, P-1, P-5, U-1~U-4

---

## 目标

迭代结束时，`<CasfaExplorer />` 在 Iter 1 基础上新增：
1. 工具栏上传按钮 + 拖拽上传，单文件 ≤4MB 限制
2. 上传进度面板（队列式）
3. 创建文件夹对话框
4. 删除（单个 + 批量）+ 确认对话框
5. 重命名对话框
6. 右键菜单（文件/文件夹/空白区域三套）
7. 权限感知 — 只读模式自动隐藏写操作 UI
8. 全局错误提示
9. `extraContextMenuItems` / `extraToolbarItems` 扩展点

---

## 任务分解

### 2.1 上传入口

| 任务 | 说明 |
|------|------|
| Toolbar "Upload" 按钮 | MUI `Button` + `CloudUpload` 图标，点击触发 hidden `<input type="file" multiple>` |
| 文件大小校验 | 选取后逐个检查 `file.size ≤ 4MB`，超限文件跳过并提示 |
| 调用 `client.fs.write()` | 逐文件上传至 `currentPath + '/' + file.name` |
| 上传后刷新 | 写入成功后调用 `store.refresh()` 更新目录列表 |

**验收**: 点击上传按钮，选择文件后成功写入 depot，目录列表即时刷新

### 2.2 拖拽上传覆盖层

| 任务 | 说明 |
|------|------|
| `<UploadOverlay>` 组件 | 半透明覆盖层 + 虚线边框 + "释放以上传" 文案 |
| 事件处理 | `onDragEnter` 显示覆盖层，`onDragLeave` 隐藏，`onDrop` 提取 `DataTransfer.files` |
| 复用上传逻辑 | 提取公共 `uploadFiles(files: File[])` 函数，按钮上传和拖拽上传共用 |
| 嵌套 dragenter 处理 | 使用 ref 计数器防止子元素触发误关闭 |

**验收**: 从桌面拖拽文件到浏览区域，显示覆盖层反馈，释放后文件上传

### 2.3 `<UploadProgress>` 面板

```ts
// 上传队列项类型
interface UploadQueueItem {
  id: string;                // 唯一标识（nanoid）
  file: File;
  targetPath: string;
  status: 'pending' | 'uploading' | 'done' | 'error';
  error?: string;
}
```

| 任务 | 说明 |
|------|------|
| 队列数据结构 | `store.uploadQueue: UploadQueueItem[]`，FIFO 顺序处理 |
| 面板 UI | 底部抽屉或浮动面板，MUI `LinearProgress` 显示当前文件进度 |
| 每项操作 | 取消（pending 项移除）、重试（error 项重新排队） |
| 自动消费队列 | 队列非空时自动依次上传，一个完成再开始下一个 |
| 收起/展开 | 折叠为 mini bar 显示 "正在上传 3/10" 概要 |

**验收**: 多文件上传时队列依次处理，可取消待传项、重试失败项

### 2.4 创建文件夹

| 任务 | 说明 |
|------|------|
| Toolbar 按钮 | "新建文件夹" 图标按钮 |
| `<CreateFolderDialog>` | MUI `Dialog`，包含 `TextField` 输入文件夹名 |
| 名称校验 | 空字符串、已存在同名、非法字符（`/`, `\0`）实时校验并提示 |
| 调用 `client.fs.mkdir()` | 在 `currentPath` 下创建子目录 |
| 完成后聚焦 | 创建成功后刷新列表并高亮新文件夹 |

**验收**: 输入合法名称后成功创建文件夹；非法名称显示行内错误

### 2.5 删除

| 任务 | 说明 |
|------|------|
| `<ConfirmDialog>` | 通用确认对话框，显示 "确认删除 N 个项目？此操作不可撤销" |
| 单个删除 | 右键菜单 "删除" 或 `Delete` 键触发 |
| 批量删除 | 多选后触发，串行调用 `client.fs.rm()` 逐个删除 |
| 错误汇总 | 批量中部分失败时，汇总显示 "成功 5 项，失败 2 项" + 失败详情 |
| 刷新 | 删除完成后刷新目录 |

**验收**: 单个删除确认后成功移除；批量删除中部分失败有汇总提示

### 2.6 重命名

| 任务 | 说明 |
|------|------|
| `<RenameDialog>` | MUI `Dialog`，预填当前名称，`TextField` 可编辑 |
| 触发方式 | 右键菜单 "重命名" 或 `F2` 快捷键 |
| 名称校验 | 同 2.4（空/重名/非法字符） |
| 调用 `client.fs.mv()` | `mv(depotId, oldPath, newPath)`，路径仅末段不同 |

**验收**: 重命名后列表刷新，文件位置正确更新

### 2.7 右键菜单

```tsx
// 菜单项类型
interface ExplorerMenuItem {
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;           // 显示的快捷键文本
  onClick: (ctx: MenuContext) => void;
  disabled?: boolean;
  hidden?: boolean;
  dividerAfter?: boolean;
}

interface MenuContext {
  selectedItems: ExplorerItem[];
  currentPath: string;
  depotId: string;
}
```

| 任务 | 说明 |
|------|------|
| `<ContextMenu>` | 基于 MUI `Menu` + `MenuItem`，`onContextMenu` 触发 |
| 文件右键 | 打开、剪切、复制、重命名、删除、下载、复制 CAS URI、属性 |
| 文件夹右键 | 打开、剪切、复制、粘贴（有剪贴板时）、重命名、删除、新建文件夹、上传到此目录 |
| 空白区域右键 | 粘贴、新建文件夹、上传文件、刷新 |
| 多选右键 | 删除、剪切、复制（不可重命名） |
| 权限控制 | 写操作项根据 `canUpload` 动态 hidden |

> 本迭代实现菜单框架和已有操作的连接；剪切/复制/粘贴/下载/CAS URI 等菜单项先显示为 disabled，后续迭代启用。

**验收**: 三种右键菜单正确显示对应菜单项；菜单项点击触发对应操作

### 2.8 权限感知

| 任务 | 说明 |
|------|------|
| 查询 delegate 信息 | 组件初始化时通过 `client` 获取当前 delegate 的 `canUpload` / `canManageDepot` |
| `canUpload = false` 时 | 隐藏上传按钮、隐藏新建文件夹按钮 |
|  | 禁用删除/重命名菜单项（灰色 + tooltip "权限不足"） |
|  | 右键菜单只保留只读操作（打开、下载、复制 CAS URI、属性） |
| store 扩展 | `permissions: { canUpload, canManageDepot }` |
| 403 动态更新 | 写操作收到 403 时更新本地权限状态，避免后续请求 |

**验收**: 以只读 delegate 登录时，所有写操作 UI 不可见/不可用

### 2.9 Store 扩展

```ts
// 在 Iter 1 的 ExplorerState 基础上新增
interface ExplorerStateIter2 extends ExplorerState {
  // 上传队列
  uploadQueue: UploadQueueItem[];
  addToUploadQueue(files: File[]): void;
  cancelUpload(id: string): void;
  retryUpload(id: string): void;

  // 操作状态
  operationLoading: Record<string, boolean>;  // key: operation type
  setOperationLoading(op: string, loading: boolean): void;

  // 权限
  permissions: {
    canUpload: boolean;
    canManageDepot: boolean;
  };
  fetchPermissions(): Promise<void>;

  // 错误
  lastError: ExplorerError | null;
  setError(error: ExplorerError | null): void;

  // 刷新
  refresh(): Promise<void>;
}
```

**验收**: 所有新增 state 和 action 有单元测试

### 2.10 错误处理

```ts
interface ExplorerError {
  type: 'network' | 'permission' | 'file_too_large' | 'name_conflict' | 'not_found' | 'auth_expired' | 'unknown';
  message: string;
  detail?: string;
}
```

| 任务 | 说明 |
|------|------|
| `<ErrorSnackbar>` | MUI `Snackbar` + `Alert`，根据 error type 显示不同 severity |
| 错误分类 | 网络错误 → "网络不可用"，403 → "权限不足"，文件过大 → "文件过大（最大 4MB）"，409 → "名称冲突" |
| `onError` 回调 | 每次错误同时调用 `props.onError(error)`，宿主应用可自行处理 |
| 自动消失 | Snackbar 默认 5s 自动关闭，可手动关闭 |

**验收**: 各类错误场景均显示对应提示，`onError` 回调被调用

### 2.11 `extraContextMenuItems` 扩展点

| 任务 | 说明 |
|------|------|
| Props 定义 | `extraContextMenuItems?: ExplorerMenuItem[]` |
| 渲染位置 | 内置菜单项之后，通过 `Divider` 分隔 |
| 上下文传递 | 自定义菜单项的 `onClick` 接收 `MenuContext` |

```tsx
// 使用示例
<CasfaExplorer
  client={client}
  extraContextMenuItems={[
    {
      label: "在编辑器中打开",
      icon: <EditIcon />,
      onClick: (ctx) => openInEditor(ctx.selectedItems[0]),
    },
    {
      label: "分享链接",
      icon: <ShareIcon />,
      onClick: (ctx) => shareFile(ctx.selectedItems[0]),
    },
  ]}
/>
```

**验收**: 自定义菜单项出现在右键菜单底部，点击可正确执行

### 2.12 `extraToolbarItems` 扩展点

| 任务 | 说明 |
|------|------|
| Props 定义 | `extraToolbarItems?: ExplorerToolbarItem[]` |
| 渲染位置 | 工具栏右侧，内置按钮之后 |
| 类型定义 | `{ label, icon, onClick, disabled?, tooltip? }` |

```ts
interface ExplorerToolbarItem {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tooltip?: string;
}
```

**验收**: 自定义工具栏按钮正确渲染并可交互

---

## 文件结构（迭代结束时）

```
packages/explorer/src/
├── index.ts
├── types.ts                          # 扩展 ExplorerError, UploadQueueItem 等
├── core/
│   └── explorer-store.ts             # 扩展: uploadQueue, permissions, error
├── hooks/
│   ├── use-explorer-context.ts
│   └── use-upload.ts                 # 上传逻辑 hook
├── i18n/
│   ├── en-US.ts                      # 新增操作相关文案
│   └── zh-CN.ts
└── components/
    ├── CasfaExplorer.tsx
    ├── DepotSelector.tsx
    ├── ExplorerShell.tsx
    ├── ExplorerToolbar.tsx            # 扩展: 上传、新建文件夹按钮, extraToolbarItems
    ├── Breadcrumb.tsx
    ├── FileList.tsx
    ├── StatusBar.tsx
    ├── UploadOverlay.tsx              # [NEW] 拖拽上传覆盖层
    ├── UploadProgress.tsx             # [NEW] 上传进度面板
    ├── ContextMenu.tsx                # [NEW] 右键菜单
    ├── ConfirmDialog.tsx              # [NEW] 确认对话框
    ├── RenameDialog.tsx               # [NEW] 重命名对话框
    ├── CreateFolderDialog.tsx         # [NEW] 新建文件夹对话框
    └── ErrorSnackbar.tsx              # [NEW] 全局错误提示
```

---

## 风险 & 注意事项

1. **上传大小限制**: 当前 single-block 限制 4MB，前端需在选文件时立即校验，避免上传后服务端 413 错误。后续支持 multi-block 时需要扩展上传逻辑
2. **批量删除串行调用**: 逐个调用 `fs.rm()` 在大量文件时较慢，Iter 5 引入 `fs.rewrite()` 批量操作后可优化
3. **权限缓存与更新**: delegate 权限在组件生命周期内可能变更（如管理员修改），需确保 403 响应时更新本地权限状态
4. **拖拽事件冒泡**: `dragenter`/`dragleave` 在嵌套 DOM 中容易误触发，需使用计数器或 `relatedTarget` 判断
5. **文件名校验**: 不同操作系统对文件名的限制不同，此处仅校验 CAS 路径规则（不含 `/`、`\0`），不做操作系统级校验
6. **右键菜单暂存**: 剪切/复制/粘贴在本迭代仅显示菜单项（disabled），实际剪贴板逻辑在 Iter 4 实现
