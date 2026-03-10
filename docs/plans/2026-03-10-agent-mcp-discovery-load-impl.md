# Agent MCP 发现 / 加载 / 卸载（Scenario 粒度）实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现以 scenario 为粒度的 MCP 发现、加载、卸载机制：agent 通过 list_mcp_scenarios / load_scenario / unload_scenario 与历史推导得到已加载 scenarios，并将 scenario 的 tools 与 prompt 注入 LLM；tool 执行在 SW 中通过 mcpCall 完成。

**Architecture:** 前端/SW 维护：从 thread 消息历史推导「已加载 scenarios」；对每个已加载 scenario 拉取 prompts/get 与 tools（按 prompt 元数据 allowed-tools 或退化全量）；LLM 请求带 tools 数组并处理 tool_calls；user 消息允许 tool-call/tool-result content；自动卸载按 LRU 基于历史推导的 last-used。

**Tech Stack:** TypeScript, Zustand, Service Worker, MCP JSON-RPC (mcp-client), OpenAI-style chat API (tools/tool_calls).

**Design reference:** `docs/plans/2026-03-10-agent-mcp-discovery-load-design.md`

---

## Task 1: 扩展 user 消息 content 支持 tool-call / tool-result

**Goal:** 后端与前端允许 `role: "user"` 的 message 的 `content` 包含 `ToolCallContent` / `ToolResultContent`，并原样存储与同步。

**Files:**
- Modify: `apps/agent/backend` 中处理 message 创建/校验的代码（若有 schema 校验）
- Modify: `apps/agent/frontend/lib/model-types.ts`（若需文档化约定）
- Test: 手动或现有 E2E：创建一条 user message 带 content `[{ type: "tool-call", callId, name: "load_scenario", arguments: "{}" }]`，拉取后仍存在

**Step 1:** 确认后端 POST message 的 body 是否限制 content 仅为 text。若有限制，放宽为接受 `content: Array<{ type, ... }>`，且允许 `type: "tool-call"` / `type: "tool-result"` 的合法结构。

**Step 2:** 确认前端 `MessageContent` 类型已包含 `ToolCallContent | ToolResultContent`；若无，无需改类型，仅保证序列化/反序列化不丢弃。

**Step 3:** 提交：`git add ... && git commit -m "feat(agent): allow user messages to contain tool-call and tool-result content"`

---

## Task 2: 推导「当前 thread 已加载 scenarios」纯函数

**Goal:** 实现 `deriveLoadedScenarios(threadId, messages, mcpServers): Set<string>`，scenarioKey 形如 `serverId#scenarioId`；仅根据历史中 load_scenario / unload_scenario 的 tool-call 推导。

**Files:**
- Create: `apps/agent/frontend/lib/derive-loaded-scenarios.ts`
- Test: `apps/agent/frontend/lib/derive-loaded-scenarios.test.ts`（或同目录 .test.ts）

**Step 1: 写失败测试**

- 用例 1：空 messages → 返回空 Set。
- 用例 2：一条 assistant message 含 content `[{ type: "tool-call", name: "load_scenario", arguments: "{\"serverId\":\"s1\",\"scenarioId\":\"sc1\"}" }]` → 返回 `Set(["s1#sc1"])`。
- 用例 3：再接一条 unload_scenario(s1, sc1) → 返回空 Set。
- 用例 4：user message 中带 load_scenario → 同样加入 loaded。

**Step 2: 运行测试确认失败**

Run: `bun test apps/agent/frontend/lib/derive-loaded-scenarios.test.ts`（或项目内测试命令）  
Expected: FAIL（函数未实现或返回错误）

**Step 3: 最小实现**

- 实现 `deriveLoadedScenarios(threadId, messages, mcpServers): Set<string>`：按 `createdAt` 排序 messages，遍历每条 message 的 content；若 `type === "tool-call"` 且 `name === "load_scenario"` 则解析 arguments 得到 serverId + scenarioId，校验 serverId 在 mcpServers 中存在后 `loaded.add(\`${serverId}#${scenarioId}\`)`；若 `name === "unload_scenario"` 则 `loaded.delete(...)`。返回 `loaded`。

