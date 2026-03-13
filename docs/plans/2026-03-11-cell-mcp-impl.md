# Cell MCP Package Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement `@casfa/cell-mcp` package: Builder-style API for standard MCP over HTTP with optional auth and Zod-based tool input validation, per design in `docs/plans/2026-03-11-cell-mcp-package-design.md`.

**Architecture:** New package under `packages/cell-mcp`. Builder holds server name/version, optional authCheck/onUnauthorized, and registrations for tools (with Zod schema + handler), resources, and prompts. On each HTTP request we create a fresh McpServer, register all tools (with a wrapper that runs safeParse before calling the user handler), register all resources/prompts, then use WebStandardStreamableHTTPServerTransport to handle the request. Auth runs before creating the transport.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk` (^1.27.1), `zod`, `hono` (types only for Context), Bun for tests.

**Design reference:** `docs/plans/2026-03-11-cell-mcp-package-design.md`

---

## Task 1: Package scaffold

**Files:**
- Create: `packages/cell-mcp/package.json`
- Create: `packages/cell-mcp/tsconfig.json`
- Create: `packages/cell-mcp/src/index.ts`

**Step 1: Create package.json**

Create `packages/cell-mcp/package.json` with:
- `"name": "@casfa/cell-mcp"`
- `"version": "0.1.0"`
- `"type": "module"`
- `exports`: `"."` with `bun`, `types`, `import` pointing to `src/index.ts` and `dist/index.js` (same pattern as `packages/cell-cognito-server`)
- `dependencies`: `@modelcontextprotocol/sdk` ^1.27.1, `zod` (match workspace), `hono` (for types only)
- `devDependencies`: `@types/bun`, `typescript`
- `scripts`: build (e.g. `bun ../../scripts/build-pkg.ts` if that exists, or `tsc`), test, typecheck, lint

**Step 2: Create tsconfig.json**

Copy pattern from `packages/cell-cognito-server` or `packages/cell-delegates-server`: `"module": "ESNext"`, `"moduleResolution": "bundler"`, `"outDir": "dist"`, include src.

**Step 3: Create empty index and add to workspace**

Create `packages/cell-mcp/src/index.ts`:

```ts
export {};
```

Run from repo root: `bun install --no-cache` so workspace picks up the new package.

**Step 4: Commit**

```bash
git add packages/cell-mcp/
git commit -m "chore(cell-mcp): add package scaffold"
```

---

## Task 2: Types (options, ToolResult, context)

**Files:**
- Create: `packages/cell-mcp/src/types.ts`
- Modify: `packages/cell-mcp/src/index.ts`

**Step 1: Define types**

In `packages/cell-mcp/src/types.ts`:

- Import `type { Context } from "hono"` (use a generic env type, e.g. `Record<string, unknown>` or export a generic `HonoContext`).
- `ToolResult`: `{ content: Array<{ type: "text"; text: string }>; isError?: boolean }`.
- `CellMcpServerOptions`: `{ name: string; version: string; authCheck?: (c: Context<Record<string, unknown>>) => boolean | Promise<boolean>; onUnauthorized?: (c: Context<Record<string, unknown>>) => Response }`.
- Export all.

**Step 2: Export from index**

In `packages/cell-mcp/src/index.ts`: `export type { ToolResult, CellMcpServerOptions } from "./types.js";`

**Step 3: Run typecheck**

Run: `cd packages/cell-mcp && bun run typecheck`  
Expected: passes (or fix any path/type errors).

**Step 4: Commit**

```bash
git add packages/cell-mcp/src/
git commit -m "feat(cell-mcp): add ToolResult and CellMcpServerOptions types"
```

---

## Task 3: Validation error formatting

**Files:**
- Create: `packages/cell-mcp/src/validation.ts`
- Modify: `packages/cell-mcp/src/index.ts`
- Create: `packages/cell-mcp/src/validation.test.ts`

**Step 1: Write failing test**

In `packages/cell-mcp/src/validation.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { formatToolValidationError } from "./validation.js";

