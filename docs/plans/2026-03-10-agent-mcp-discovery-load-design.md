# Agent MCP 发现、加载、卸载设计（Scenario 粒度）

## 1. 目标与范围

**目标**

- Agent 通过 **tools** 发现、加载、卸载 MCP 的**使用场景（scenario）**；加载后该 scenario 的 tools 可供 LLM 调用，并将 scenario 的 **prompt** 注入上下文。
- **已加载状态**按 **thread** 维度、**仅从历史推导**：不单独存储「已加载 scenarios」；由该 thread 消息中的 `load_scenario` / `unload_scenario`（含 user 与 assistant 的 tool-call）按时间顺序推导。
- 支持**用户手动开关**：user 消息允许与 assistant 相同的 **tool-call / tool-result** content；UI 可发 user tool-call 表示 load/unload scenario。
- **卸载**：提供 `unload_scenario` tool（LLM 主动卸）+ **自动上限**（如最大加载 scenario 数），超限时按 **LRU（Least Recently Used）** 自动卸 scenario，并可选择通知 LLM。

**粒度**

- 发现与加载以 **scenario** 为粒度，不以 MCP server 为粒度。一个 scenario = 一个 MCP 上的一个 prompt（一条使用场景）；`list_mcp_scenarios` 返回所有 MCP 的 scenarios；load/unload 针对 scenario。

**范围（第一阶段）**

- 只做 **tools + scenario prompts**：发现 scenarios（prompts/list）、按 scenario 加载（tools 子集 + prompt 内容）、卸载、执行 MCP tools；resources 后续再做。
- 持久化：不新增「已加载列表」存储；若后端/API 当前不允许 user 消息带 tool-call，则扩展为允许。

**不包含**

- 跨设备同步「已加载」的专门逻辑（推导随消息同步）；resources 的 load/unload。

---

## 2. 数据模型与推导

### 2.1 User 消息可带 tool-call / tool-result

- 现有 `MessageContent` 已含 `ToolCallContent`、`ToolResultContent`。
- **约定**：`role: "user"` 的 message 的 `content` 数组也可包含 `type: "tool-call"` 与 `type: "tool-result"`，语义与 assistant 一致。
- 后端若当前只接受 user 的 text：扩展为接受 `content` 中合法 `MessageContent`（含 tool-call / tool-result），原样存储与同步。

### 2.2 推导「当前 thread 已加载的 scenarios」

- **输入**：该 thread 的 messages（按 `createdAt` 升序）、当前配置的 MCP 列表（settings 的 `mcp.servers`）。
- **规则**：维护集合 `loaded: Set<string>`，每个元素为 **scenario 唯一标识**，建议 `{serverId}#{promptName}` 或 `{serverId}#{promptId}`。按时间顺序遍历每条 message（不区分 user/assistant）：
  - 遍历该 message 的 `content`；
  - 若为 `type: "tool-call"` 且 `name === "load_scenario"`：从 `arguments` 解析出 `serverId`、`scenarioId`（或 prompt name），若该 scenario 在对应 server 的 prompts/list 中存在，则 `loaded.add(scenarioKey)`；
  - 若为 `type: "tool-call"` 且 `name === "unload_scenario"`：解析并 `loaded.delete(scenarioKey)`；
  - 其它 content 不改变 `loaded`。
- **输出**：`loaded` 为该 thread 当前已加载的 scenario 集合，用于本轮回合传给 LLM 的 tools 列表、scenario prompt 注入、以及自动卸载判断。

### 2.3 不新增持久化

- 不增加「已加载 scenarios」的存储或后端表/字段；状态完全由历史 + `mcp.servers` 推导。

---

## 3. Scenario 发现与 Scenario–Tools 对应（方案 A）

### 3.1 list_mcp_scenarios（Agent 元 tool）

- **描述**：列出所有已配置 MCP 的**使用场景**，并标明当前 thread 已加载哪些。
- **实现**：对每个 `mcp.servers` 中的 server 调用 `prompts/list`；可选对每个 server 调用 `tools/list` 以便后续绑定。汇总为 scenario 列表，每个 scenario 含：`serverId`、`scenarioId`（或 prompt name）、`title`/`description`（来自 prompt）、`loaded: boolean`（由 2.2 推导）。
- **返回**：例如 `{ scenarios: [{ serverId, scenarioId, title, description, loaded }] }`。

