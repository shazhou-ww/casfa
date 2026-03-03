# 文本文件 UTF-8 BOM 编码设计

**日期**：2026-03-03  
**状态**：已确认  
**范围**：写入时对 text/* 类型文件添加 UTF-8 BOM，解决浏览器预览/下载中文乱码

---

## 1. 背景与目标

- **问题**：通过 MCP `fs_write` 写入的 .txt 等文本文件在浏览器内预览或下载时出现中文乱码。
- **原因**：存储字节为 UTF-8，但响应未带 charset，浏览器可能按错误编码解析。
- **选型**：采用方案 2——在**写入时**对 `text/*` 类型在内容前添加 UTF-8 BOM（0xEF, 0xBB, 0xBF），便于浏览器/编辑器识别为 UTF-8。

---

## 2. 范围与规则

- **适用写入路径**：**仅 MCP `fs_write`** 对 text/* 添加 UTF-8 BOM。REST `PUT /api/realm/:realmId/files/:path` **不对内容做任何修改**，原样存储请求 body。
- **MCP 约定**：MCP 提供的读写针对 **text/* 文件**，强制 UTF-8 编码；写入时对 text/* 自动添加 BOM 以便浏览器/编辑器正确识别。
- **规则**：仅当 **contentType 为 `text/*`** 时在字节前拼接 UTF-8 BOM；其它类型（`application/octet-stream`、`application/json` 等）不添加。
- **原因**：`text/*` 多为人类可读文本，BOM 有助于识别；JSON 等不加，避免部分解析器报错。

---

## 3. 实现位置

### 3.1 MCP fs_write（必做）

- **文件**：`apps/server-next/backend/mcp/handler.ts`
- **逻辑**：在 `const bytes = new TextEncoder().encode(content)` 之后，若 `contentType.startsWith("text/")`，则构造 `new Uint8Array([0xEF, 0xBB, 0xBF, ...bytes])`，以该 buffer 作为 `data`，`fileSize` 为 `data.length`（含 3 字节 BOM），再调用 `encodeFileNode`；否则沿用原 `bytes`。

### 3.2 REST 上传

- **不修改**：REST 上传保持原样存储，不对 body 做 BOM 或其它编码处理。

---

## 4. 边界与兼容

- **fs_read / GET 返回**：读回的是完整文件字节，内容会包含 BOM。多数浏览器和编辑器能识别并正确显示；如需“无 BOM”的纯文本可在调用方处理或文档说明。
- **非 text/***：不加 BOM，行为不变。
- **已有文件**：不回溯补 BOM，仅对新写入的 text/* 文件生效。

---

## 5. 测试

- 单测或 E2E：`fs_write` 写入中文（contentType `text/plain`），再 `fs_read` 或 `GET /files/:path` 取回；断言前 3 字节为 EF BB BF，解码后中文正确；浏览器打开该 URL 无乱码。

---

## 6. 参考

- 设计前讨论：brainstorming（方案 2：BOM）
- MCP handler：`apps/server-next/backend/mcp/handler.ts`（fs_write）
- Files 控制器：`apps/server-next/backend/controllers/files.ts`（upload、getOrList）
