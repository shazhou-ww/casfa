# Agent Gateway MCP Unification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 Agent 的 MCP 管理完全切到 Gateway：移除本地 MCP servers 配置入口，直接注入 Gateway 元工具，并保持 `load_tools -> loadedToolName` 链路可用。

**Architecture:** 在 SW 层将元工具白名单从 `list_mcp_servers/get_mcp_tools/load_tools` 切为 Gateway 的 `list_servers/search_servers/get_tools/load_tools`。`mcp-meta-tools.ts` 保持 loaded tool 缓存机制，但元工具执行改为 Gateway 透传。前端设置页移除本地 MCP 编辑器，改为弹窗打开 Gateway 配置页。

**Tech Stack:** Bun, TypeScript, React, Zustand, Service Worker, MCP JSON-RPC.

---

### Task 1: `deriveContext` 白名单切换为 Gateway 元工具

**Files:**
- Modify: `cells/agent/frontend/sw/streaming.ts`
- Create: `cells/agent/frontend/sw/streaming.derive-context.test.ts`

**Step 1: Write the failing test**

```ts
it("keeps gateway meta tools and excludes non-whitelisted meta tools", () => {
  const ctx = deriveContext(
    [{ role: "user", content: "hello" }],
    {
      tools: [
        mkTool("list_servers"),
        mkTool("search_servers"),
        mkTool("get_tools"),
        mkTool("load_tools"),
        mkTool("add_server"),
        mkTool("remove_server"),
      ],
    },
    Date.now()
  );
  expect(ctx.tools.map((t) => t.function.name)).toEqual([
    "list_servers",
    "search_servers",
    "get_tools",
    "load_tools",
  ]);
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test:unit -- frontend/sw/streaming.derive-context.test.ts`  
Expected: FAIL（当前白名单仍是 `list_mcp_servers/get_mcp_tools/load_tools`）。

**Step 3: Write minimal implementation**

```ts
const META_TOOL_NAME_SET = new Set<string>([
  "list_servers",
  "search_servers",
  "get_tools",
  "load_tools",
]);
```

**Step 4: Run test to verify it passes**

Run: `bun run test:unit -- frontend/sw/streaming.derive-context.test.ts`  
Expected: PASS。

**Step 5: Commit**

```bash
git add cells/agent/frontend/sw/streaming.ts cells/agent/frontend/sw/streaming.derive-context.test.ts
git commit -m "refactor(agent-sw): switch deriveContext meta tool whitelist to gateway names"
```

---

### Task 2: 系统提示词切换为 Gateway 元工具命名

**Files:**
- Modify: `cells/agent/frontend/sw/system-prompt.md`
- Modify: `cells/agent/frontend/sw/system-prompt.zh-CN.md`

**Step 1: Write the failing test**

```ts
it("documents gateway meta tools in zh and en prompt", async () => {
  const zh = await Bun.file("frontend/sw/system-prompt.zh-CN.md").text();
  const en = await Bun.file("frontend/sw/system-prompt.md").text();
  expect(zh).toContain("`list_servers`、`search_servers`、`get_tools`、`load_tools`");
  expect(en).toContain("`list_servers`, `search_servers`, `get_tools`, `load_tools`");
  expect(zh).not.toContain("list_mcp_servers");
  expect(en).not.toContain("list_mcp_servers");
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test:unit -- frontend/sw/streaming.derive-context.test.ts`  
Expected: FAIL（提示词仍是旧命名）。

**Step 3: Write minimal implementation**

```md
MCP workflow:
- Meta tools available: `list_servers`, `search_servers`, `get_tools`, `load_tools`.
```

**Step 4: Run test to verify it passes**

Run: `bun run test:unit -- frontend/sw/streaming.derive-context.test.ts`  
Expected: PASS。

**Step 5: Commit**

```bash
git add cells/agent/frontend/sw/system-prompt.md cells/agent/frontend/sw/system-prompt.zh-CN.md cells/agent/frontend/sw/streaming.derive-context.test.ts
git commit -m "docs(agent-sw): update system prompt MCP meta tool names to gateway tools"
```

---

### Task 3: `mcp-meta-tools` 元工具执行改为 Gateway 透传

**Files:**
- Modify: `cells/agent/frontend/sw/mcp-meta-tools.ts`
- Modify: `cells/agent/frontend/lib/mcp-types.ts`
- Create: `cells/agent/frontend/sw/mcp-meta-tools.gateway.test.ts`

**Step 1: Write the failing test**

```ts
it("routes list_servers/get_tools/load_tools to builtin gateway config", async () => {
  // arrange state.settings with no mcp.servers
  // mock mcpCall/listTools to gateway endpoint only
  // call executeTool("list_servers", "{}", state, "t1")
  // expect request to gateway tool call path and structured JSON result
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test:unit -- frontend/sw/mcp-meta-tools.gateway.test.ts`  
Expected: FAIL（当前依赖本地 `mcp.servers`）。

**Step 3: Write minimal implementation**

