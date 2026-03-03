# 文件上传（UI + MCP）设计

**日期**：2026-03-03  
**状态**：已确认  
**范围**：UI 上传（按钮 + 拖拽）、MCP fs_write（仅文本）

---

## 1. 范围与交付物

- **UI**：在文件页（ExplorerPage / DirectoryTree）增加「上传」按钮与拖拽上传；调用现有 `PUT /api/realm/:realmId/files/:path`；单文件 ≤4MB；成功后刷新当前目录列表。
- **MCP**：新增 tool `fs_write`，参数 `path`（必填）、`content`（必填，字符串）、`contentType`（可选，默认 `text/plain`）；仅写文本（UTF-8）；需 `file_write` 权限；与现有 `fs_*` 路径规范一致。

---

## 2. UI 上传

### 2.1 入口

- 在现有 Toolbar 中「新建文件夹」左侧或右侧增加「上传」按钮（MUI Button + CloudUpload 图标），点击触发隐藏的 `<input type="file" multiple />`。

### 2.2 拖拽

- 在列表区域外包一层拖拽监听（`onDragEnter` / `onDragLeave` / `onDrop`）；拖入时显示半透明覆盖层 +「释放以上传」文案；用 ref 计数处理子元素导致的 dragenter/leave 抖动。

### 2.3 逻辑

- 选文件或 drop 后，对每个文件：路径 = `currentPath + '/' + fileName`（根目录时 `'/' + fileName`）。
- 前端校验 `file.size <= 4*1024*1024`，超限跳过并 Snackbar 提示。
- 调用 `uploadFile(path, file)` → 内部 `PUT /api/realm/:realmId/files/:path`，body 为 `file`，Header `Content-Type: file.type || 'application/octet-stream'`。
- 全部完成后刷新列表（现有 `loadEntries` / `refreshKey`）。

### 2.4 前端 API

- 在 `apps/server-next/frontend/src/lib/fs-api.ts` 新增 `uploadFile(path: string, file: File): Promise<void>`。
- 使用现有 `apiFetch` 与 `filesBaseUrl()`；路径规范化与 `normalizedPathSegments` 一致（path 必须包含文件名）。

---

## 3. MCP fs_write

### 3.1 Tool 定义

- **name**：`fs_write`
- **description**：写文本文件到指定路径（UTF-8），创建或覆盖；单文件 ≤4MB；仅文本内容。

### 3.2 inputSchema

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| path | string | 是 | 文件路径（含文件名） |
| content | string | 是 | 文本内容（UTF-8） |
| contentType | string | 否 | 默认 `text/plain`，如 `text/markdown`、`application/json` |

### 3.3 行为

- 校验 `hasFileWrite(auth)`。
- 取 `getCurrentRoot(auth, deps)`；path 规范化（去首尾斜杠）。
- 用 `TextEncoder` 将 content 转为 `Uint8Array`；若 `bytes.length > 4*1024*1024` 返回 MCP 参数错误。
- 复用与 `files.upload` 相同的写入链：`encodeFileNode` → `cas.putNode` → `addOrReplaceAtPath` → `branchStore.setBranchRoot(delegateId, newRootKey)`。
- 成功返回 `{ path }` 等简要信息。

### 3.4 错误

- 无 file_write → 明确错误信息。
- path 为空或非法 → 400 类参数错误。
- 内容超 4MB → 参数错误并说明上限。
- Realm 未初始化 → 与现有 fs_mkdir 等一致返回「Realm not initialized...」。
- contentType 长度与后端一致（如 256 字节），超长返回参数错误。

---

## 4. 错误与边界

- **UI**：未登录或 realm 未初始化时上传按钮可禁用或隐藏；网络/4xx/5xx 用 Snackbar 提示；重复文件名视为覆盖（与后端 PUT 语义一致）。
- **MCP**：与现有 fs_* 错误风格一致；contentType 超长返回参数错误。

---

## 5. 测试

- **E2E**：现有 `apps/server-next/tests/files.test.ts` 已有 upload 用例；可加一条通过 API 断言上传后列表包含新文件。
- **MCP**：在 `apps/server-next/tests/mcp.test.ts` 中增加 `tools/call` `fs_write`（path + content），再 `fs_read` 或 `fs_stat` 校验内容/存在。

---

## 6. 参考

- 后端上传：`apps/server-next/backend/controllers/files.ts`（`upload`）
- 前端文件页：`apps/server-next/frontend/src/components/explorer/directory-tree.tsx`、`apps/server-next/frontend/src/lib/fs-api.ts`
- MCP handler：`apps/server-next/backend/mcp/handler.ts`
- 设计前文档：`docs/plans/2026-03-03-server-next-missing-features-design.md`（本阶段原不做上传，本文档补上）