### 3.2 Scenario 与 tools 的对应（方案 A）

- **以 MCP prompt 元数据为准**：若 MCP 在 `prompts/list` 或 `prompts/get` 的响应中提供「该 scenario 允许的 tools」（如 `allowed-tools`、`tools` 等字段），则只暴露该子集给 LLM。
- **退化**：若某 prompt 无此类元数据，则暂时退化为**该 server 的 tools/list 全量**作为该 scenario 的 tools。
- 实现时需在类型或协议上支持从 prompt 解析出 allowed-tools（可扩展 `MCPPrompt` 或 prompts/get 的响应结构）。

### 3.3 load_scenario（Agent 元 tool）

- **描述**：将指定 scenario 加载到当前 thread 上下文；加入该 scenario 的 tools，并将 scenario 的 prompt 内容注入 LLM context。
- **参数**：`serverId: string`，`scenarioId: string`（或 prompt name）。
- **执行**：
  1. 校验该 scenario 存在（prompts/list 或 get）；
  2. 若未超限（见 3.5），则本次调用在 assistant 消息中留下 `tool-call(load_scenario)` + `tool-result`；
  3. 通过 `prompts/get`（或等价）拉取 prompt 内容，供注入用（见 4.2）；
  4. 根据 3.2 解析该 scenario 的 tools 列表（含 allowed-tools 或退化全量）。
- **返回**：成功返回 `{ loaded: true, serverId, scenarioId, toolsCount?, promptInjected?: true }`；失败返回错误信息。

### 3.4 unload_scenario（Agent 元 tool）

- **描述**：将指定 scenario 从当前 thread 卸载。
- **参数**：`serverId: string`，`scenarioId: string`。
- **执行**：在 assistant 消息中留下 `tool-call(unload_scenario)` + `tool-result`；推导时从未加载集合移除。
- **返回**：`{ unloaded: true, serverId, scenarioId }` 或错误信息。

### 3.5 自动卸载（LRU）

- **上限**：例如「当前 thread 最多加载 K 个 scenarios」或「tools 总数最多 N 个」。
- **LRU 语义**：对每个已加载 scenario，其「最后使用时间」= 该 thread 中**最后一次出现对该 scenario 的 tool 调用**的那条消息的 `createdAt`（即 content 中存在 `tool-call` 且 `name` 形如 `{serverId}__*` 且该 tool 属于该 scenario）。从未被调用的 scenario 的 last-used 可视为该 load_scenario 消息的 `createdAt`。
- **触发**：在准备本轮回合的 tools 列表前，若已加载 scenarios（或 tools 总数）超过上限，则按 last-used **升序**依次 unload scenario，直到不超限。自动卸载**不**在历史中写入 load/unload tool-call（不改变推导）；可选在 system 或首条 assistant 中告知 LLM「以下 scenarios 因 context 限制已被自动卸载：…」。

---

## 4. MCP Tool 命名、路由与 LLM 集成

### 4.1 Tool 命名与路由

- **命名**：对每个已加载 scenario 暴露的 tool，对外名字为 **`{serverId}__{toolName}`**（双下划线；`serverId` 可做 LLM 友好规范化）。
- **传给 LLM**：每轮请求前，用 2.2 得到当前 thread 的已加载 scenarios；对每个 scenario 按 3.2 得到 tools 列表，拼成 `name: "${serverId}__${tool.name}"` 等；与元 tools（list_mcp_scenarios、load_scenario、unload_scenario）一起组成当轮 `tools` 数组。
- **执行**：LLM 返回的 `tool_calls` 中，若 `name` 形如 `xxx__yyy`，则拆成 `(serverId, toolName)`，用 `mcpCall(config, "tools/call", { name: toolName, arguments })` 执行（config 与 token 来自前端/IndexedDB）；结果以 tool-result 形式 append 并继续流或下一轮。

