# Cell MCP 统一发现与执行 — 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace scenario-based MCP (list_mcp_scenarios, load_scenario, unload_scenario, serverId__toolName) with unified progressive discovery (list_mcp_servers, get_mcp_tools, get_tool_usage, run_mcp_tool) and remove all related derivation/LRU/UI.

**Architecture:** New module `mcp-meta-tools.ts` in Agent SW provides four OpenAI-format tool schemas and execution; `buildToolsForThread` returns only these four tools (no system prompt from scenarios); `executeTool` routes to meta handlers or `run_mcp_tool` (MCP tools/call). Streaming and API keep using same flow; remove `derive-loaded-scenarios`, LRU, scenario UI and `mcp-scenario-tools.ts`.

**Tech Stack:** TypeScript, Agent frontend (SW), existing mcp-client (listTools, listPrompts, getPrompt, mcpCall), mcp-types (parseMcpServers, MCPServerConfig).

**Design doc:** `docs/plans/2026-03-10-cell-mcp-unified-discovery-design.md`

---

## Task 1: Add mcp-meta-tools.ts with list_mcp_servers and four schemas

**Files:**
- Create: `apps/agent/frontend/sw/mcp-meta-tools.ts`
- Modify: (none yet)

**Step 1: Create the new module with types and list_mcp_servers**

- Export types: `ListMcpServersResult` (servers: Array<{ serverId, name?, description?, unavailable?, error? }>).
- Export `metaToolSchemas`: array of four OpenAI-format tools: list_mcp_servers (no params), get_mcp_tools(serverId), get_tool_usage(serverId, toolName), run_mcp_tool(serverId, toolName, arguments).
- Implement `listMcpServers(state: ModelState): Promise<ListMcpServersResult>`: parse mcp servers from state.settings[MCP_SERVERS_SETTINGS_KEY], filter configs with `config.url`; for each, optionally try initialize or listTools to get name/description, on failure push entry with unavailable: true or error; return { servers }.
- Use existing `parseMcpServers` from mcp-types, `listTools` from mcp-client; for Level 0 we can keep it lightweight: just return serverId from config.id and name from config.name or config.url, and only mark unavailable if a quick ping/list fails (design allows “only based on config” for Level 0).
- Export `OpenAIFormatTool` type (same shape as before: type "function", function: { name, description, parameters }).

**Step 2: Implement get_mcp_tools and get_tool_usage and run_mcp_tool handlers**

- `getMcpTools(state, serverId)`: find config by serverId, require config.url; call listTools(config), optionally listPrompts(config); return { serverId, tools: tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })), prompts?: ... }.
- `getToolUsage(state, serverId, toolName)`: find config, call listTools(config), find tool by name; optionally find related prompt and call getPrompt(config, promptName) to attach promptText; return { serverId, toolName, description, inputSchema, promptText? }.
- `runMcpTool(state, serverId, toolName, arguments)`: find config, mcpCall(config, "tools/call", { name: toolName, arguments: arguments ?? {} }); return result content as string or JSON error.

**Step 3: Implement executeMetaTool and executeTool**

- `executeMetaTool(name, args, state): Promise<string>`: switch on name (list_mcp_servers, get_mcp_tools, get_tool_usage, run_mcp_tool), parse args (serverId, toolName, arguments), call the four handlers, return JSON.stringify(result).
- `executeTool(name, argsJson, state, threadId)`: if name is one of the four meta tools, parse argsJson and call executeMetaTool; else return JSON.stringify({ error: "unknown tool" }). (All tools are now meta; no serverId__toolName.)
- Export `buildToolsForThread(state, threadId)`: return { systemPromptText: undefined, tools: metaToolSchemas } (no scenario derivation).

**Step 4: Commit**

```bash
git add apps/agent/frontend/sw/mcp-meta-tools.ts
git commit -m "feat(agent): add MCP meta tools (list_mcp_servers, get_mcp_tools, get_tool_usage, run_mcp_tool)"
```

---

## Task 2: Wire streaming to mcp-meta-tools and drop scenario tools

**Files:**
- Modify: `apps/agent/frontend/sw/streaming.ts`
- Modify: (imports only) any file that imported from mcp-scenario-tools for types

**Step 1: Point streaming to new module**

- In `streaming.ts`: change import from `./mcp-scenario-tools.ts` to `./mcp-meta-tools.ts` for `buildToolsAndPromptForThread` and `executeTool` and `OpenAIFormatTool`.
- Ensure `buildToolsAndPromptForThread` is exported from mcp-meta-tools with signature `(state, threadId) => Promise<{ systemPromptText?: string; tools: OpenAIFormatTool[] }>` (no scenarioToToolNames).

**Step 2: Run agent build/tests**