```ts
const GATEWAY_META_TOOL_NAMES = ["list_servers", "search_servers", "get_tools", "load_tools"] as const;

// executeTool:
// 1) if name in GATEWAY_META_TOOL_NAMES -> call gateway MCP tools/call
// 2) if name is loadedToolName -> run loaded tool
```

并在 `mcp-types.ts` 增加 Gateway 内置配置常量（例如 `BUILTIN_GATEWAY_MCP_SERVER_ID`，`BUILTIN_GATEWAY_MCP_SETTING_KEY` 或直接 helper）。

**Step 4: Run test to verify it passes**

Run: `bun run test:unit -- frontend/sw/mcp-meta-tools.gateway.test.ts`  
Expected: PASS（无需本地 `mcp.servers` 也可调用 Gateway 元工具）。

**Step 5: Commit**

```bash
git add cells/agent/frontend/sw/mcp-meta-tools.ts cells/agent/frontend/lib/mcp-types.ts cells/agent/frontend/sw/mcp-meta-tools.gateway.test.ts
git commit -m "feat(agent-sw): route gateway meta tools directly without local mcp server settings"
```

---

### Task 4: 设置页下线本地 MCP 编辑器，改为弹窗打开 Gateway 配置

**Files:**
- Modify: `cells/agent/frontend/pages/settings-page.tsx`
- Modify: `cells/agent/frontend/stores/agent-store.ts`
- (Optional) Delete: `cells/agent/frontend/components/settings/mcp-servers-editor.tsx`
- Create: `cells/agent/frontend/pages/settings-page.gateway.test.tsx`

**Step 1: Write the failing test**

```tsx
it("opens gateway mcp settings popup instead of local editor", async () => {
  // render SettingsPage
  // click MCP row action button
  // expect window.open called with gateway settings url
  // expect McpServersEditor not rendered
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test:unit -- frontend/pages/settings-page.gateway.test.tsx`  
Expected: FAIL（当前仍打开本地 `McpServersEditor`）。

**Step 3: Write minimal implementation**

```tsx
<Button size="small" onClick={openGatewayMcpSettings}>Open</Button>
```

并移除 `setMcpServers/getMcpServers` 在设置页的使用；`agent-store.ts` 中对应 API 标记为废弃并在无调用后删除。

**Step 4: Run test to verify it passes**

Run: `bun run test:unit -- frontend/pages/settings-page.gateway.test.tsx`  
Expected: PASS。

**Step 5: Commit**

```bash
git add cells/agent/frontend/pages/settings-page.tsx cells/agent/frontend/stores/agent-store.ts cells/agent/frontend/pages/settings-page.gateway.test.tsx
git commit -m "refactor(agent-ui): replace local MCP editor with gateway settings popup entry"
```

---

### Task 5: 回归验证（LLM 工具链路 + 文档）

**Files:**
- Modify: `docs/plans/2026-03-15-agent-gateway-mcp-unification-design.md`
- Modify: `cells/agent/frontend/components/chat/thread-loaded-scenarios.tsx` (if text mentions old names)
- Modify: `cells/agent/frontend/sw/api-settings-paths.test.ts` (if old key assumptions fail)

**Step 1: Write the failing validation checklist**

```md
- [ ] deriveContext 仅保留 gateway 元工具白名单
- [ ] load_tools 之后 loadedToolName 可继续调用
- [ ] 设置页 MCP 入口只跳转 gateway 配置，不再出现本地编辑器
- [ ] 中英文系统提示词不再出现 list_mcp_servers/get_mcp_tools
```

**Step 2: Run validation commands**

Run:
- `bun run test:unit -- frontend/sw/streaming.derive-context.test.ts`
- `bun run test:unit -- frontend/sw/mcp-meta-tools.gateway.test.ts`
- `bun run test:unit -- frontend/pages/settings-page.gateway.test.tsx`

Expected: 若有遗漏先 FAIL，补齐后 PASS。

**Step 3: Write minimal documentation updates**

```md
记录 Agent MCP 入口变更：
- no local mcp.servers editor
- gateway-only meta tools
- deriveContext whitelist policy
```

**Step 4: Re-run validation**

Run:
- `bun run test:unit -- frontend/sw/streaming.derive-context.test.ts frontend/sw/mcp-meta-tools.gateway.test.ts frontend/pages/settings-page.gateway.test.tsx`

Expected: PASS。

**Step 5: Commit**

```bash
git add docs/plans/2026-03-15-agent-gateway-mcp-unification-design.md cells/agent/frontend/components/chat/thread-loaded-scenarios.tsx cells/agent/frontend/sw/api-settings-paths.test.ts
git commit -m "docs(agent): finalize gateway-only MCP workflow notes and test adjustments"
```

---

Plan complete and saved to `docs/plans/2026-03-15-agent-gateway-mcp-unification-implementation-plan.md`.

Two execution options:

1. **Subagent-Driven (this session)** - 我在当前会话按 task 逐个执行、每步回归确认。  
2. **Parallel Session (separate)** - 你开一个新会话，用 `executing-plans` 按该文档分批执行。

Which approach?