**Step 4: 运行测试确认通过**

Run: 同上  
Expected: PASS

**Step 5: 提交**

`git add apps/agent/frontend/lib/derive-loaded-scenarios.ts apps/agent/frontend/lib/derive-loaded-scenarios.test.ts && git commit -m "feat(agent): derive loaded scenarios from thread message history"`

---

## Task 3: MCP prompts/list 与 prompts/get 客户端

**Goal:** 在 mcp-client 中增加 `listPrompts` 与 `getPrompt(serverId, promptName, args?)`（或 prompts/get 所需参数），供 SW 或前端调用。

**Files:**
- Modify: `apps/agent/frontend/lib/mcp-client.ts`
- Modify: `apps/agent/frontend/lib/mcp-types.ts`（若 MCPPrompt 需扩展 allowed-tools 等）

**Step 1:** 查 MCP 协议中 `prompts/list`、`prompts/get` 的请求/响应形状；若已有 `listPrompts` 则确认签名与返回类型。

**Step 2:** 实现或补全 `getPrompt(config, name, arguments?)`：调用 `tools/call` 或 MCP 的 prompts/get 等价方法，返回 prompt 内容（字符串或结构化）。

**Step 3:** 若设计中的「allowed-tools」来自 prompt 元数据，在 `MCPPrompt` 或 get 的响应类型上增加可选字段（如 `allowedTools?: string[]`），并在解析 prompts/list 或 prompts/get 时填充。

**Step 4:** 提交：`git add apps/agent/frontend/lib/mcp-client.ts apps/agent/frontend/lib/mcp-types.ts && git commit -m "feat(agent): add MCP prompts/list and prompts/get client support"`

---

## Task 4: list_mcp_scenarios 实现（SW 侧元 tool）

**Goal:** 在 SW 中实现「list_mcp_scenarios」逻辑：对每个 mcp.servers 调用 prompts/list（及 tools/list 如需），汇总为 scenarios 列表，并调用 `deriveLoadedScenarios` 标记每个 scenario 的 loaded。

**Files:**
- Create: `apps/agent/frontend/sw/mcp-scenario-tools.ts`（或并入现有 streaming/tools 模块）
- Modify: `apps/agent/frontend/sw/streaming.ts` 或调用处，在构建「当轮传给 LLM 的 tools」时加入 list_mcp_scenarios 的 schema 与执行入口

**Step 1:** 实现 `listMcpScenarios(state: ModelState, threadId: string): Promise<{ scenarios: Array<{ serverId, scenarioId, title?, description?, loaded: boolean }> }>`：读取 state.settings[MCP_SERVERS_SETTINGS_KEY]、state.messagesByThread[threadId]，调用 deriveLoadedScenarios；对每个 server 调用 prompts/list；组装 scenarios 并标记 loaded。

**Step 2:** 将 list_mcp_scenarios 的 OpenAI-format tool schema（name, description, parameters）与执行函数挂到 SW 的「元 tools」列表，供后续与 LLM 请求一起发送。

**Step 3:** 提交：`git add apps/agent/frontend/sw/mcp-scenario-tools.ts ... && git commit -m "feat(agent): implement list_mcp_scenarios meta-tool in SW"`

---

## Task 5: load_scenario / unload_scenario 元 tool 实现

**Goal:** 在 SW 中实现 load_scenario 与 unload_scenario：不持久化单独状态，仅通过「在本轮 assistant 消息中写入对应 tool-call + tool-result」使推导结果变化；load 时拉取 prompt 内容并记录用于注入（见 Task 7）。

**Files:**
- Modify: `apps/agent/frontend/sw/mcp-scenario-tools.ts`
- Modify: `apps/agent/frontend/sw/streaming.ts`（或 tool 执行路由）

**Step 1:** 实现 `executeLoadScenario(state, threadId, serverId, scenarioId)`：校验 server 与 scenario 存在；若已超限则先执行 LRU 自动卸载（见 Task 6）；然后返回成功 payload，并由调用方将 `tool-call(load_scenario)` 与 `tool-result` append 到当前 assistant 消息。

