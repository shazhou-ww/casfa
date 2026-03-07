# MCP Prompt Bundle Design

## Problem

image-workshop 的 MCP skill（作为 resource 注册）使用 `readFileSync` 在运行时读取 `.md` 文件。部署到 Lambda 后，esbuild bundle 不包含这些文件，导致运行时找不到文件。

## Decision

1. 将 MCP resource（skill）语义改为 MCP **prompt** — prompt 更准确地描述了用途：为 agent 提供标准使用场景的模板化指令。
2. 使用 esbuild **text loader** 在构建时将 `.md` 文件内联为字符串，彻底消除运行时文件系统依赖。
3. 使用 **Mustache** 模板引擎，支持 prompt 参数化。
4. Binary 资源不在此方案范围内 — 走外部存储（S3）运行时拉取。

## Changes

### 1. cell-cli `build.ts` — 通用 `.md` text loader

在 esbuild 配置中添加 `loader: { ".md": "text" }`，所有 cell app 自动获得 `.md` import 能力。

### 2. TypeScript 声明

在项目根目录添加 `declarations/text-imports.d.ts`：

```typescript
declare module "*.md" {
  const content: string;
  export default content;
}
```

并确保 `tsconfig.cell-backend.json` 的 `include` 覆盖该声明文件。

### 3. image-workshop 改动

- 目录：`backend/skills/` → `backend/prompts/`
- 模板：`flux-image-gen.md` 改为 Mustache 模板，使用 `{{param}}` 占位符
- 依赖：添加 `mustache` npm 包
- 代码：
  - 移除 `node:fs`、`node:path`、`fileURLToPath` 导入
  - 改为 `import fluxImageGenPrompt from "./prompts/flux-image-gen.md"`
  - 保留 `server.registerResource()`，数据源从 `readFileSync` 切换为 import 的字符串
  - 新增 `server.registerPrompt()` + Mustache 渲染
  - prompt 接受参数（如 `casfaBaseUrl` 等），渲染模板后返回

### 4. 注册示例

```typescript
import Mustache from "mustache";
import fluxImageGenPrompt from "./prompts/flux-image-gen.md";

// Resource — 原始模板可下载
server.registerResource(
  "FLUX Image Generation",
  "prompt://flux-image-gen",
  { description: "Prompt template for FLUX image generation", mimeType: "text/markdown" },
  async () => ({
    contents: [{ uri: "prompt://flux-image-gen", mimeType: "text/markdown", text: fluxImageGenPrompt }],
  })
);

// Prompt — 参数化渲染
server.registerPrompt("flux-image-gen", {
  description: "Generate images from text prompts using BFL FLUX",
  argsSchema: {
    casfaBaseUrl: z.string().describe("Casfa server base URL"),
    // ...
  },
}, async (args) => ({
  messages: [{
    role: "user",
    content: { type: "text", text: Mustache.render(fluxImageGenPrompt, args) },
  }],
}));
```

## Constraints

- Prompt 模板仅限文本（`.md`），binary 走外部存储
- Mustache logic-less 设计匹配 prompt 简单性
- esbuild text loader 是通用能力，不限于 image-workshop
