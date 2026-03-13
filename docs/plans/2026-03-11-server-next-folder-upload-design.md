# server-next 拖拽上传文件夹 — 设计

## 1. 目标与约束

**目标**：在 server-next 文件浏览器中支持「拖拽上传文件夹」和「上传按钮选择文件夹」，保留目录结构；单次上传有数量与深度限制，并显示进度；不支持时降级为仅选文件，且与现有上传共用一个按钮。

**约束**：

- 后端不新增接口，仅使用现有 `PUT /api/realm/:realmId/files/:path` 与 `POST .../fs/mkdir`。
- 单文件仍 ≤ 4MB；单次上传总文件数 ≤ 500，路径深度 ≤ 10（相对当前目录）。
- 进度在前端用 state 表示（total / done），UI 显示「正在上传 x/y…」或进度条；全部完成或失败后关闭。
- 一个上传入口：支持文件夹时可选文件或文件夹（通过 picker 的配置体现）；不支持时只能选文件，不弹错误提示。

**不做的**：后端批量上传接口、断点续传、队列持久化。

---

## 2. 数据流与逻辑

### 收集阶段

- **拖拽**：在 `handleDrop` 中不再只用 `e.dataTransfer.files`。若存在 `e.dataTransfer.items`，遍历 `DataTransferItem`，对每个 `item.webkitGetAsEntry()`（存在时）判断是目录还是文件；目录则递归遍历（`FileSystemDirectoryEntry.createReader().readEntries()`），对每个文件用 `entry.file()` 得到 `File`，并记录相对路径（如 `folder/sub/file.txt`）。根名取第一个顶层目录名（或单文件时用文件名）。若浏览器不支持 `webkitGetAsEntry`，则回退为当前逻辑：用 `e.dataTransfer.files`，扁平上传、不保留结构。
- **按钮**：共用一个「上传」按钮。检测是否支持 `webkitdirectory`。支持时：点击先触发带 `webkitdirectory` 的 input，用户可选一个或多个文件夹，通过 `input.files` 的 `File.webkitRelativePath` 得到路径，得到 `{ relativePath, file }[]`。不支持时：点击触发仅 `multiple` 的 input，只选文件，得到扁平文件列表。不增加第二个按钮，仅通过 input 属性区分能力。

### 校验阶段

- 在开始上传前统一校验：总文件数 ≤ 500；每个相对路径按 `/` 分割后长度 ≤ 10；每个 `file.size` ≤ 4MB。任一项不满足则本次不上传，Snackbar 提示具体原因（如「超过 500 个文件」/「路径过深」/「xxx 超过 4MB」）。

### 执行阶段

- 以「当前目录」为基路径（`currentPath` 归一化）。对收集到的 `{ relativePath, file }[]` 按路径排序，提取所有唯一父目录，去重后按字典序依次调用 `createFolder(basePath, ...)` 创建目录；再对每个文件调用 `uploadFile(basePath + '/' + relativePath, file)`。上传并发限制为 2（或 3），用队列或 Promise 控制。
- 进度：用 state 维护 `{ total, done }`，每完成一个文件（成功或跳过）`done += 1`；UI 显示「正在上传 done/total…」并在 total > 1 时显示进度条；全部结束后关闭进度、刷新列表、Snackbar 汇总。

### 与现有逻辑的衔接

- 现有「多选文件」扁平上传（`doUploadFiles(files)`）保留：当收集结果为纯扁平文件列表（无相对路径或路径无 `/`）时，仍走现有循环上传逻辑，可与文件夹上传共用同一套进度与上限校验（总文件数 ≤ 500、单文件 ≤ 4MB）。

---

## 3. UI 与错误处理

### 单按钮与 Picker

- 工具栏保留一个「上传」按钮。点击时：若支持 `webkitdirectory`，触发带 `webkitdirectory` 的 `<input type="file" webkitdirectory multiple>`；否则触发 `<input type="file" multiple>`。两个 input 可并存，通过 ref 或状态决定当前触发哪一个；降级仅通过「当前触发哪个 input」体现。

### 进度 UI

- 上传进行中（total ≥ 1 且 done < total）时，在列表上方或工具栏下方显示进度条或文字「正在上传 3/50…」，可选「取消」（中止后续队列，已发出的请求不撤销）。全部完成或取消后，关闭进度、刷新列表、Snackbar 显示「已上传 N 个文件」或错误信息。

### 拖拽区域与提示

- 现有拖拽区域不变；当检测到本次 drop 包含目录（通过 `webkitGetAsEntry`）且收集到带层级的路径时，按「文件夹上传」流程处理；否则按当前扁平文件逻辑。悬停提示可保持「释放以上传」。

### 错误处理

- **校验失败**：超过 500 个文件、路径深度 > 10、或任一文件 > 4MB → 不上传，Snackbar 提示具体原因。
- **mkdir 失败**：某个 `createFolder` 报错 → 中止本次上传，Snackbar 提示该错误，已上传文件保留（不自动回滚）。
- **uploadFile 失败**：某个文件上传失败 → 记录错误，继续上传其余文件；全部结束后 Snackbar 汇总（如「已上传 48 个，2 个失败：xxx」）；若全部失败则只提示失败原因。
- **不支持文件夹**：不弹窗提示；按钮仍可用，只是触发的 input 只能选文件。

### 边界

- **空文件夹**：若选择/拖入的是空文件夹（收集后文件数为 0，但有一个顶层目录名）：在当前目录下创建同名文件夹，即调用 `createFolder(currentPath, folderName)` 一次；Snackbar 提示「已创建文件夹 xxx」或「已上传」。若既没有文件也没有任何目录名，再按「未选择文件」静默或轻提示处理。
- **多个顶层目录**：拖入多个文件夹或 webkitdirectory 多选时，所有文件合并为一组，相对路径以各自根目录名为前缀（如 `FolderA/a.txt`, `FolderB/b.txt`），统一做 500/10/4MB 校验与上传。

---

## 4. 测试要点（建议）

- 拖拽单个文件夹（含子目录）→ 结构保留、进度显示、成功后刷新。
- 拖拽多个文件（无目录）→ 行为与当前一致，可复用进度与 500/4MB 校验。
- 点击上传并选择文件夹（支持时）→ 同拖拽文件夹；不支持时仅选文件。
- 总文件数 > 500 或路径深度 > 10 或单文件 > 4MB → 不上传，提示明确。
- 空文件夹选择/拖入 → 创建同名空目录并提示。
- 单个 mkdir 或 upload 失败 → 按上文错误处理表现。

**Implemented by:** [2026-03-11-server-next-folder-upload-plan.md](2026-03-11-server-next-folder-upload-plan.md)