**Step 2:** 实现 `executeUnloadScenario(state, threadId, serverId, scenarioId)`：返回成功 payload，并由调用方将 unload_scenario 的 tool-call + tool-result append。

**Step 3:** 在 tool 执行路由中根据 tool name 分发到 list_mcp_scenarios / load_scenario / unload_scenario；load/unload 执行后需触发「将本条 assistant 消息（含 tool_calls 与 tool_results）append 到 thread 并 broadcast」，以便下一轮推导能看到新状态。

**Step 4:** 提交：`git add ... && git commit -m "feat(agent): implement load_scenario and unload_scenario meta-tools"`

---

## Task 6: LRU 自动卸载与上限

**Goal:** 在准备每轮 tools 列表前，若已加载 scenario 数（或 tools 总数）超过上限，则按 LRU 顺序自动「卸载」若干 scenario；LRU 由历史推导（每个 scenario 的 last-used = 最后一次该 scenario 的 tool 被调用的消息 createdAt）。

**Files:**
- Create: `apps/agent/frontend/lib/derive-loaded-scenarios-lru.ts` 或扩展示有 derive 模块
- Modify: `apps/agent/frontend/sw/mcp-scenario-tools.ts`（在 buildToolsForThread 前调用）

**Step 1:** 实现 `getLastUsedByScenario(threadId, messages, loadedScenarioKeys): Map<string, number>`：遍历 messages，对每条中 content 的 tool-call 若 name 形如 `serverId__toolName`，则根据 serverId+scenarioId 归属更新该 scenario 的 last-used = message.createdAt。

**Step 2:** 实现「应用自动卸载」：若 `loaded.size > MAX_LOADED_SCENARIOS`，则按 last-used 升序排序，移除直到 ≤ 上限。注意：自动卸载不写入 load/unload tool-call，因此需要在「当轮请求」的 context 中临时使用「推导出的 loaded 再减去本次自动卸掉的集合」作为本轮的已加载集合；或可选在 system 中注入一句「以下 scenarios 已因 context 限制被自动卸载：…」。

**Step 3:** 将 MAX_LOADED_SCENARIOS（或 tools 总数上限）定为常量或配置，并在 buildToolsForThread 前调用自动卸载逻辑。

**Step 4:** 提交：`git add ... && git commit -m "feat(agent): LRU auto-unload of scenarios when over cap"`

---

## Task 7: Scenario prompt 注入与已加载 scenario 的 tools 列表

**Goal:** 对每个已加载 scenario，拉取 prompt 内容（prompts/get）并注入到 LLM 请求的 system/context；按 3.2 方案 A 解析该 scenario 的 tools（allowed-tools 或退化全量），与元 tools 一起组成当轮 tools 数组。

**Files:**
- Modify: `apps/agent/frontend/sw/mcp-scenario-tools.ts`
- Modify: `apps/agent/frontend/sw/streaming.ts`

**Step 1:** 实现 `getScenarioTools(config, scenarioId, toolsList, promptMetadata?)`：若 prompt 有 allowed-tools 则过滤 toolsList 返回子集，否则返回全量。Tool 对外 name 为 `{serverId}__{tool.name}`。

**Step 2:** 实现 `getScenarioPromptContent(config, scenarioId)`：调用 mcp-client 的 getPrompt，返回字符串内容。

**Step 3:** 在 runMessagesSend 或构建请求前：根据 deriveLoadedScenarios + 自动卸载结果得到本轮的 loaded scenarios；对每个 scenario 拉取 prompt 内容并拼成 1 条 system（或首条 user）消息；收集所有 scenario 的 tools 并去重，与 list_mcp_scenarios、load_scenario、unload_scenario 的 schema 合并为 `tools` 数组；请求 body 增加 `tools`（及可选 `tool_choice`）。

**Step 4:** 提交：`git add ... && git commit -m "feat(agent): inject scenario prompts and build tools list for LLM"`

---

## Task 8: LLM 请求带 tools 与 tool_calls 处理

**Goal:** 调用 LLM 时传入 tools；解析流式或非流式响应中的 tool_calls；在 SW 中执行（元 tool 或 mcpCall）；将 tool 结果 append 为 tool-result，并决定是否继续请求直到无 tool_calls 或达到轮数上限。