describe("formatToolValidationError", () => {
  const schema = z.object({ required: z.string(), num: z.number() });

  it("includes tool name and field messages", () => {
    const result = schema.safeParse({});
    expect(result.success).toBe(false);
    if (result.success) return;
    const text = formatToolValidationError("my_tool", result.error);
    expect(text).toContain("my_tool");
    expect(text).toContain("required");
    expect(text).toContain("num");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/cell-mcp && bun test src/validation.test.ts`  
Expected: FAIL (formatToolValidationError not defined or not exported).

**Step 3: Implement formatToolValidationError**

In `packages/cell-mcp/src/validation.ts`:

- Import `type { ZodError } from "zod"`.
- `formatToolValidationError(toolName: string, error: ZodError): string`:
  - Build lines: `Tool '${toolName}' validation failed:`, then each `issue.path.join(".") + ": " + issue.message`.
  - Return lines joined by "\n".

**Step 4: Export and run test**

Export `formatToolValidationError` from `validation.ts`. In index.ts add: `export { formatToolValidationError } from "./validation.js";`  
Run: `bun test src/validation.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/cell-mcp/src/
git commit -m "feat(cell-mcp): add validation error formatter and test"
```

---

## Task 4: Builder and registerTool with Zod wrapper

**Files:**
- Create: `packages/cell-mcp/src/server.ts`
- Modify: `packages/cell-mcp/src/index.ts`

**Step 1: Implement createCellMcpServer and registerTool**

In `packages/cell-mcp/src/server.ts`:

- Import `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`, `type { z } from "zod"`, `formatToolValidationError` from `./validation.js`, `type { ToolResult, CellMcpServerOptions } from "./types.js"`, `type { Context } from "hono"`.
- Define internal type for a tool registration: `{ name: string; description: string; inputSchema: z.ZodType; handler: (args: unknown) => ToolResult | Promise<ToolResult> }`.
- `createCellMcpServer(options: CellMcpServerOptions)`:
  - Store `name`, `version`, `authCheck`, `onUnauthorized`, and arrays `tools: ToolReg[]`, `resources: unknown[]`, `prompts: unknown[]` (resources/prompts will be typed in next task).
  - Implement `registerTool<T>(name: string, spec: { description: string; inputSchema: z.ZodType<T> }, handler: (args: T) => ToolResult | Promise<ToolResult>)`: push to `tools` with a wrapper that runs `spec.inputSchema.safeParse(args)`; on failure return `{ content: [{ type: "text", text: formatToolValidationError(name, error) }], isError: true }`; on success call `handler(parsed.data)` and return result. Catch handler throws and return `{ content: [{ type: "text", text: message }], isError: true }`.
  - Return object `{ registerTool, getRoute }` (registerResource/registerPrompt stubbed in next task).
- Implement `buildMcpServer()` (internal): create `new McpServer({ name, version }, {})`, for each tool call `server.registerTool(name, { description, inputSchema }, wrapperHandler)`, return server. Use the same `inputSchema` for SDK so tools/list shows correct schema.

**Step 2: Export createCellMcpServer**

Export from `index.ts`: `export { createCellMcpServer } from "./server.js";`

**Step 3: Typecheck**

Run: `cd packages/cell-mcp && bun run typecheck`  
Expected: passes. Fix any issues (e.g. ZodError type, generic registerTool).

**Step 4: Commit**

```bash
git add packages/cell-mcp/src/
git commit -m "feat(cell-mcp): add createCellMcpServer and registerTool with Zod validation"
```

---

## Task 5: registerResource and registerPrompt passthrough

**Files:**
- Modify: `packages/cell-mcp/src/server.ts`

**Step 1: Type resource and prompt registrations**

- Define types (or use MCP SDK types if exported) for resource: `(name, uri, options, handler)` and prompt: `(name, options, handler)`. Check SDK `McpServer` method signatures for `registerResource` and `registerPrompt`.
- In createCellMcpServer, add `resources: Array<ResourceReg>` and `prompts: Array<PromptReg>` where each holds the arguments to pass to `server.registerResource` / `server.registerPrompt`.

**Step 2: Implement registerResource and registerPrompt**

- `registerResource(...args)`: push args to `resources`.
- `registerPrompt(...args)`: push args to `prompts`.
- In `buildMcpServer()`, after registering tools, call `server.registerResource(...)` for each resource and `server.registerPrompt(...)` for each prompt.

**Step 3: Verify**

Run typecheck. If SDK types are complex, use `// @ts-expect-error` or `eslint-disable` only where necessary and add a short comment.

**Step 4: Commit**

```bash
git add packages/cell-mcp/src/server.ts
git commit -m "feat(cell-mcp): add registerResource and registerPrompt passthrough"
```

---

## Task 6: getRoute with auth and WebStandardStreamableHTTPServerTransport

**Files:**
- Modify: `packages/cell-mcp/src/server.ts`
- Modify: `packages/cell-mcp/src/index.ts` (export getRoute return type if needed)

**Step 1: Implement getRoute**

- Import `Hono` from "hono", `WebStandardStreamableHTTPServerTransport` from `@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js`.
- `getRoute()`: create a Hono app (e.g. `new Hono<Record<string, unknown>>()`), add `POST "/mcp"`, async handler:
  - If `authCheck` is provided, run `const ok = await authCheck(c)`; if `!ok` return `onUnauthorized ? onUnauthorized(c) : c.json({ error: "Unauthorized" }, 401)`.
  - Create transport: `new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })`.
  - Build server: `const server = buildMcpServer()`.
  - `await server.connect(transport)`.
  - `const res = await transport.handleRequest(c.req.raw)`.
  - `await server.close()`.
  - Return `new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers })`.
- Return the Hono app (so caller can `app.route("/", cellMcp.getRoute())` or mount `app.post("/mcp", ...)` from the returned app).

**Step 2: Export**

Ensure the builder return type includes `getRoute`. Export any Hono type from index if consumers need it.

**Step 3: Typecheck**

Run: `cd packages/cell-mcp && bun run typecheck`  
Expected: passes.

**Step 4: Commit**

```bash
git add packages/cell-mcp/src/
git commit -m "feat(cell-mcp): add getRoute with auth and HTTP transport"
```

---

## Task 7: Integration test (optional but recommended)

**Files:**
- Create: `packages/cell-mcp/src/server.test.ts`

**Step 1: Add integration test**

- Create a small Hono app with createCellMcpServer, register one tool with zod schema (e.g. `z.object({ x: z.string() })`), no authCheck. Mount getRoute() at "/mcp".
- Use `hono/test` or fetch to POST to "/mcp" with JSON-RPC body `{ "jsonrpc":"2.0", "id":1, "method":"initialize" }`; expect 200 and result with serverInfo name.
- POST `tools/call` with invalid args (e.g. missing "x"); expect result content to contain validation error text and tool name.
- POST `tools/call` with valid args `{ "x": "hello" }`; expect result content from handler.

**Step 2: Run tests**

Run: `cd packages/cell-mcp && bun test src/`  
Expected: all tests pass.

**Step 3: Commit**

```bash
git add packages/cell-mcp/src/server.test.ts
git commit -m "test(cell-mcp): add integration test for MCP route and validation"
```

---

## Task 8: README and exports cleanup

**Files:**
- Create: `packages/cell-mcp/README.md`
- Modify: `packages/cell-mcp/src/index.ts`

**Step 1: README**

Add short README: package purpose, usage example (createCellMcpServer, registerTool, getRoute), link to design doc.

**Step 2: Exports**

Ensure index.ts exports: `createCellMcpServer`, `ToolResult`, `CellMcpServerOptions`, and optionally `formatToolValidationError`. Remove any temporary exports.

**Step 3: Commit**

```bash
git add packages/cell-mcp/README.md packages/cell-mcp/src/index.ts
git commit -m "docs(cell-mcp): add README and tidy exports"
```

---

## Execution handoff

Plan complete and saved to `docs/plans/2026-03-11-cell-mcp-impl.md`.

**Two execution options:**

1. **Subagent-Driven (this session)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Parallel Session (separate)** — Open a new session with executing-plans, batch execution with checkpoints.

Which approach do you prefer? If you prefer to implement it yourself, you can follow the plan step-by-step; use **executing-plans** skill when running the plan in another session.