- Run: `cd apps/agent && bun run build` (or equivalent).
- Run: `cd apps/agent && bun test` (or where tests live). Fix any type or import errors in streaming or dependent code.

**Step 3: Commit**

```bash
git add apps/agent/frontend/sw/streaming.ts apps/agent/frontend/sw/mcp-meta-tools.ts
git commit -m "feat(agent): use MCP meta tools in streaming, drop scenario tools"
```

---

## Task 3: Remove scenario derivation and LRU

**Files:**
- Delete: `apps/agent/frontend/lib/derive-loaded-scenarios.ts`
- Delete: `apps/agent/frontend/lib/derive-loaded-scenarios-lru.ts`
- Delete: `apps/agent/frontend/lib/derive-loaded-scenarios.test.ts`
- Delete: `apps/agent/frontend/lib/derive-loaded-scenarios-lru.test.ts`
- Modify: `apps/agent/frontend/sw/mcp-scenario-tools.ts` (next task will remove the file; ensure no remaining imports from derive-loaded-scenarios*)

**Step 1: Remove imports and delete files**

- Grep for imports of `derive-loaded-scenarios` or `derive-loaded-scenarios-lru`; only `mcp-scenario-tools.ts` and `thread-loaded-scenarios.tsx` should reference them. After switching streaming to mcp-meta-tools, mcp-scenario-tools is no longer used by streaming; thread-loaded-scenarios is next task.
- Delete the four files above.

**Step 2: Run tests**

- Run: `bun test` in apps/agent (or workspace root). Tests that referenced deriveLoadedScenarios or LRU will be removed with the deleted test files; ensure no other tests import deleted modules.

**Step 3: Commit**

```bash
git add -A apps/agent/frontend/lib/derive-loaded-scenarios*.ts apps/agent/frontend/lib/derive-loaded-scenarios-lru*.ts
git commit -m "chore(agent): remove scenario derivation and LRU modules"
```

---

## Task 4: Remove or simplify thread-loaded-scenarios UI

**Files:**
- Modify or Delete: `apps/agent/frontend/components/chat/thread-loaded-scenarios.tsx`
- Modify: any parent that renders it (e.g. chat thread UI)

**Step 1: Remove scenario Load/Unload UI**

- If thread-loaded-scenarios only showed loaded scenarios and Load/Unload buttons: remove the component from the chat UI (or replace with a minimal placeholder like “MCP tools: use list_mcp_servers and run_mcp_tool” if you want to keep a hint). Remove any imports of deriveLoadedScenarios or load_scenario/unload_scenario tool-call construction.

**Step 2: Verify build and commit**

- Run: `bun run build` in apps/agent.
- `git add apps/agent/frontend/components/chat/thread-loaded-scenarios.tsx` (and parent if changed); `git commit -m "chore(agent): remove scenario load/unload UI"`

---

## Task 5: Fix backend message-store tests

**Files:**
- Modify: `apps/agent/backend/__tests__/db/message-store.test.ts`

**Step 1: Update or remove load_scenario expectations**

- Tests that create/assert messages with load_scenario tool-calls: either remove those tests or change them to use the new meta tool names (e.g. list_mcp_servers, run_mcp_tool) if the test is about message storage shape. If tests only validated that tool-call content is stored, keep one test with run_mcp_tool or list_mcp_servers instead of load_scenario.

**Step 2: Run tests**

- Run: `bun test apps/agent/backend/__tests__/db/message-store.test.ts`

**Step 3: Commit**

```bash
git add apps/agent/backend/__tests__/db/message-store.test.ts
git commit -m "test(agent): update message-store tests for MCP meta tools"
```

---

## Task 6: Remove mcp-scenario-tools.ts

**Files:**
- Delete: `apps/agent/frontend/sw/mcp-scenario-tools.ts`

**Step 1: Ensure no remaining references**

- Grep for `mcp-scenario-tools` and `mcpScenarioTools` (or similar). Only streaming was using it (already switched). Remove any other references.

**Step 2: Delete file and run build/tests**

- Delete `apps/agent/frontend/sw/mcp-scenario-tools.ts`.
- Run: `bun run build` and `bun test` in apps/agent.

**Step 3: Commit**

```bash
git add -A apps/agent/frontend/sw/mcp-scenario-tools.ts
git commit -m "chore(agent): remove mcp-scenario-tools in favor of mcp-meta-tools"
```

---

## Execution handoff

Plan complete and saved to `docs/plans/2026-03-10-cell-mcp-unified-discovery-impl.md`.

**Two execution options:**

1. **Subagent-Driven (this session)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Parallel Session (separate)** — Open a new session with executing-plans, run in a worktree with checkpoint reviews.

Which approach do you prefer?
