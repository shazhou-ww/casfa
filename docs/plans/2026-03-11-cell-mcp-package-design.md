# Cell MCP 公共包设计（Builder + Zod）

> 日期: 2026-03-11  
> 状态: 设计待确认

---

## 1. 目标与范围

- **目标**：在 cell 内标准支持 MCP，每个 cell 的 MCP = 一个 command，每个 tool = subcommand；提取公共 **cell-mcp** package，用 **Builder 模式** 标准化 MCP 服务创建，基于 **标准 MCP SDK**（`@modelcontextprotocol/sdk`）。
- **范围**：
  - 仅 **HTTP**（POST /mcp，WebStandardStreamableHttp）；不包含 stdio。
  - **内建可选 auth 钩子**（未通过时 401/403）。
  - **Zod 泛型输入校验**：每个 tool 支持 `z.ZodType<T>`，在调用 handler 前统一校验，校验失败时返回清晰错误（field + message）。
  - **标准化 help 信息**：本期不做，后续再定方案。

---

## 2. 包与依赖

- **包名**：`@casfa/cell-mcp`（`packages/cell-mcp`）。
- **依赖**：`@modelcontextprotocol/sdk`（与现有 image-workshop、cell-cli 同版本）、`zod`、`hono`（仅类型，用于 `Context` 与 auth 钩子）。
- **导出**：Builder 实例类型、`createCellMcpServer` 工厂、以及 `registerTool` 泛型 API 与 ToolResult 等类型。

---

## 3. Builder API

### 3.1 创建 Server

```ts
import { createCellMcpServer } from "@casfa/cell-mcp";

const cellMcp = createCellMcpServer({
  name: "image-workshop",      // 对应 cell 的 command 名，建议与 cell.yaml name 一致
  version: "0.1.0",
  authCheck: async (c) => {
    const auth = c.get("auth");
    if (!auth) return false;
    if (auth.type === "user") return true;
    return auth.permissions?.includes("use_mcp") ?? false;
  },
  onUnauthorized: (c) => c.json({ error: "Unauthorized" }, 401),
});
```

- **authCheck**：可选；`(c: HonoContext) => boolean | Promise<boolean>`。为 false 时走 **onUnauthorized**。
- **onUnauthorized**：可选；`(c: HonoContext) => Response`。不提供时使用默认 401 JSON 响应。

### 3.2 注册 Tool（Zod 泛型 + 输入校验）

```ts
cellMcp.registerTool(
  "flux_image",
  {
    description: "Generate an image from a text prompt using BFL FLUX...",
    inputSchema: fluxImageInputSchema,  // z.ZodType<FluxImageArgs>
  },
  async (args: FluxImageArgs) => {
    // args 已通过 zod 校验，类型安全
    const result = await handleFluxImage(args);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);
```

- **泛型**：`registerTool<T>(name, { description, inputSchema: z.ZodType<T> }, handler: (args: T) => ToolResult | Promise<ToolResult>)`。
- **输入校验**：在调用 handler 前对 `tools/call` 的 `arguments` 做 `inputSchema.safeParse(arguments)`：
  - **成功**：调用 `handler(parsed.data)`，返回 MCP 标准 `CallToolResult`（content / isError）。
  - **失败**：不调用 handler，直接返回 `isError: true`，`content` 为工具名 + 本次校验错误列表（field + message），便于 LLM 重试或提示用户。
- **inputSchema 透传**：底层仍用 MCP SDK 的 `registerTool`；Zod schema 由 SDK 转为 JSON Schema（SDK 已支持 zod），cell-mcp 不重复实现转换，仅在执行时做一次 safeParse。

### 3.3 注册 Resource / Prompt

- **registerResource**：与 MCP SDK 对齐，`(name, uri, options, handler)`，透传到内部 `McpServer`。
- **registerPrompt**：同上，透传。
- 用于 cell 暴露 skill 或 prompt 模板（如 image-workshop 的 `prompt://flux-image-gen`）。

### 3.4 挂载路由

```ts
const route = cellMcp.getRoute();  // Hono 的 sub-App 或 handler，挂 POST /mcp
app.route("/", route);             // 或 app.post("/mcp", route)
```

- **getRoute()**：返回可在 Hono 上挂到 `POST /mcp` 的路由；内部：若提供 authCheck 则先执行，未通过则 onUnauthorized；通过则 `WebStandardStreamableHTTPServerTransport` + `server.connect(transport)` + `transport.handleRequest(req)`。
- 每个请求可 `new Transport` + `server.connect`，与 image-workshop 当前用法一致；或根据 MCP SDK 建议做单例 session（以 SDK 文档为准）。

---

## 5. 类型与错误约定

- **ToolResult**：与 MCP 一致，`{ content: Array<{ type: "text", text: string }>, isError?: boolean }`。
- **校验错误**：`safeParse` 失败时，不抛异常，而是返回 `{ content: [{ type: "text", text: errorText }], isError: true }`，errorText 包含 tool name 以及 `error.issues` 的简明列表（field + message）。
- **handler 抛错**：若 handler 内部 throw，cell-mcp 可捕获并转为 `{ content: [{ type: "text", text: message }], isError: true }`，与现有 image-workshop 行为一致。

---

## 6. 与现有 Cell 的关系

- **image-workshop**：可迁到 cell-mcp：用 `createCellMcpServer` + `registerTool("flux_image", { inputSchema: fluxImageInputSchema }, handleFluxImage)` + 现有 `registerResource` / `registerPrompt` 透传或迁移；认证用 authCheck + onUnauthorized。
- **server-next**：若后续从手写 JSON-RPC 迁到 MCP SDK，可同样用 cell-mcp Builder，把现有 MCP_TOOLS 逐个改为 registerTool + Zod schema，并统一走校验。
- **cell-cli**：保持 stdio 独立实现，不依赖 cell-mcp（cell-mcp 仅 HTTP）。

---

## 7. 实现要点小结

| 项 | 说明 |
|----|------|
| 包 | `packages/cell-mcp`，依赖 @modelcontextprotocol/sdk、zod、hono（类型） |
| Builder | createCellMcpServer({ name, version, authCheck?, onUnauthorized? }) |
| registerTool | 泛型 registerTool&lt;T&gt;(name, { description, inputSchema: z.ZodType&lt;T&gt; }, handler)；执行前 safeParse，失败则返回 isError + 错误列表（field + message） |
| registerResource / registerPrompt | 透传至内部 McpServer |
| getRoute() | Hono 路由：authCheck → WebStandardStreamableHTTPServerTransport → MCP |
| 校验错误 | 不抛异常，返回 isError + 工具名 + issues 列表（field + message） |

---

## 8. 后续

- 设计确认后：写入实现计划（writing-plans），再实现 packages/cell-mcp 并迁移 image-workshop（可选先迁一个 tool 验证）。