### 4.2 Scenario prompt 注入

- 加载 scenario 时，通过 **prompts/get**（或 MCP 等价接口）拉取该 prompt 的完整内容。
- 将该内容作为**系统或上下文消息**注入当轮 LLM 请求（例如追加一条 `role: "system"` 或首条 `user` 的 content），使 agent 知晓该 scenario 的用法与约束。

### 4.3 LLM 请求与多轮 tool 回合

- **请求**：除现有 `messages`、`stream: true` 外，增加 **`tools`** 数组（当前已加载 scenarios 的 tools + 元 tools）；若 provider 支持，使用 OpenAI 风格 `tool_choice`（可选）。
- **响应**：处理 LLM 返回的 **tool_calls**：在 SW 中执行（list_mcp_scenarios / load_scenario / unload_scenario 由 SW 直接处理；`serverId__toolName` 走 mcpCall）；将 tool 结果以 tool-result 形式 append 到消息；若需继续生成，可再发一轮带 tools 的请求（或流式多轮），直到无 tool_calls 或达到策略上限。
- **流式**：若 provider 在 stream 中返回 tool_calls，需在 SW 中缓冲完整 tool_calls 后执行，再决定是否继续请求。

---

## 5. 错误与边界

- **list_mcp_scenarios**：某 server 不可达或 401 时，该 server 的 scenarios 可标记为不可用或跳过，不阻塞其它 server。
- **load_scenario**：serverId/scenarioId 不存在、未登录(401)、或超限时返回明确错误；不写入 load tool-call，推导不变。
- **MCP tools/call 执行失败**：结果以 tool-result 形式返回错误信息，由 LLM 决定重试或提示用户。
- **User 消息中的 load_scenario/unload_scenario**：推导规则与 assistant 一致；若参数非法可忽略该条（或返回错误取决于是否同步执行 user tool-call）。

---

## 6. 文档与后续

- 本文档记录「以 scenario 为粒度的 MCP 发现、加载、卸载」及「从历史推导 + user tool-call + LRU 自动卸载」的约定。
- 实现时需：扩展 user 消息 content 支持；实现 list_mcp_scenarios、load_scenario、unload_scenario 及推导函数；LLM 请求带 tools 与 tool_calls 处理；prompts/get 与 prompt 注入；MCP prompt 元数据（allowed-tools）的解析与退化策略。

---

## 7. 实现说明（参考 impl 计划 2026-03-10）

- **推导已加载 scenarios**：`apps/agent/frontend/lib/derive-loaded-scenarios.ts` 中 `deriveLoadedScenarios(threadId, messages, mcpServers)`，scenarioKey 格式 `serverId#scenarioId`；仅根据历史中 load_scenario / unload_scenario 的 tool-call 推导。
- **LRU 与上限**：`apps/agent/frontend/lib/derive-loaded-scenarios-lru.ts` 中 `getLastUsedByScenario`、`applyAutoUnload`；常量 `MAX_LOADED_SCENARIOS = 10` 在该文件定义，由 `apps/agent/frontend/sw/mcp-scenario-tools.ts` 引入并 re-export；每轮构建 tools 前调用 `getLoadedScenariosAfterLru(state, threadId, scenarioToToolNames)` 得到本轮的 `kept` 集合。
- **元 tools**：`list_mcp_scenarios`、`load_scenario`、`unload_scenario` 的 schema 与执行在 `apps/agent/frontend/sw/mcp-scenario-tools.ts`（`metaToolSchemas`、`executeMetaTool`、`executeTool`）；MCP 场景 tool 执行通过 `executeTool(name, argsJson, state, threadId)` 路由到 `mcpCall(config, "tools/call", ...)`。
- **User message tool-call 约定**：后端与前端允许 `role: "user"` 的 message 的 `content` 包含 `type: "tool-call"` 与 `type: "tool-result"`；推导时与 assistant 一视同仁。UI 占位：`apps/agent/frontend/components/chat/thread-loaded-scenarios.tsx` 展示已加载 scenarios 并可通过 Load/Unload 发送带 tool-call + tool-result 的 user 消息。
