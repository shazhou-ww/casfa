# Cell MCP 统一发现与执行设计（list + run，渐进式发现）

> 日期: 2026-03-10  
> 状态: 设计已确认，待实现

---

## 1. 目标与背景

### 1.1 目标

- Agent 与所有 MCP 的交互**统一**为：**渐进式发现**（list servers → list tools → 可选 get tool usage）+ **单一执行入口**（run_mcp_tool）。心智上类似 CLI：server = command，tool = subcommand；无需 load/unload。
- **不再保留** scenario 体系：移除 list_mcp_scenarios、load_scenario、unload_scenario，以及按 thread 推导已加载 scenario、LRU、serverId__toolName 注入等。
- **术语**：与 MCP/惯例一致，统一使用 **server** 与 **tool**（不再使用 command/subcommand 作为 API 命名）。

### 1.2 背景与约束

- 范围：所有在 Agent 中配置了 URL 的 MCP（含 Cell 应用如 image-workshop、server-next、agent 等）；cell-cli 若为 stdio 且无 url 则不参与发现。
- Help/用法：不扩展 MCP 协议；用法由 `tools/list`（及可选 `prompts/list`、`prompts/get`）聚合，渐进式在 get_mcp_tools / get_tool_usage 中提供。

---

## 2. 渐进式发现（三层）

| Level | 含义           | Meta 工具              | 说明 |
|-------|----------------|------------------------|------|
| 0     | 发现所有 MCP servers | list_mcp_servers       | 仅列出 server 列表，不拉 tools |
| 1     | 发现某 server 的 tools | get_mcp_tools(serverId) | 对该 server 调 tools/list（及可选 prompts/list） |
| 2     | 发现某 tool 的用法细节 | get_tool_usage(serverId, toolName) | 完整 inputSchema、可选 prompt 正文 |

- 实现上 Level 0 不调用 tools/list，仅基于配置（及可选 initialize）返回 servers；Level 1/2 按需调用 MCP 的 tools/list、prompts/list、prompts/get。
- 可选：Level 1 结果按 serverId 做短期缓存，避免同轮重复拉取。

---

## 3. 元工具 Schema 与数据流

### 3.1 list_mcp_servers（Level 0）

- **描述**：列出所有已配置且带 URL 的 MCP servers，不拉 tools。
- **参数**：无。
- **返回**：`{ servers: Array<{ serverId: string, name?: string, description?: string, unavailable?: boolean, error?: string }> }`
  - serverId 与配置一致；name/description 来自 serverInfo 或配置；某 server 不可达或 401 时可标 unavailable 或带 error，不阻塞其余。

### 3.2 get_mcp_tools(serverId)（Level 1）

- **描述**：列出指定 MCP server 的 tools（及可选 prompts 摘要）。
- **参数**：`serverId: string`（必填）。
- **返回**：`{ serverId, tools: Array<{ name, description?, inputSchema? }>, prompts?: Array<{ name, description? }> }`
  - tools 来自该 server 的 tools/list；prompts 可选来自 prompts/list。单 server 失败返回错误，不抛到整轮。

### 3.3 get_tool_usage(serverId, toolName)（Level 2）

- **描述**：获取某 server 上某 tool 的用法细节（完整 schema、可选 prompt 正文）。
- **参数**：`serverId: string`，`toolName: string`（均必填）。
- **返回**：`{ serverId, toolName, description?, inputSchema?, promptText?: string }`
  - 可从 Level 1 缓存取，或再调 tools/list 定位该 tool；若有关联 prompt 可调 prompts/get 附上正文。

### 3.4 run_mcp_tool(serverId, toolName, arguments)

- **描述**：对指定 server 执行指定 tool。
- **参数**：`serverId: string`，`toolName: string`（必填），`arguments?: object`（可选）。
- **执行**：根据 serverId 找到配置并发 MCP `tools/call`，请求体 `{ name: toolName, arguments: arguments ?? {} }`；结果以 tool-result（含 isError、content）返回。

### 3.5 每轮请求的 tools

- 传给 LLM 的 `tools` 仅包含上述四个元工具：list_mcp_servers、get_mcp_tools、get_tool_usage、run_mcp_tool。
- 数据流：用户消息 → Agent 仅带四个元 tools → LLM 可先 list_mcp_servers → 再 get_mcp_tools(serverId) → 需要时 get_tool_usage(serverId, toolName) → run_mcp_tool(serverId, toolName, arguments) → 多轮直至完成。

---

## 4. 错误与边界

- **list_mcp_servers**：无 url 的配置不返回；某 server 不可达/401 则标 unavailable 或带 error，不阻塞其他。
- **get_mcp_tools**：serverId 不存在或无 url → 明确错误；该 server 的 tools/list 失败 → 返回错误信息。
- **get_tool_usage**：server 或 tool 不存在 → 明确错误；prompts/get 可选，失败则不附 prompt 正文。
- **run_mcp_tool**：serverId/toolName 无效 → 400 类错误；tools/call 失败 → tool-result 中 isError + content，由 LLM 决定重试或提示用户。
- 认证（如 401）与现有 MCP 行为一致；发现阶段某 server 401 可标为需认证，不阻塞其他 server。

---

## 5. Agent 侧删除与保留

### 5.1 删除

- list_mcp_scenarios、load_scenario、unload_scenario 及其 schema 与执行。
- 按 thread 推导已加载 scenario：deriveLoadedScenarios、derive-loaded-scenarios.ts。
- LRU 自动卸载：derive-loaded-scenarios-lru.ts、getLoadedScenariosAfterLru、applyAutoUnload、MAX_LOADED_SCENARIOS 等。
- 按 scenario 注入的 serverId__toolName 的构建与路由：buildToolsAndPromptForThread 中 scenario 相关、getScenarioTools、scenario prompt 注入。
- 仅用于 scenario 的 UI（如 thread 已加载 scenario 的 Load/Unload）可删或改为只读「已发现 servers/tools」展示。
- User 消息中 load_scenario/unload_scenario 的 tool-call 约定。

### 5.2 保留 / 新增

- MCP 配置（mcp.servers）及 OAuth/token 等。
- 四个元工具实现：list_mcp_servers、get_mcp_tools、get_tool_usage、run_mcp_tool；每轮 tools 仅此四项。
- 现有 mcpCall、listTools、listPrompts、getPrompt 等封装；仅用于上述元工具与 run_mcp_tool 的 MCP 调用。
- 可选：get_mcp_tools 结果按 serverId 短期缓存。

---

## 6. Cell 侧（image-workshop、server-next、agent 等）

- **无需改 MCP 协议**。只需已实现标准 `tools/list`（及可选 `prompts/list`、`prompts/get`）。现有 Cell MCP 已满足。
- 若某 Cell 尚未暴露 MCP，则按现有方式增加 HTTP MCP 端点并实现 tools/list 即可纳入 Agent 的渐进式发现与 run_mcp_tool 执行。

---

## 7. 文档与后续

- 本文档记录「统一 list + run、渐进式发现、术语 server/tool」的设计。
- 实现步骤见实现计划（由 writing-plans 产出）。