**Files:**
- Modify: `apps/agent/frontend/sw/streaming.ts`
- Modify: `apps/agent/frontend/sw/api.ts`（若 LLM 请求封装在此）

**Step 1:** 修改 `callLlmStream` 或等价函数：接受 `tools: Array<OpenAI-format tool>` 参数，在 body 中加入 `tools`。若 provider 在 stream 中返回 tool_calls，需缓冲完整 tool_calls 再处理。

**Step 2:** 实现 tool_calls 处理循环：当 LLM 返回 tool_calls 时，对每个 call 根据 name 分发：若为 list_mcp_scenarios / load_scenario / unload_scenario 则执行元 tool 并得到 result 字符串；若为 `serverId__toolName` 则 mcpCall(config, "tools/call", { name: toolName, arguments }) 得到 result。将 assistant 消息的 content 追加 tool-call 与对应 tool-result；若需继续生成，再发一轮带相同 tools 的请求（messages 含新 append 的 tool-call/tool-result），直到无 tool_calls 或达到最大轮数（如 5）。

**Step 3:** 将「流式结束后的完整 assistant 消息」（含可能的多轮 tool-call/tool-result）POST 到 backend 创建 message，并 broadcast stream.done。

**Step 4:** 提交：`git add ... && git commit -m "feat(agent): LLM request with tools and tool_calls execution loop"`

---

## Task 9: User 触发的 load_scenario / unload_scenario（UI 占位）

**Goal:** 允许 UI 发一条 user 消息，content 为 `[{ type: "tool-call", name: "load_scenario", arguments: "{\"serverId\":\"...\",\"scenarioId\":\"...\"}" }, { type: "tool-result", callId, result: "..." }]`，以便「用户手动为 thread 开启/关闭某 scenario」；推导逻辑已支持（Task 2）。本任务仅实现 UI 入口（如 settings 或 thread 头部「管理 scenario」）调用发送该 user 消息的逻辑。

**Files:**
- Modify: `apps/agent/frontend/pages/chat-page.tsx` 或 settings/thread 相关组件
- Create: 可选 `apps/agent/frontend/components/thread-loaded-scenarios.tsx`

**Step 1:** 在 thread 或 settings 中增加「已加载 scenarios」展示（调用 deriveLoadedScenarios）；增加「加载 scenario」/「卸载 scenario」按钮，点击时构造 content 为 load_scenario/unload_scenario 的 user message 并 POST 到当前 thread（sendMessage 或等价），带 tool-call + tool-result content。

**Step 2:** 提交：`git add ... && git commit -m "feat(agent): UI to toggle scenario load/unload via user tool-call message"`

---

## Task 10: 联调与文档

**Goal:** 端到端验证：配置 MCP → 打开 thread → list_mcp_scenarios → load_scenario → 下一轮请求带 scenario tools 与 prompt → LLM 调用 MCP tool → 执行成功并返回；unload 与 LRU 自动卸载验证；更新 README 或开发者文档说明 MCP scenario 流程。

**Files:**
- Modify: `apps/agent/README.md` 或 `docs/plans/2026-03-10-agent-mcp-discovery-load-design.md`（补充实现说明）

**Step 1:** 手动或 E2E：完成上述流程并记录结果；修复发现的问题。

**Step 2:** 在 design 或 README 中增加「实现说明」小节：derive 位置、元 tools 列表、LRU 与上限配置位置、user message tool-call 约定。

**Step 3:** 提交：`git add ... && git commit -m "docs(agent): MCP scenario discovery and load implementation notes"`

---

**Plan complete and saved to `docs/plans/2026-03-10-agent-mcp-discovery-load-impl.md`.**

**执行方式二选一：**

1. **本会话内子 agent 驱动** — 按 task 拆分子 agent，每 task 完成后 review，再进入下一 task。  
2. **单独会话并行** — 在新会话中打开 executing-plans，在对应 worktree 中按 checkpoint 批量执行。

你选哪种？若选 1，我会用 subagent-driven-development 在本会话内按 task 推进；若选 2，我会说明如何在新会话用 executing-plans 执行本计划。
