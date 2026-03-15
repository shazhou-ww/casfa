# Agent Gateway MCP Unification Design

## Goal

将 Agent 的 MCP 管理完全收敛到 Gateway：

- Agent 不再维护本地 `mcp.servers` 配置和编辑能力。
- Agent 仅通过 Gateway 这一个 MCP 入口工作。
- 直接将 Gateway 元工具注入到 LLM 上下文（通过 `deriveContext` 白名单控制）。
- Agent 设置页中的 MCP 编辑入口改为弹窗打开 Gateway 配置页。

## Confirmed Decisions

- Gateway 元工具白名单（允许注入）：
  - `list_servers`
  - `search_servers`
  - `get_tools`
  - `load_tools`
- 暂不开放：
  - `add_server`
  - `remove_server`
- Agent 本地 MCP 设置页下线，改为跳转 Gateway 配置页（优先弹窗，失败回退同窗口）。

## Current Gap

当前 Agent 仍以内置元工具 `list_mcp_servers/get_mcp_tools/load_tools` 为核心，且 `deriveContext` 只保留这组名称。  
若直接切为 Gateway 元工具而不改白名单，这些工具不会进入模型请求的 `tools` 集合。

## Target Architecture

### 1) Tool Injection Layer (Agent SW)

- `buildToolsAndPromptForThread` 产出工具集合后，`deriveContext` 仅保留：
  - 元工具白名单（Gateway 工具名）
  - 历史 `load_tools` 结果中解析出的 `loadedToolName`
- 白名单改名后，模型将直接看到 Gateway 风格元工具。

### 2) Tool Execution Layer (Agent SW)

- `executeTool` 对上述元工具调用统一路由到 Gateway MCP 服务。
- `load_tools` 返回结构保持兼容，继续输出 `loadedToolName`，确保已加载工具追踪逻辑不变。

### 3) Settings UX Layer (Agent Frontend)

- 移除本地 MCP Server 编辑表单入口。
- MCP 入口替换为“打开 Gateway MCP 配置”按钮：
  - 优先 `window.open(...)` 弹窗；
  - 被拦截则 `location.href = ...` 回退。
- 弹窗关闭后触发一次能力刷新（可选），以更新 Agent 当前视图中的可用工具状态。

## Data Flow

1. 用户发送消息。
2. Agent SW 组装上下文，`deriveContext` 根据白名单保留 Gateway 元工具。
3. 模型发起 `list_servers/search_servers/get_tools/load_tools` 等 tool calls。
4. Agent SW 将调用转发到 Gateway。
5. Gateway 返回结果，Agent 继续保留 `load_tools` 的 `loadedToolName` 追踪行为。
6. 模型后续可直接调用 `loadedToolName` 对应工具。

## Error Handling

- Gateway 不可达：返回统一错误（例如 `Gateway MCP unavailable`），写入 tool-result。
- Gateway 鉴权失效：提示登录 Gateway（而非本地 server OAuth 引导）。
- 工具不存在/参数错误：透传 Gateway 错误，保持可观测性和可调试性。

## Testing Strategy

- Unit:
  - `deriveContext`：白名单仅保留 `list_servers/search_servers/get_tools/load_tools`。
  - `deriveContext`：`load_tools` 结果仍可启用 `loadedToolName` 工具。
- SW Integration:
  - 元工具调用路由到 Gateway（而非本地 `mcp.servers`）。
  - `load_tools -> loaded tool call` 链路可跑通。
- UI:
  - 设置页不再出现本地 MCP 编辑器。
  - 点击入口可打开 Gateway 配置页（含弹窗失败回退）。

## Migration Plan (Low-Risk Sequence)

1. 更新 `deriveContext` 白名单与系统提示词中的元工具命名。
2. 将元工具执行逻辑改为 Gateway 路由，保持 `load_tools` 结果形状兼容。
3. 下线本地 MCP 编辑 UI，替换为 Gateway 配置页跳转入口。
4. 补齐测试与文档，完成联调验收。

## Out of Scope

- 本阶段不开放模型直接使用 `add_server/remove_server`。
- 不在 Agent 侧保留 Gateway 之外的多源 MCP 配置模型。
